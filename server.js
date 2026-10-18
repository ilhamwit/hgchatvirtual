// Single local server for Chat Center: serves the static page and the /api/
// the page uses, and talks to the Hermes agents on the users' behalf. One
// port, one origin — the target behind the agents.herrygunawan.com tunnel.
//
// Security model:
//   1. The Hermes API key never ships to the browser. It is read from the
//      environment (HERMES_API_KEY) and used only by lib/gateway.js.
//   2. Every team member logs in with their own account (SQLite, scrypt);
//      the browser holds a random session token in an HttpOnly cookie.
// Env is supplied by systemd via /home/hg/.config/chat-center.env
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { openDb } = require('./lib/db');
const auth = require('./lib/auth');
const audit = require('./lib/audit');
const { createGateway, DEFAULT_URL: DEFAULT_GATEWAY_URL } = require('./lib/gateway');
const { createApi } = require('./lib/api');
const { createWhatsApp } = require('./lib/whatsapp');
const { createWaArchive } = require('./lib/wa-archive');
const { createSchedule } = require('./lib/schedule');

// Fail fast on bad config. Production (systemd) must provide the Hermes
// API key; CHAT_DEV=1 is the explicit opt-out for local UI work. See .env.example.
const DEV = process.env.CHAT_DEV === '1';
const REQUIRED_ENV = ['HERMES_API_KEY'];

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

const GATEWAY = process.env.CHAT_HERMES_URL || DEFAULT_GATEWAY_URL;
// Hermes profile names the UI may talk to (default: the five team agents).
// Each must have API_SERVER_KEY = HERMES_API_KEY in its profile .env.
const AGENTS = (process.env.CHAT_AGENTS || 'dave,jaden,joel,dylan,nana')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (!AGENTS.every((a) => /^[a-z0-9_-]+$/.test(a))) configError('CHAT_AGENTS must be a comma-separated list of agent ids');
const PORT = intEnv('CHAT_PORT', 8643, 1, 65535);
const ROOT = __dirname;
// Only this directory is reachable over HTTP. Everything else in ROOT (server
// code, docs, .git, .agentic) stays private.
const PUBLIC = path.join(ROOT, 'public');

const HERMES_API_KEY = process.env.HERMES_API_KEY || '';
const COOKIE_NAME = 'hgchat_session';
const COOKIE_MAX_AGE = Math.floor(auth.SESSION_TTL_MS / 1000);

let db;
try {
  db = openDb();
} catch (err) {
  configError('cannot open database (' + (process.env.CHAT_DB_PATH || 'data/chat-center.db') + '): ' + err.message);
}
if (auth.countActiveUsers(db) === 0) {
  const hint = 'no active users — create one with: node scripts/users.js add <username> --admin';
  if (DEV) console.warn('Warning: ' + hint + ' (dev: npm run dev:users -- add <username>)');
  else configError(hint);
}
// 5 failed logins per 15 minutes, counted per client IP and per username.
const loginLimiter = auth.createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
setInterval(() => { auth.purgeExpiredSessions(db); audit.purge(db); }, 60 * 60 * 1000).unref();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

// Attachments follow OpenClaw's inbound-media convention (where its Telegram
// channel dropped files; kept so older attachment paths stay valid): <slug>---<uuid>.<ext>. The agents read them
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

// WhatsApp pairing for the "Koneksikan WA" page. It only pairs into a staging
// session; installing it (and restarting Hermes) is scripts/wa-apply.sh, run
// by a person. Pairing ends after the request that started it, so its audit
// entries name the user who started it and carry "web" instead of an IP.
const whatsapp = createWhatsApp({
  onEvent: (event, username, detail) => audit.record(db, { event, username, ip: 'web', detail })
});

const gateway = createGateway({ url: GATEWAY, key: HERMES_API_KEY });

const api = createApi({
  db,
  gateway,
  agents: AGENTS,
  mediaDir: MEDIA_DIR,
  whatsapp,
  // Group reading + summaries from Hermes' WhatsApp group archive (read only).
  waArchive: createWaArchive({ db, gateway }),
  // Agent schedules from Hermes' cron files (read only).
  schedule: createSchedule({ db })
});

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

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Behind the Cloudflare tunnel every connection comes from cloudflared on
// loopback, so the visitor's details are in Cloudflare's headers. Only trust
// them from loopback; anything else is a direct connection.
function viaProxy(req) {
  const remote = req.socket.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function clientIp(req) {
  return (viaProxy(req) && req.headers['cf-connecting-ip']) || req.socket.remoteAddress || '';
}

// The scheme the visitor used ('http' / 'https'), or null for a direct local
// connection with no proxy headers.
function visitorScheme(req) {
  if (!viaProxy(req)) return null;
  try {
    const scheme = JSON.parse(req.headers['cf-visitor'] || '{}').scheme;
    if (scheme === 'http' || scheme === 'https') return scheme;
  } catch (e) { /* fall through */ }
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'http' || proto === 'https' ? proto : null;
}

function setSessionCookie(req, res, token, maxAge = COOKIE_MAX_AGE) {
  const secure = visitorScheme(req) === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (secure ? '; Secure' : '')
  );
}

// Anonymous visitors may load these (the login page shows the logo).
const PUBLIC_PATHS = new Set(['/assets/hg-logo.png']);
const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;

function readBody(req, limit, cb) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > limit) req.destroy(); });
  req.on('end', () => cb(body));
}

