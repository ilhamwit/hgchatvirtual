// EPIC-008 T-042: WhatsApp pairing from the web + scripts/wa-apply.js.
// Uses a fake bridge, fake stop/start commands and a fake /health — never the
// real Hermes, its session, or systemd.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createWhatsApp, phoneFromId } = require('../lib/whatsapp');
const { startServer, tempDir } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const FAKE_BRIDGE = path.join(__dirname, 'fixtures', 'fake-bridge.js');
const HERMES_BRIDGE_DIR = path.join(os.homedir(), '.hermes', 'hermes-agent', 'scripts', 'whatsapp-bridge');
const OLD = { id: '628999000111:3@s.whatsapp.net', name: 'Bot Lama' };
const NEW_PHONE = '628111222333';

function sandbox(mode) {
  const dir = tempDir();
  const sessionDir = path.join(dir, 'session');
  if (mode) fs.writeFileSync(path.join(dir, 'fake-mode'), mode);
  return { dir, sessionDir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeCreds(dir, me) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'creds.json'), JSON.stringify({ me }));
}

function wa(sb, extra = {}) {
  const events = [];
  const w = createWhatsApp({
    sessionDir: sb.sessionDir, pendingDir: sb.sessionDir + '.pending',
    bridgeScript: FAKE_BRIDGE, bridgeDir: fs.existsSync(HERMES_BRIDGE_DIR) ? HERMES_BRIDGE_DIR : path.dirname(FAKE_BRIDGE),
    nodeBin: process.execPath, bridgeUrl: 'http://127.0.0.1:9',
    onEvent: (event, user, detail) => events.push([event, user, detail]),
    ...extra
  });
  return { w, events };
}

async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('phone numbers come from the WhatsApp id like Hermes does', () => {
  assert.strictEqual(phoneFromId('6281234567890:12@s.whatsapp.net'), '6281234567890');
  assert.strictEqual(phoneFromId('6281234567890@s.whatsapp.net'), '6281234567890');
  assert.strictEqual(phoneFromId(''), null);
});

test('a scanned QR parks the new number as pending and leaves the live one alone', async () => {
  const sb = sandbox('scan');
  writeCreds(sb.sessionDir, OLD);
  const { w, events } = wa(sb);
  assert.strictEqual(w.start('ilham').status, 'starting');
  const waiting = await until(async () => { const s = await w.status(); return s.pairing.status === 'waiting' && s; });
  if (fs.existsSync(HERMES_BRIDGE_DIR)) assert.match(waiting.pairing.qrSvg, /^<svg[\s\S]*<path d="M/);
  const s = await until(async () => { const x = await w.status(); return x.pairing.status === 'ready' && x; });
  assert.deepStrictEqual(s.pending, { phone: NEW_PHONE, name: 'Bot Baru' });
  assert.deepStrictEqual(s.account, { phone: '628999000111', name: 'Bot Lama' }, 'live number unchanged');
  assert.match(s.applyCommand, /bash ".*scripts\/wa-apply\.sh"$/);
  assert.strictEqual(fs.statSync(sb.sessionDir + '.pending').mode & 0o777, 0o700);
  assert.deepStrictEqual(events.map((e) => e.slice(0, 2)), [['wa_pair_started', 'ilham'], ['wa_pair_scanned', 'ilham']]);
  assert.ok(!fs.readdirSync(sb.dir).some((n) => n.includes('.pairing-')), 'staging dir is gone');
  sb.cleanup();
});

test('only one pairing at a time; cancel stops it and removes the staging dir', async () => {
  const sb = sandbox('wait');
  const { w, events } = wa(sb);
  w.start('irfan');
  await until(async () => (await w.status()).pairing.status === 'waiting');
  assert.throws(() => w.start('cahyo'), (e) => e.status === 409);
  assert.strictEqual(w.cancel('cahyo').status, 'cancelled');
  assert.ok(!fs.readdirSync(sb.dir).some((n) => n.includes('.pairing-')));
  assert.strictEqual((await w.status()).pending, null);
  assert.deepStrictEqual(events.at(-1).slice(0, 2), ['wa_pair_cancelled', 'cahyo']);
  sb.cleanup();
});

test('an unscanned QR expires', async () => {
  const sb = sandbox('wait');
  const { w } = wa(sb, { pairTimeoutMs: 400 });
  w.start('ilham');
  const s = await until(async () => { const x = await w.status(); return x.pairing.status === 'expired' && x; });
  assert.match(s.pairing.error, /3 menit/);
  sb.cleanup();
});

test('a failing bridge reports the error and leaves nothing behind', async () => {
  const sb = sandbox('fail');
  const { w, events } = wa(sb);
  w.start('ilham');
  const s = await until(async () => { const x = await w.status(); return x.pairing.status === 'error' && x; });
  assert.match(s.pairing.error, /Pairing gagal: logged_out/);
  assert.deepStrictEqual(fs.readdirSync(sb.dir).sort(), ['fake-mode']);
  assert.strictEqual(events.at(-1)[0], 'wa_pair_failed');
  sb.cleanup();
});

test('leftover staging dirs from an interrupted pairing are removed at startup', () => {
  const sb = sandbox();
  fs.mkdirSync(sb.sessionDir + '.pairing-20261018-000000', { recursive: true });
  wa(sb);
  assert.ok(!fs.existsSync(sb.sessionDir + '.pairing-20261018-000000'));
  sb.cleanup();
});

// ── scripts/wa-apply.js ──

function fakeHealth(statusFn) {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: statusFn() }));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

