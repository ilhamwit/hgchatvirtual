// Single local server for Chat Center: serves the static HTML and proxies
// /v1/* to the Openclaw Gateway. One port, one origin — used both locally
// and as the target behind the agents.herrygunawan.com tunnel.
//
// Hardening (2026-09-24) — before this was exposed publicly:
//   1. The gateway token no longer ships to the browser. It is read from the
//      environment (GATEWAY_TOKEN) and injected on the proxy hop only.
//   2. HTTP Basic auth gate (CHAT_USER / CHAT_PASS) + a signed session cookie,
//      because the client sets its own Authorization header on fetch().
// Env is supplied by systemd via /home/hg/.config/chat-center.env
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Fail fast on bad config. Production (systemd) must provide every secret;
// CHAT_DEV=1 is the explicit opt-out for local runs, where auth is disabled
// and a throwaway cookie secret is generated. See .env.example.
const DEV = process.env.CHAT_DEV === '1';
const REQUIRED_ENV = ['GATEWAY_TOKEN', 'CHAT_USER', 'CHAT_PASS', 'CHAT_SECRET'];

function configError(msg) {
  console.error('Chat Center config error: ' + msg);
  process.exit(1);
}

function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) configError(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  return n;
}

if (!DEV) {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    configError(`missing required env ${missing.join(', ')} — set them in ~/.config/chat-center.env, or run with CHAT_DEV=1 for local development`);
  }
}

const GATEWAY = 'http://127.0.0.1:18789';
const PORT = intEnv('CHAT_PORT', 8643, 1, 65535);
const ROOT = __dirname;
// Only this directory is reachable over HTTP. Everything else in ROOT (server
// code, docs, .git, .agentic) stays private.
const PUBLIC = path.join(ROOT, 'public');

const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
const CHAT_USER = process.env.CHAT_USER || '';
const CHAT_PASS = process.env.CHAT_PASS || '';
const SECRET = process.env.CHAT_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'chatcenter_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

// Attachments follow OpenClaw's own inbound-media convention (the same place the
// Telegram channel drops files): <slug>---<uuid>.<ext>. The agents read them
// with their normal filesystem tools, so an absolute path is the whole handoff.
// Nothing here is ever served back over HTTP — the directory sits outside ROOT.
const MEDIA_DIR = process.env.CHAT_MEDIA_DIR ||
  path.join(os.homedir(), '.openclaw', 'media', 'inbound');
const MAX_UPLOAD_BYTES = intEnv('CHAT_MAX_UPLOAD_BYTES', 10 * 1024 * 1024, 1, 1024 * 1024 * 1024);
const ALLOWED_EXT = new Set([
  'txt','md','csv','tsv','json','yaml','yml','xml','log','ini','conf',
  'pdf','doc','docx','xls','xlsx','ppt','pptx','rtf','odt','ods',
  'png','jpg','jpeg','gif','webp','bmp','heic'
]);

