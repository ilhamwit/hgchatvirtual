// EPIC-005: backup + restore, /healthz, request log, audit trail.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { startServer, startFakeGateway, tempDir, seedDb } = require('./helpers');
const { openDb } = require('../lib/db');
const conv = require('../lib/conversations');
const { backup, verify, prune } = require('../scripts/backup');

const ROOT = path.join(__dirname, '..');
const ILHAM = { username: 'ilham', displayName: 'Ilham', password: 'ilham-password-1', role: 'admin' };

async function dbWithHistory(dir) {
  const file = await seedDb(path.join(dir, 'live.db'), [ILHAM]);
  const db = openDb(file);
  const c = conv.create(db, 1, 'dave');
  conv.addMessage(db, c.id, { role: 'user', content: 'halo' });
  conv.addMessage(db, c.id, { role: 'assistant', content: 'hai' });
  db.close();
  return { file, convId: c.id };
}

test('backup makes a verified, private snapshot with matching counts', async () => {
  const dir = tempDir();
  const { file } = await dbWithHistory(dir);
  const r = backup({ src: file, dir: path.join(dir, 'b'), keepDays: 14 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.counts, { users: 1, conversations: 1, messages: 2 });
  assert.strictEqual(fs.statSync(r.file).mode & 0o777, 0o600);
  assert.match(path.basename(r.file), /^chat-center-\d{8}-\d{6}\.db$/);
  const cli = execFileSync(process.execPath, [path.join(ROOT, 'scripts/backup.js'), '--verify', r.file], { encoding: 'utf8' });
  assert.match(cli, /^OK .* schema v\d+ users=1 conversations=1 messages=2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backup copies to a second folder when asked', async () => {
  const dir = tempDir();
  const { file } = await dbWithHistory(dir);
  const r = backup({ src: file, dir: path.join(dir, 'b'), copyDir: path.join(dir, 'copy'), keepDays: 14 });
  assert.ok(fs.existsSync(r.copy));
  assert.ok(verify(r.copy).ok);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('retention keeps 14 days by the timestamp in the name and ignores other files', () => {
  const dir = tempDir();
  const now = new Date(2026, 9, 18, 3, 0, 0);
  for (const n of ['chat-center-20261003-030000.db', 'chat-center-20261004-030000.db', 'chat-center-20261017-030000.db', 'notes.txt']) {
    fs.writeFileSync(path.join(dir, n), 'x');
  }
  const removed = prune(dir, 14, now);
  assert.deepStrictEqual(removed, ['chat-center-20261003-030000.db']);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['chat-center-20261004-030000.db', 'chat-center-20261017-030000.db', 'notes.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a broken file fails --verify, and a missing database fails the backup', () => {
  const dir = tempDir();
  const bad = path.join(dir, 'chat-center-20261018-000000.db');
  fs.writeFileSync(bad, 'not a database');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/backup.js'), '--verify', bad], { encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0);
  const missing = spawnSync(process.execPath, [path.join(ROOT, 'scripts/backup.js')], {
    encoding: 'utf8', env: { PATH: process.env.PATH, CHAT_DB_PATH: path.join(dir, 'nope.db'), CHAT_BACKUP_DIR: path.join(dir, 'b') }
  });
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /backup FAILED: database not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore: a server started on a backup has the same accounts and history', async () => {
  const dir = tempDir();
  const { file, convId } = await dbWithHistory(dir);
  const r = backup({ src: file, dir: path.join(dir, 'b'), keepDays: 14 });
  // startServer seeds a fresh DB; point it at the restored copy instead.
  const restored = path.join(dir, 'restored.db');
  fs.copyFileSync(r.file, restored);
  const srv = await startServer([], { CHAT_DB_PATH: restored });
  const { cookie } = await srv.login('ilham', ILHAM.password);
  const msgs = await srv.json(cookie, 'GET', `/api/conversations/${convId}/messages`);
  await srv.stop();
  assert.deepStrictEqual(msgs.body.messages.map((m) => m.content), ['halo', 'hai']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('/healthz is public: 200 with Hermes up, 503 quickly with Hermes down', async () => {
  const gw = await startFakeGateway();
  const up = await startServer([ILHAM], { CHAT_HERMES_URL: gw.url });
  const ok = await up.request('/healthz');
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(await ok.json(), { ok: true, db: 'ok', hermes: 'ok' });
  await up.stop();
  await gw.close();

  const down = await startServer([ILHAM]); // helpers point Hermes at a closed port
  const t0 = Date.now();
  const bad = await down.request('/healthz');
  assert.strictEqual(bad.status, 503);
  assert.deepStrictEqual(await bad.json(), { ok: false, db: 'ok', hermes: 'unreachable' });
  assert.ok(Date.now() - t0 < 5000, 'answers within 5 seconds');
  await down.stop();
});

test('request log: one line per request, no query string, cookie or body', async () => {
  const srv = await startServer([ILHAM]);
  const { cookie } = await srv.login('ilham', ILHAM.password, { 'CF-Connecting-IP': '203.0.113.77' });
  await srv.request('/api/me?token=SECRET123', { headers: { cookie, 'CF-Connecting-IP': '203.0.113.77' } });
  await srv.request('/healthz');
  await new Promise((r) => setTimeout(r, 100));
  const out = srv.out;
  await srv.stop();
  assert.match(out, /^req POST \/login 200 \d+ms user=- ip=203\.0\.113\.77$/m);
  assert.match(out, /^req GET \/api\/me 200 \d+ms user=ilham ip=203\.0\.113\.77$/m);
  assert.ok(!out.includes('SECRET123'), 'query strings are not logged');
  assert.ok(!out.includes(cookie.split('=')[1]), 'session tokens are not logged');
  assert.ok(!out.includes(ILHAM.password), 'passwords are not logged');
});

test('audit trail: failed, throttled, successful logins, logout and CLI changes', async () => {
  const srv = await startServer([ILHAM, { username: 'irfan', password: 'irfan-password-1' }]);
  const ip = { 'CF-Connecting-IP': '198.51.100.44' };
  await srv.login('ilham', 'wrong-password', ip);
  const { cookie } = await srv.login('ilham', ILHAM.password, ip);
  await srv.request('/logout', { method: 'POST', headers: { cookie, ...ip } });
  for (let i = 0; i < 6; i++) await srv.login('irfan', 'guess-' + i, { 'CF-Connecting-IP': '198.51.100.45' });
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/users.js'), 'disable', 'irfan'], { env: { PATH: process.env.PATH, CHAT_DB_PATH: srv.dbPath } });
  const audit = execFileSync(process.execPath, [path.join(ROOT, 'scripts/users.js'), 'audit', '50'], { env: { PATH: process.env.PATH, CHAT_DB_PATH: srv.dbPath }, encoding: 'utf8' });
  await srv.stop();
  assert.match(audit, /login_failed\s+ilham\s+198\.51\.100\.44/);
  assert.match(audit, /login_ok\s+ilham\s+198\.51\.100\.44/);
  assert.match(audit, /logout\s+ilham\s+198\.51\.100\.44/);
  assert.match(audit, /login_throttled\s+irfan\s+198\.51\.100\.45/);
  assert.match(audit, /user_disabled\s+irfan\s+cli\s+by \S+/);
  assert.ok(!audit.includes('wrong-password') && !audit.includes('guess-'), 'attempted passwords are never stored');
});

test('set-role makes someone admin at once, and is audited', async () => {
  const srv = await startServer([{ username: 'irfan', password: 'irfan-password-1' }]);
  try {
    const run = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts/users.js'), ...args], { env: { PATH: process.env.PATH, CHAT_DB_PATH: srv.dbPath }, encoding: 'utf8' });
    const { cookie } = await srv.login('irfan', 'irfan-password-1');
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/integrations/keys')).status, 403);
    assert.match(run('set-role', 'irfan', 'admin'), /"irfan" is now admin \(was member\)/);
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/integrations/keys')).status, 200, 'same session, no new login');
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/me')).body.role, 'admin');
    assert.match(run('set-role', 'irfan', 'admin'), /already admin/);
    assert.throws(() => run('set-role', 'irfan', 'owner'), /role must be admin or member/);
    assert.throws(() => run('set-role', 'nobody', 'admin'), /no user "nobody"/);
    assert.match(run('audit', '10'), /role_changed\s+irfan\s+cli\s+by \S+, member -> admin/);
    run('set-role', 'irfan', 'member');
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/integrations/keys')).status, 403);
  } finally {
    await srv.stop();
  }
});