function runApply(sb, healthUrl, args = ['--yes'], extraEnv = {}) {
  const log = path.join(sb.dir, 'systemctl.log');
  const env = {
    PATH: process.env.PATH, HOME: sb.dir,
    CHAT_WA_SESSION_DIR: sb.sessionDir, CHAT_WA_BRIDGE_URL: healthUrl,
    CHAT_WA_STOP_CMD: `echo stop >> "${log}"`, CHAT_WA_START_CMD: `echo start >> "${log}"`,
    CHAT_WA_CONNECT_TIMEOUT_MS: '3000', CHAT_DB_PATH: path.join(sb.dir, 'audit.db'), ...extraEnv
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'wa-apply.js'), ...args], { env });
    child.stdin.end(); // no answer to the confirmation prompt = "no"
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({
      code, out, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []
    }));
  });
}

const auditEvents = (sb) => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(sb.dir, 'audit.db'), { readOnly: true });
  const rows = db.prepare('SELECT event, ip, detail FROM audit_log ORDER BY id').all();
  db.close();
  return rows;
};

test('wa-apply with nothing pending explains what to do and changes nothing', async () => {
  const sb = sandbox();
  writeCreds(sb.sessionDir, OLD);
  const r = await runApply(sb, 'http://127.0.0.1:9');
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /Tidak ada nomor baru/);
  assert.deepStrictEqual(r.calls, []);
  sb.cleanup();
});

test('wa-apply swaps the session, restarts Hermes once, and keeps a backup', async () => {
  const sb = sandbox();
  writeCreds(sb.sessionDir, OLD);
  writeCreds(sb.sessionDir + '.pending', { id: NEW_PHONE + ':5@s.whatsapp.net', name: 'Bot Baru' });
  const health = await fakeHealth(() => 'connected');
  const r = await runApply(sb, health.url);
  health.close();
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(r.calls, ['stop', 'start']);
  assert.match(r.out, /OK — WhatsApp Hermes sekarang memakai \+628111222333 \(Bot Baru\)/);
  const me = JSON.parse(fs.readFileSync(path.join(sb.sessionDir, 'creds.json'), 'utf8')).me;
  assert.strictEqual(me.name, 'Bot Baru');
  const backup = fs.readdirSync(sb.dir).find((n) => n.startsWith('session.bak-'));
  assert.ok(backup, 'old session kept');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sb.dir, backup, 'creds.json'), 'utf8')).me.name, 'Bot Lama');
  assert.ok(!fs.existsSync(sb.sessionDir + '.pending'));
  assert.deepStrictEqual(auditEvents(sb).map((a) => [a.event, a.ip]), [['wa_number_changed', 'cli']]);
  sb.cleanup();
});

