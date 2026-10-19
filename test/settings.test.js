// EPIC-014 Settings: team accounts from the web (admins), system status,
// and changing one's own password.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer } = require('./helpers');
const { tempPassword } = require('../lib/settings');

const ROOT = path.join(__dirname, '..');

test('temporary passwords are long and unambiguous', () => {
  const p = tempPassword();
  assert.match(p, /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789]{14}$/);
  assert.notStrictEqual(p, tempPassword());
});

test('admins manage accounts; the terminal tool sees the same data', async () => {
  const srv = await startServer([{ username: 'ilham', password: 'ilham-password-1', role: 'admin' }, { username: 'irfan', password: 'irfan-password-1' }]);
  try {
    assert.strictEqual((await srv.request('/api/settings/users')).status, 401);
    const admin = (await srv.login('ilham', 'ilham-password-1')).cookie;
    const member = (await srv.login('irfan', 'irfan-password-1')).cookie;
    for (const [m, p] of [['GET', '/api/settings/users'], ['POST', '/api/settings/users'], ['GET', '/api/settings/status'], ['PATCH', '/api/settings/users/ilham']]) {
      assert.strictEqual((await srv.json(member, m, p, m === 'GET' ? undefined : {})).status, 403, `${m} ${p} as member`);
    }

    // Add: the server makes the password and shows it once.
    let r = await srv.json(admin, 'POST', '/api/settings/users', { username: 'Cahyo', displayName: 'Cahyo F.', role: 'member' });
    assert.strictEqual(r.status, 201);
    assert.deepStrictEqual([r.body.user.username, r.body.user.displayName, r.body.user.role], ['cahyo', 'Cahyo F.', 'member']);
    assert.match(r.body.tempPassword, /^[A-Za-z0-9]{14}$/);
    const tmp1 = r.body.tempPassword;
    const cahyoLogin = await srv.login('cahyo', tmp1);
    assert.ok(cahyoLogin.cookie.includes('='), 'the temporary password works');
    assert.strictEqual((await srv.json(admin, 'POST', '/api/settings/users', { username: 'cahyo' })).status, 400, 'duplicate');
    assert.strictEqual((await srv.json(admin, 'POST', '/api/settings/users', { username: 'x!' })).status, 400, 'bad name');

    // Role: not yourself, never the last admin.
    assert.strictEqual((await srv.json(admin, 'PATCH', '/api/settings/users/ilham', { role: 'member' })).status, 400);
    r = await srv.json(admin, 'PATCH', '/api/settings/users/irfan', { role: 'admin' });
    assert.strictEqual(r.body.user.role, 'admin');
    assert.strictEqual((await srv.json(member, 'GET', '/api/settings/users')).status, 200, 'irfan is admin at once');
    r = await srv.json(member, 'PATCH', '/api/settings/users/ilham', { role: 'member' });
    assert.strictEqual(r.body.user.role, 'member', 'two admins: one may step down');
    assert.strictEqual((await srv.json(admin, 'GET', '/api/settings/users')).status, 403, 'and loses the page');
    assert.strictEqual((await srv.json(member, 'PATCH', '/api/settings/users/irfan', { role: 'member' })).status, 400, 'not yourself');

    // Disable ends sessions; the last admin cannot be disabled.
    r = await srv.json(member, 'PATCH', '/api/settings/users/cahyo', { disabled: true });
    assert.strictEqual(r.body.user.disabled, true);
    assert.strictEqual((await srv.json(cahyoLogin.cookie, 'GET', '/api/me')).status, 401);
    await srv.json(member, 'PATCH', '/api/settings/users/cahyo', { disabled: false });
    assert.strictEqual((await srv.json(member, 'PATCH', '/api/settings/users/irfan', { disabled: true })).status, 400);
    assert.strictEqual((await srv.json(member, 'PATCH', '/api/settings/users/nobody', { disabled: true })).status, 404);

    // Reset password: new temporary one, old sessions gone.
    const cahyo2 = (await srv.login('cahyo', tmp1)).cookie;
    assert.strictEqual((await srv.json(cahyo2, 'GET', '/api/me')).status, 200);
    r = await srv.json(member, 'POST', '/api/settings/users/cahyo/reset-password');
    assert.match(r.body.tempPassword, /^[A-Za-z0-9]{14}$/);
    assert.strictEqual((await srv.json(cahyo2, 'GET', '/api/me')).status, 401);
    assert.ok((await srv.login('cahyo', r.body.tempPassword)).cookie.length > 20);
    r = await srv.json(member, 'POST', '/api/settings/users/cahyo/revoke-sessions');
    assert.strictEqual(r.body.ended, 1);

    const list = (await srv.json(member, 'GET', '/api/settings/users')).body.users;
    assert.deepStrictEqual(list.map((u) => [u.username, u.role, u.disabled]), [['cahyo', 'member', false], ['ilham', 'member', false], ['irfan', 'admin', false]]);
    const cli = execFileSync(process.execPath, [path.join(ROOT, 'scripts/users.js'), 'audit', '20'], { env: { PATH: process.env.PATH, CHAT_DB_PATH: srv.dbPath }, encoding: 'utf8' });
    assert.match(cli, /user_added\s+cahyo\s+web\s+by ilham \(web\), member/);
    assert.match(cli, /role_changed\s+irfan\s+web\s+by ilham \(web\), member -> admin/);
    assert.match(cli, /password_reset\s+cahyo\s+web\s+by irfan \(web\)/);
    assert.ok(!cli.includes(tmp1) && !cli.includes(r.body.tempPassword || '\0'), 'no password in the audit log');
  } finally {
    await srv.stop();
  }
});