function handleLogin(req, res) {
  readBody(req, 10 * 1024, async (body) => {
    let creds = {};
    try { creds = JSON.parse(body) || {}; } catch (e) { /* treated as empty */ }
    const username = String(creds.username || '').trim().toLowerCase().slice(0, 64);
    const ipKey = 'ip:' + clientIp(req);
    const userKey = 'user:' + username;

    const ip = clientIp(req);
    const wait = Math.max(loginLimiter.retryAfter(ipKey), loginLimiter.retryAfter(userKey));
    if (wait) {
      audit.record(db, { event: 'login_throttled', username, ip });
      res.setHeader('Retry-After', String(wait));
      return sendJson(res, 429, { ok: false, error: 'too_many_attempts', retryAfter: wait });
    }

    let user = null;
    try {
      user = await auth.authenticate(db, username, creds.password);
    } catch (err) {
      console.error('login error:', err.message);
      return sendJson(res, 500, { ok: false });
    }
    if (!user) {
      loginLimiter.fail(ipKey);
      loginLimiter.fail(userKey);
      audit.record(db, { event: 'login_failed', username, ip });
      return sendJson(res, 401, { ok: false });
    }
    // Only the username's counter resets: a valid login must not clear an
    // IP's record of guessing other accounts.
    loginLimiter.reset(userKey);
    setSessionCookie(req, res, auth.createSession(db, user.id, req.headers['user-agent']));
    audit.record(db, { event: 'login_ok', username: user.username, ip });
    sendJson(res, 200, { ok: true, user: { username: user.username, displayName: user.displayName } });
  });
}

function handleLogout(req, res, user) {
  req.resume();
  if (user) audit.record(db, { event: 'logout', username: user.username, ip: clientIp(req) });
  auth.deleteSession(db, getCookie(req, COOKIE_NAME));
  setSessionCookie(req, res, '', 0);
  sendJson(res, 200, { ok: true });
}

// Public liveness check for uptime monitors (EPIC-005 T-028): 200 when the
// database answers and Hermes is up, else 503. Reveals nothing else.
async function handleHealth(req, res) {
  req.resume();
  const out = { ok: true, db: 'ok', hermes: 'ok' };
  try { db.prepare('SELECT 1').get(); } catch (e) { out.db = 'error'; out.ok = false; }
  try {
    const r = await fetch(GATEWAY + '/health', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error('status ' + r.status);
  } catch (e) { out.hermes = 'unreachable'; out.ok = false; }
  sendJson(res, out.ok ? 200 : 503, out);
}

// One line per request to stdout/journald (EPIC-005 T-029): method, path
// without the query string, status, duration, user and client IP. Never
// headers, cookies, bodies or message content. Passing health checks are
// skipped so an uptime monitor does not flood the journal.
function logRequest(req, res, started) {
  res.on('finish', () => {
    const p = req.url.split('?')[0].slice(0, 200);
    if (p === '/healthz' && res.statusCode === 200) return;
    const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    console.log(`req ${req.method} ${p} ${res.statusCode} ${ms}ms user=${req.hgUser || '-'} ip=${clientIp(req)}`);
  });
}

// No CORS headers: the page and its API share one origin, and no other site
// should be able to call this server from a browser.
const server = http.createServer((req, res) => {
  logRequest(req, res, process.hrtime.bigint());

  // Public visitors on plain http go to https first. Mixing the two breaks
  // login: a browser that once got the Secure session cookie over https
  // refuses to replace it from an http page, and never sends it over http.
  if (visitorScheme(req) === 'http' && HOST_RE.test(req.headers.host || '')) {
    req.resume();
    res.writeHead(308, { Location: `https://${req.headers.host}${req.url}`, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const urlNoQuery = req.url.split('?')[0];
  if (urlNoQuery === '/healthz' && req.method === 'GET') { handleHealth(req, res); return; }
  const user = auth.getSessionUser(db, getCookie(req, COOKIE_NAME));
  if (user) req.hgUser = user.username;

  // Public: the login page itself, its credential check, and logout.
  if (urlNoQuery === '/login' && req.method === 'GET') {
    if (user) { res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); res.end(); return; }
    fs.readFile(path.join(PUBLIC, 'login.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  if (urlNoQuery === '/login' && req.method === 'POST') { handleLogin(req, res); return; }
  if (urlNoQuery === '/logout' && req.method === 'POST') { handleLogout(req, res, user); return; }

  if (!user && !PUBLIC_PATHS.has(urlNoQuery)) {
    // API-ish routes get a JSON 401 so fetch() can report it; page loads get
    // bounced to the login screen.
    if (urlNoQuery.startsWith('/v1/') || urlNoQuery.startsWith('/api/') || urlNoQuery === '/upload') {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }
    res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (urlNoQuery === '/api/me' && req.method === 'GET') {
    sendJson(res, 200, { username: user.username, displayName: user.displayName, role: user.role });
    return;
  }

  if (urlNoQuery === '/upload' && req.method === 'POST') {
    handleUpload(req, res);
    return;
  }

  // There is no gateway proxy: the browser only reaches the routes in
  // lib/api.js, and only lib/gateway.js talks to Hermes.
  if (api.handle(req, res, user, new URL(req.url, 'http://local'))) return;

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
  console.log(`Chat Center server running at http://127.0.0.1:${PORT} (Hermes ${GATEWAY}, agents ${AGENTS.join(', ')})`);
  if (DEV) console.log('CHAT_DEV=1: development mode' + (HERMES_API_KEY ? '' : ' (no Hermes key)'));
});

// A pairing bridge runs in its own process group; don't leave it behind.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { whatsapp.shutdown(); process.exit(0); });
}
