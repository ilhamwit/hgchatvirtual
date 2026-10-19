// JSON API for the chat UI (EPIC-002). Mounted by server.js under /api/ for
// logged-in users only. Every conversation route checks ownership through
// lib/conversations.js: another user's conversation is a 404.
const fs = require('fs');
const path = require('path');
const conv = require('./conversations');
const { createRooms } = require('./rooms');

const MAX_TEXT = 20000;
const MAX_ATTACHMENTS = 10;
const UPLOAD_NAME_RE = /^[A-Za-z0-9._-]+---[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

// Attachment previews (EPIC-011). Text-like files are always served as
// text/plain so nothing uploaded is ever rendered as a page; types not listed
// here are download-only.
const FILE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/plain', csv: 'text/plain', tsv: 'text/plain', json: 'text/plain', yaml: 'text/plain',
  yml: 'text/plain', xml: 'text/plain', log: 'text/plain', ini: 'text/plain', conf: 'text/plain'
};
class FileResponse { constructor(file, name, download) { Object.assign(this, { file, name, download }); } }

function sendFile(res, { file, name, download }) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = FILE_TYPES[ext];
  const asDownload = download || !type;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const headers = {
    'Content-Type': type ? (type.startsWith('text/') ? type + '; charset=utf-8' : type) : 'application/octet-stream',
    'Content-Disposition': `${asDownload ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
    // The browser's PDF viewer does not run inside a sandbox; everything else does.
    'Content-Security-Policy': ext === 'pdf' ? "default-src 'none'; object-src 'self'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
  };
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'file tidak ditemukan' });
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

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

function createApi({ db, gateway, agents, mediaDir, whatsapp, waArchive, events, tasks, hub, notifier, integrations }) {
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

  // Chat & Discussion (EPIC-012). Changes go out live through the hub.
  const rooms = createRooms({ db, checkAttachments, publish: hub ? hub.publish : () => {}, gateway, agents, notify: notifier ? notifier.enqueue : () => {} });

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

    // EPIC-011: delete a session (and its messages). Not while the agent answers.
    ['DELETE', /^\/api\/conversations\/([\w-]+)$/, (req, user, m) => {
      req.resume();
      if (!conv.get(db, user.id, m[1])) return null;
      if (inflight.has(m[1])) return [409, { error: 'agent masih menjawab di sesi ini' }];
      conv.remove(db, user.id, m[1]);
      return { ok: true };
    }],

    // EPIC-011: an attachment of one of the user's own messages, for preview
    // (inline) or ?download=1. Anything else is a 404.
    ['GET', /^\/api\/files\/([^/]+)$/, (req, user, m, url) => {
      let name;
      try { name = decodeURIComponent(m[1]); } catch (e) { return null; }
      if (!UPLOAD_NAME_RE.test(name)) return null;
      const a = conv.findAttachment(db, user.id, name) || rooms.findAttachment(user, name);
      const file = a && path.resolve(a.path);
      if (!file || path.dirname(file) !== path.resolve(mediaDir)) return null;
      return new FileResponse(file, String(a.name || name), url.searchParams.get('download') === '1');
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
      // Writing in an archived session brings it back (EPIC-011).
      if (c.archived) conv.update(db, user.id, c.id, { archived: false });
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
    }],

    // WhatsApp number of the Hermes gateway (EPIC-008 T-042). Any logged-in
    // user may connect or change it (decided by the owner on 2026-10-18);
    // every step is written to the audit log by lib/whatsapp.js.
    ['GET', /^\/api\/wa\/status$/, () => whatsapp.status()],

    ['POST', /^\/api\/wa\/pair$/, (req, user) => {
      req.resume();
      return [202, { pairing: whatsapp.start(user.username) }];
    }],

    ['DELETE', /^\/api\/wa\/pair$/, (req, user) => {
      req.resume();
      return { pairing: whatsapp.cancel(user.username) };
    }],

    // WhatsApp groups (EPIC-008 T-043/T-045), read from Hermes' group archive.
    // Every logged-in user may read every group (owner's decision, 2026-10-18).
    ['GET', /^\/api\/wa\/groups$/, async () => ({ groups: await waArchive.groups() })],

    ['GET', /^\/api\/wa\/groups\/([^/]+)\/messages$/, (req, user, m, url) =>
      waArchive.messages(decodeURIComponent(m[1]), {
        before: url.searchParams.get('before') || undefined,
        limit: url.searchParams.get('limit') || undefined
      })],

    ['GET', /^\/api\/wa\/summaries$/, (req, user, m, url) =>
      ({ summaries: waArchive.listSummaries(url.searchParams.get('chatId') || undefined) })],

    ['POST', /^\/api\/wa\/summaries$/, async (req, user) => {
      const body = await readJson(req, 4 * 1024);
      return [202, { summary: waArchive.createSummary(user, body) }];
    }],

    ['GET', /^\/api\/wa\/summaries\/(\d+)$/, (req, user, m) => {
      const s = waArchive.getSummary(m[1]);
      return s ? { summary: s } : null;
    }],

    // Schedule (EPIC-009): team events. Any logged-in user may create, edit
    // and send (owner's decision, 2026-10-19); nothing reaches a WhatsApp
    // group until someone presses "Kirim ke grup" (POST .../send).
    ['GET', /^\/api\/events\/options$/, () => events.options()],

    ['GET', /^\/api\/events$/, (req, user, m, url) => ({
      events: events.list({
        from: url.searchParams.get('from'), to: url.searchParams.get('to'),
        upcoming: url.searchParams.get('upcoming') === '1'
      })
    })],

    ['POST', /^\/api\/events$/, async (req, user) => [201, events.create(user, await readJson(req, 16 * 1024))]],

    ['GET', /^\/api\/events\/(\d+)$/, (req, user, m) => events.get(m[1])],

    ['PATCH', /^\/api\/events\/(\d+)$/, async (req, user, m) => events.update(user, m[1], await readJson(req, 16 * 1024))],

    ['DELETE', /^\/api\/events\/(\d+)$/, (req, user, m) => { req.resume(); return events.remove(m[1]); }],

    ['POST', /^\/api\/events\/(\d+)\/agenda$/, (req, user, m) => { req.resume(); return [202, events.writeAgenda(m[1])]; }],

    ['PUT', /^\/api\/events\/(\d+)\/agenda$/, async (req, user, m) =>
      events.saveAgenda(m[1], (await readJson(req, 32 * 1024)).agenda)],

    ['POST', /^\/api\/events\/(\d+)\/send$/, (req, user, m) => { req.resume(); return events.send(user, m[1]); }],

    ['POST', /^\/api\/events\/(\d+)\/cancel$/, async (req, user, m) =>
      events.cancel(user, m[1], { notify: !!(await readJson(req, 1024)).notify })],

    // Chat & Discussion (EPIC-012): channels open to the whole team, DMs only
    // to their two members (anyone else gets 404). Live updates: /api/stream.
    ['GET', /^\/api\/rooms$/, (req, user) => ({ rooms: rooms.list(user), people: rooms.people(), online: hub ? hub.online() : [] })],

    ['GET', /^\/api\/rooms\/unread$/, (req, user) => rooms.totals(user)],

    ['POST', /^\/api\/rooms$/, async (req, user) => [201, { room: rooms.createChannel(user, await readJson(req, 4 * 1024)) }]],

    ['POST', /^\/api\/rooms\/dm$/, async (req, user) => ({ room: rooms.openDm(user, (await readJson(req, 1024)).username) })],

    ['PATCH', /^\/api\/rooms\/(\d+)$/, async (req, user, m) => ({ room: rooms.setTopic(user, m[1], (await readJson(req, 4 * 1024)).topic) })],

    ['GET', /^\/api\/rooms\/(\d+)\/messages$/, (req, user, m, url) =>
      rooms.messages(user, m[1], { before: url.searchParams.get('before'), parentId: url.searchParams.get('parent') })],

    ['POST', /^\/api\/rooms\/(\d+)\/messages$/, async (req, user, m) =>
      [201, { message: rooms.post(user, m[1], await readJson(req, 64 * 1024)) }]],

    ['POST', /^\/api\/rooms\/(\d+)\/read$/, async (req, user, m) => ({ room: rooms.markRead(user, m[1], (await readJson(req, 1024)).lastId) })],

    // EPIC-013: API keys for integrations — admins only.
    ['GET', /^\/api\/integrations\/keys$/, (req, user) => { adminOnly(user); return { keys: integrations.listKeys(), scopes: integrations.scopes }; }],

    ['POST', /^\/api\/integrations\/keys$/, async (req, user) => { adminOnly(user); return [201, integrations.createKey(user, await readJson(req, 2048))]; }],

    ['DELETE', /^\/api\/integrations\/keys\/(\d+)$/, (req, user, m) => { req.resume(); adminOnly(user); return { apiKey: integrations.revokeKey(user, m[1]) }; }],

    // Stage 3: the person's own profile — verified WhatsApp number and
    // notification settings. Only ever the logged-in user's own.
    ['GET', /^\/api\/profile$/, (req, user) => ({ profile: notifier.profile(user) })],

    ['PATCH', /^\/api\/profile$/, async (req, user) => ({ profile: notifier.updateSettings(user, await readJson(req, 1024)) })],

    ['POST', /^\/api\/profile\/wa$/, async (req, user) => ({ profile: await notifier.requestCode(user, (await readJson(req, 1024)).number) })],

    ['POST', /^\/api\/profile\/wa\/verify$/, async (req, user) => ({ profile: notifier.verify(user, (await readJson(req, 1024)).code) })],

    ['DELETE', /^\/api\/profile\/wa$/, (req, user) => { req.resume(); return { profile: notifier.removeNumber(user) }; }],

    ['POST', /^\/api\/profile\/wa\/test$/, async (req, user) => { req.resume(); return notifier.sendTest(user); }],

    // Stage 2: "Ringkas diskusi" by Aurix (background job, polled), and sharing it.
    ['POST', /^\/api\/rooms\/(\d+)\/summary$/, async (req, user, m) => [202, { summary: rooms.summarize(user, m[1], await readJson(req, 1024)) }]],

    ['GET', /^\/api\/room-summaries\/([0-9a-f-]{36})$/, (req, user, m) => ({ summary: rooms.getSummary(user, m[1]) })],

    ['POST', /^\/api\/room-summaries\/([0-9a-f-]{36})\/share$/, (req, user, m) => { req.resume(); return [201, { message: rooms.shareSummary(user, m[1]) }]; }],

    ['PATCH', /^\/api\/room-messages\/(\d+)$/, async (req, user, m) => ({ message: rooms.edit(user, m[1], (await readJson(req, 64 * 1024)).body) })],

    ['DELETE', /^\/api\/room-messages\/(\d+)$/, (req, user, m) => { req.resume(); return { message: rooms.remove(user, m[1]) }; }],

    // Task Focus (EPIC-010): team tasks. The whole team sees and edits every
    // task (owner's decision, 2026-10-19); only people reach these routes, so
    // only people can mark a task done.
    ['GET', /^\/api\/tasks\/people$/, () => ({ people: tasks.people() })],

    ['GET', /^\/api\/tasks\/summary$/, (req, user) => tasks.summary(user)],

    ['GET', /^\/api\/tasks$/, (req, user, m, url) => ({
      tasks: tasks.list(user, { mine: url.searchParams.get('mine') === '1', assignee: url.searchParams.get('assignee') || undefined })
    })],

    ['POST', /^\/api\/tasks$/, async (req, user) => [201, tasks.create(user, await readJson(req, 16 * 1024))]],

    ['GET', /^\/api\/tasks\/(\d+)$/, (req, user, m) => tasks.get(m[1])],

    ['PATCH', /^\/api\/tasks\/(\d+)$/, async (req, user, m) => tasks.update(user, m[1], await readJson(req, 16 * 1024))],

    ['DELETE', /^\/api\/tasks\/(\d+)$/, (req, user, m) => { req.resume(); return tasks.remove(user, m[1]); }],

    ['POST', /^\/api\/tasks\/(\d+)\/comments$/, async (req, user, m) =>
      [201, tasks.comment(user, m[1], (await readJson(req, 8 * 1024)).body)]]
  ];

  function adminOnly(user) { if (user.role !== 'admin') throw Object.assign(new Error('hanya admin'), { status: 403 }); }

  // EPIC-013: the v1 API for integrations, authenticated by an API key
  // (Authorization: Bearer cc_…) instead of a login session. Errors carry a
  // code and a message the calling agent can pass on to the person.
  const v1 = [
    ['POST', /^\/api\/v1\/events$/, async (req) => [201, integrations.createEvent(req, await readJson(req, 16 * 1024))]],
    ['GET', /^\/api\/v1\/events$/, (req, url) => integrations.listEvents(req, url)]
  ];
  function handleV1(req, res, url) {
    if (!url.pathname.startsWith('/api/v1/')) return false;
    const route = v1.find(([method, re]) => re.test(url.pathname) && req.method === method);
    if (!route || !integrations) { req.resume(); sendJson(res, route ? 503 : 404, { error: 'not_found', message: 'tidak ada' }); return true; }
    Promise.resolve()
      .then(() => route[2](req, url))
      .then((out) => { const [code, body] = Array.isArray(out) ? out : [200, out]; sendJson(res, code, body); })
      .catch((err) => {
        const status = err.status || 500;
        if (status === 500) console.error('api v1 error:', err);
        if (!res.headersSent) sendJson(res, status, { error: err.code || (status === 400 ? 'invalid_request' : status === 500 ? 'internal_error' : 'error'), message: status === 500 ? 'kesalahan server' : err.message });
      });
    return true;
  }

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
          if (out instanceof FileResponse) return sendFile(res, out);
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

  return { handle, handleV1, inflight };
}

module.exports = { createApi };