test('system status for admins', async () => {
  const srv = await startServer([{ username: 'ilham', password: 'ilham-password-1', role: 'admin' }]);
  try {
    const admin = (await srv.login('ilham', 'ilham-password-1')).cookie;
    const s = (await srv.json(admin, 'GET', '/api/settings/status')).body;
    assert.strictEqual(s.schema, require('../lib/db').SCHEMA_VERSION);
    assert.ok(s.dbSize > 0 && s.uptimeSec >= 0 && s.pid > 0);
    assert.deepStrictEqual([s.counts.users, s.counts.sessions], [1, 1]);
    assert.strictEqual(s.hermes, 'unreachable', 'tests point Hermes at a dead port');
    assert.strictEqual(s.whatsapp.bridge, 'unreachable');
    assert.strictEqual(s.backup, null, 'no backups in a fresh test dir');
  } finally {
    await srv.stop();
  }
});

test('own password: wrong current -> 400; success keeps this session, ends the others', async () => {
  const srv = await startServer([{ username: 'irfan', password: 'irfan-password-1' }]);
  try {
    const a = (await srv.login('irfan', 'irfan-password-1')).cookie;
    const b = (await srv.login('irfan', 'irfan-password-1')).cookie;
    assert.strictEqual((await srv.request('/api/profile/password', { method: 'POST', body: '{}' })).status, 401);
    assert.strictEqual((await srv.json(a, 'POST', '/api/profile/password', { current: 'salah', next: 'password-baru-123' })).status, 400);
    assert.strictEqual((await srv.json(a, 'POST', '/api/profile/password', { current: 'irfan-password-1', next: 'pendek' })).status, 400);
    const res = await fetch(srv.base + '/api/profile/password', { method: 'POST', headers: { cookie: a, 'Content-Type': 'application/json' }, body: JSON.stringify({ current: 'irfan-password-1', next: 'password-baru-123' }) });
    assert.strictEqual(res.status, 200);
    const fresh = (res.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(fresh && fresh !== a, 'a new session cookie for this browser');
    assert.strictEqual((await srv.json(fresh, 'GET', '/api/me')).status, 200);
    assert.strictEqual((await srv.json(b, 'GET', '/api/me')).status, 401, 'the other device is logged out');
    assert.ok((await srv.login('irfan', 'password-baru-123')).cookie.length > 20);
    assert.strictEqual((await srv.login('irfan', 'irfan-password-1')).res.status, 401);
  } finally {
    await srv.stop();
  }
});
