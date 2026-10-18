// JSON API for the chat UI (EPIC-002). Mounted by server.js under /api/ for
// logged-in users only. Every conversation route checks ownership through
// lib/conversations.js: another user's conversation is a 404.
const fs = require('fs');
const path = require('path');
const conv = require('./conversations');

const MAX_TEXT = 20000;
const MAX_ATTACHMENTS = 10;
const UPLOAD_NAME_RE = /^[A-Za-z0-9._-]+---[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > limit) { tooBig = true; reject(Object.assign(new Error('body too large'), { status: 413 })); }
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

function createApi({ db, gateway, agents, mediaDir }) {
  // One in-flight turn per conversation: id -> AbortController.
  const inflight = new Map();

  // Attachments must be files /upload wrote into the media dir. The agent is
  // handed these paths, so nothing else on disk may be named here.
  function checkAttachments(list) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list) || list.length > MAX_ATTACHMENTS) throw badRequest(`attachments must be a list of at most ${MAX_ATTACHMENTS}`);
    return list.map((a) => {
      const p = path.resolve(String(a && a.path || ''));
      if (path.dirname(p) !== path.resolve(mediaDir) || !UPLOAD_NAME_RE.test(path.basename(p)) || !fs.existsSync(p)) {
        throw badRequest('attachment is not an uploaded file');
      }
      return { name: String(a.name || path.basename(p)).slice(0, 200), size: Number(a.size) || 0, path: p };
    });
  }

  // What the agent receives: who is asking, the attachment paths, the text.
  function wireText(user, text, attachments) {
    const lines = [`[Dari: ${user.displayName} (@${user.username}) via HG Chat]`];
    for (const a of attachments) lines.push(`[Lampiran: ${a.name} -> ${a.path}]`);
    return lines.join('\n') + (text ? '\n\n' + text : '');
  }

  // Runs one turn to completion and stores the outcome. It deliberately does
  // not stop when the browser disconnects: the reply lands in history and is
  // there on the next load. Only POST .../stop cancels it.
  async function runTurn(c, user, userMsg) {
    const ctrl = new AbortController();
    inflight.set(c.id, ctrl);
    try {
      const reply = await gateway.ask({
        agentId: c.agentId, conversationId: c.id,
        text: wireText(user, userMsg.content, userMsg.attachments), signal: ctrl.signal
      });
      return conv.addMessage(db, c.id, { role: 'assistant', content: reply });
    } catch (err) {
      if (!err.stopped && !err.timedOut) console.error(`gateway error (${c.agentId}, ${c.id}):`, err.message);
      return conv.addMessage(db, c.id, { role: 'error', content: err.message || 'Gagal menghubungi gateway.' });
    } finally {
      inflight.delete(c.id);
    }
  }

  const routes = [
    ['GET', /^\/api\/agents$/, () => ({ agents })],

    ['GET', /^\/api\/conversations$/, (req, user, m, url) => {
      const agentId = url.searchParams.get('agent') || undefined;
      const conversations = conv.list(db, user.id, { agentId, includeArchived: url.searchParams.get('archived') === '1' });
      return { conversations: conversations.map((c) => ({ ...c, pending: inflight.has(c.id) })) };
    }],

    ['POST', /^\/api\/conversations$/, async (req, user) => {
      const body = await readJson(req, 4 * 1024);
      if (!agents.includes(body.agentId)) throw badRequest('unknown agent');
      return [201, { conversation: conv.create(db, user.id, body.agentId) }];
    }],

    ['GET', /^\/api\/conversations\/([\w-]+)$/, (req, user, m) => {
      const c = conv.get(db, user.id, m[1]);
      return c ? { conversation: { ...c, pending: inflight.has(c.id) } } : null;
    }],

    ['PATCH', /^\/api\/conversations\/([\w-]+)$/, async (req, user, m) => {
      const body = await readJson(req, 4 * 1024);
      const patch = {};
      if (body.title !== undefined) patch.title = String(body.title);
      if (body.archived !== undefined) patch.archived = !!body.archived;
      const c = conv.update(db, user.id, m[1], patch);
      return c ? { conversation: c } : null;
    }],

    ['GET', /^\/api\/conversations\/([\w-]+)\/messages$/, (req, user, m) => {
      const list = conv.messages(db, user.id, m[1]);
      return list ? { messages: list, pending: inflight.has(m[1]) } : null;
    }],

    ['POST', /^\/api\/conversations\/([\w-]+)\/messages$/, async (req, user, m) => {
      const c = conv.get(db, user.id, m[1]);
      if (!c) { req.resume(); return null; }
      const body = await readJson(req, 64 * 1024);
      const text = String(body.text || '').trim();
      if (text.length > MAX_TEXT) throw badRequest(`message longer than ${MAX_TEXT} characters`);
      const attachments = checkAttachments(body.attachments);
      if (!text && !attachments.length) throw badRequest('empty message');
      if (inflight.has(c.id)) return [409, { error: 'busy' }];
      const message = conv.addMessage(db, c.id, { role: 'user', content: text, attachments });
      const reply = await runTurn(c, user, message);
      return { message, reply };
    }],

    // Re-asks the last user message after a failed turn, without storing it twice.
    ['POST', /^\/api\/conversations\/([\w-]+)\/retry$/, async (req, user, m) => {
      req.resume();
      const c = conv.get(db, user.id, m[1]);
      if (!c) return null;
      if (inflight.has(c.id)) return [409, { error: 'busy' }];
      const last = conv.lastMessage(db, c.id);
      const question = conv.lastUserMessage(db, c.id);
      if (!last || last.role !== 'error' || !question) throw badRequest('nothing to retry');
      return { reply: await runTurn(c, user, question) };
    }],

    ['POST', /^\/api\/conversations\/([\w-]+)\/stop$/, (req, user, m) => {
      req.resume();
      if (!conv.get(db, user.id, m[1])) return null;
      const ctrl = inflight.get(m[1]);
      if (ctrl) ctrl.abort();
      return { stopped: !!ctrl };
    }],

    ['POST', /^\/api\/import$/, async (req, user) => {
      const body = await readJson(req, 8 * 1024 * 1024);
      return conv.importBrowserHistory(db, user.id, body.history, agents);
    }]
  ];

  // Returns true when it handled the request.
  function handle(req, res, user, url) {
    for (const [method, re, fn] of routes) {
      const m = url.pathname.match(re);
      if (!m) continue;
      if (req.method !== method) continue;
      Promise.resolve()
        .then(() => fn(req, user, m, url))
        .then((out) => {
          if (out === null) return sendJson(res, 404, { error: 'not found' });
          const [code, body] = Array.isArray(out) ? out : [200, out];
          sendJson(res, code, body);
        })
        .catch((err) => {
          const status = err.status || 500;
          if (status === 500) console.error('api error:', err);
          if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'internal error' : err.message });
        });
      return true;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, routes.some(([, re]) => re.test(url.pathname)) ? 405 : 404, { error: 'not found' });
      return true;
    }
    return false;
  }

  return { handle, inflight };
}

module.exports = { createApi };