// Keep only a basename, and only characters that are safe in a shell argument
// and in a path — the agent will be handed this string.
function sanitizeUploadName(raw) {
  let name = String(raw || 'file');
  // The client percent-encodes the name, because headers cannot carry non-ASCII.
  try { name = decodeURIComponent(name); } catch (e) { /* keep it as sent */ }
  const flat = name.replace(/\\/g, '/');
  const base = flat.slice(flat.lastIndexOf('/') + 1);
  const m = base.match(/\.([A-Za-z0-9]{1,8})$/);
  const ext = m ? m[1].toLowerCase() : '';
  const rawStem = ext ? base.slice(0, base.length - ext.length - 1) : base;
  const stem = rawStem
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60) || 'file';
  return { stem, ext };
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function handleUpload(req, res) {
  const { stem, ext } = sanitizeUploadName(req.headers['x-upload-name']);
  if (!ext || !ALLOWED_EXT.has(ext)) {
    req.resume();
    return sendJson(res, 415, { error: 'Tipe file' + (ext ? ' .' + ext : '') + ' tidak diizinkan' });
  }
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD_BYTES) {
    req.resume();
    return sendJson(res, 413, { error: 'File melebihi batas ' + Math.round(MAX_UPLOAD_BYTES / 1048576) + ' MB' });
  }

  fs.mkdir(MEDIA_DIR, { recursive: true }, (mkErr) => {
    if (mkErr) {
      req.resume();
      return sendJson(res, 500, { error: 'Gagal menyiapkan folder lampiran' });
    }
    const fileName = stem + '---' + crypto.randomUUID() + '.' + ext;
    const dest = path.join(MEDIA_DIR, fileName);
    const out = fs.createWriteStream(dest, { mode: 0o640, flags: 'wx' });
    let written = 0;
    let failed = null;

    const fail = (code, msg) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.unlink(dest, () => {});
      if (!res.headersSent) sendJson(res, code, { error: msg });
    };

    req.on('data', (chunk) => {
      written += chunk.length;
      // Trust the stream, not the declared length.
      if (written > MAX_UPLOAD_BYTES) {
        req.destroy();
        fail(413, 'File melebihi batas ' + Math.round(MAX_UPLOAD_BYTES / 1048576) + ' MB');
      }
    });
    req.on('error', () => fail(400, 'Upload terputus'));
    out.on('error', (err) => fail(500, 'Gagal menyimpan file: ' + err.message));
    out.on('close', () => {
      if (failed) return;
      sendJson(res, 200, { name: fileName, path: dest, size: written });
    });
    req.pipe(out);
  });
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sessionValue() {
  return crypto.createHmac('sha256', SECRET).update(CHAT_USER + '\u0000' + CHAT_PASS).digest('hex');
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isAuthorized(req) {
  if (DEV && (!CHAT_USER || !CHAT_PASS)) return true; // auth disabled: CHAT_DEV=1 only

  const hdr = req.headers.authorization || '';
  if (hdr.slice(0, 6).toLowerCase() === 'basic ') {
    const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i !== -1) {
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (safeEqual(u, CHAT_USER) && safeEqual(p, CHAT_PASS)) return true;
    }
  }

  const cookie = getCookie(req, COOKIE_NAME);
  if (cookie && safeEqual(cookie, sessionValue())) return true;
  return false;
}

function setAuthCookie(req, res) {
  const secure = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${sessionValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}` + (secure ? '; Secure' : '')
  );
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => cb(body));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Upload-Name');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlNoQuery = req.url.split('?')[0];

  // Public: the login page itself and its credential-check endpoint.
  if (urlNoQuery === '/login' && req.method === 'GET') {
    fs.readFile(path.join(PUBLIC, 'login.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }

  if (urlNoQuery === '/login' && req.method === 'POST') {
    readBody(req, (body) => {
      let creds = {};
      try { creds = JSON.parse(body); } catch (e) {}
      const ok = CHAT_USER && CHAT_PASS &&
        safeEqual(creds.username || '', CHAT_USER) &&
        safeEqual(creds.password || '', CHAT_PASS);
      if (!ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      setAuthCookie(req, res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (!isAuthorized(req)) {
    // API-ish routes get a JSON 401 so fetch() can report it; page loads get
    // bounced to the login screen.
    if (urlNoQuery.startsWith('/v1/') || urlNoQuery === '/upload') {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }
    // Send the browser to our own styled login page instead of the native
    // Basic-auth popup (no WWW-Authenticate header on purpose).
    res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  // Keep the browser authenticated for JS fetch() calls to /v1/*.
  setAuthCookie(req, res);

  if (urlNoQuery === '/upload' && req.method === 'POST') {
    handleUpload(req, res);
    return;
  }

  if (req.url.startsWith('/v1/')) {
    const target = new URL(req.url, GATEWAY);
    const headers = { ...req.headers, host: target.host };
    // Never trust the client's Authorization: replace it with the server-side token.
    if (GATEWAY_TOKEN) headers.authorization = 'Bearer ' + GATEWAY_TOKEN;
    const upstream = http.request(target, { method: req.method, headers }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
    });
    req.pipe(upstream);
    return;
  }

  // '/hg-chat-ai-agent.html' is the pre-split page name; keep old links working.
  let urlPath = urlNoQuery === '/' || urlNoQuery === '/hg-chat-ai-agent.html' ? '/index.html' : urlNoQuery;
  try { urlPath = decodeURIComponent(urlPath); } catch (e) { res.writeHead(400); res.end(); return; }
  const filePath = path.join(PUBLIC, urlPath);
  if (!filePath.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Everything here sits behind login: never let Cloudflare or a shared
      // cache keep a copy, but let the browser revalidate.
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Chat Center server running at http://127.0.0.1:${PORT} (proxying /v1/* -> ${GATEWAY})`);
  if (DEV) {
    const off = [!(CHAT_USER && CHAT_PASS) && 'login', !GATEWAY_TOKEN && 'gateway token'].filter(Boolean);
    console.log('CHAT_DEV=1: development mode' + (off.length ? ` (no ${off.join(', no ')})` : ''));
  }
});