test('wa-apply rolls back to the old number when the new one does not connect', async () => {
  const sb = sandbox();
  writeCreds(sb.sessionDir, OLD);
  writeCreds(sb.sessionDir + '.pending', { id: NEW_PHONE + ':5@s.whatsapp.net', name: 'Bot Baru' });
  const health = await fakeHealth(() => 'disconnected');
  const r = await runApply(sb, health.url);
  health.close();
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /Nomor lama dipulihkan/);
  assert.deepStrictEqual(r.calls, ['stop', 'start', 'stop', 'start']);
  const me = JSON.parse(fs.readFileSync(path.join(sb.sessionDir, 'creds.json'), 'utf8')).me;
  assert.strictEqual(me.name, 'Bot Lama', 'old session is back');
  assert.ok(fs.readdirSync(sb.dir).some((n) => n.startsWith('session.failed-')), 'new session kept for inspection');
  assert.strictEqual(auditEvents(sb)[0].event, 'wa_apply_failed');
  sb.cleanup();
});

test('wa-apply asks first and does nothing on "no"', async () => {
  const sb = sandbox();
  writeCreds(sb.sessionDir, OLD);
  writeCreds(sb.sessionDir + '.pending', { id: NEW_PHONE + ':5@s.whatsapp.net', name: 'Bot Baru' });
  const r = await runApply(sb, 'http://127.0.0.1:9', []); // stdin closes immediately = no answer
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /Dibatalkan/);
  assert.deepStrictEqual(r.calls, []);
  assert.ok(fs.existsSync(sb.sessionDir + '.pending'));
  sb.cleanup();
});

// ── HTTP API ──

test('API: status needs login; pairing from the web is audited with the user', async () => {
  const sb = sandbox('scan');
  writeCreds(sb.sessionDir, OLD);
  const srv = await startServer([{ username: 'irfan', password: 'irfan-password-1' }], {
    CHAT_WA_SESSION_DIR: sb.sessionDir, CHAT_WA_BRIDGE_SCRIPT: FAKE_BRIDGE, CHAT_WA_NODE: process.execPath
  });
  try {
    assert.strictEqual((await srv.request('/api/wa/status')).status, 401);
    const { cookie } = await srv.login('irfan', 'irfan-password-1');
    const before = await srv.json(cookie, 'GET', '/api/wa/status');
    assert.deepStrictEqual(before.body.account, { phone: '628999000111', name: 'Bot Lama' });
    assert.strictEqual(before.body.bridge, 'unreachable');
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/wa/pair')).status, 202);
    const ready = await until(async () => {
      const r = await srv.json(cookie, 'GET', '/api/wa/status');
      return r.body.pairing.status === 'ready' && r.body;
    });
    assert.deepStrictEqual(ready.pending, { phone: NEW_PHONE, name: 'Bot Baru' });
    const audit = require('node:child_process').execFileSync(process.execPath, [path.join(ROOT, 'scripts/users.js'), 'audit', '20'],
      { env: { PATH: process.env.PATH, CHAT_DB_PATH: srv.dbPath }, encoding: 'utf8' });
    assert.match(audit, /wa_pair_started\s+irfan\s+web/);
    assert.match(audit, /wa_pair_scanned\s+irfan\s+web\s+628111222333/);
  } finally {
    await srv.stop();
    sb.cleanup();
  }
});

test('the web never stops or restarts Hermes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'whatsapp.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'lib', 'api.js'), 'utf8');
  assert.ok(!/systemctl|hermes-gateway/.test(src.replace(/\/\/.*$/gm, '')), 'no service control outside comments');
});
