// EPIC-001 end to end: the real server.js over a seeded database.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { startServer } = require('./helpers');

const ILHAM = { username: 'ilham', displayName: 'Ilham', password: 'ilham-password-1', role: 'admin' };
const IRFAN = { username: 'irfan', displayName: 'Irfan', password: 'irfan-password-1' };
// Only the throttling test logs in as cahyo, so locking him out affects nothing else.
const CAHYO = { username: 'cahyo', displayName: 'Cahyo', password: 'cahyo-password-1' };

function cli(dbPath, ...args) {
  return execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'users.js'), ...args], {
    env: { PATH: process.env.PATH, CHAT_DB_PATH: dbPath }, encoding: 'utf8'
  });
}

let srv;
test.before(async () => { srv = await startServer([ILHAM, IRFAN, CAHYO]); });
test.after(async () => { await srv.stop(); });

test('anonymous requests: pages redirect to /login, APIs return 401', async () => {
  for (const p of ['/', '/app.js', '/assets/agents/dave.jpg']) {
    const r = await srv.request(p);
    assert.strictEqual(r.status, 302, p);
    assert.strictEqual(r.headers.get('location'), '/login');
  }
  for (const p of ['/api/me', '/v1/models']) assert.strictEqual((await srv.request(p)).status, 401, p);
  assert.strictEqual((await srv.request('/upload', { method: 'POST' })).status, 401);
  assert.strictEqual((await srv.request('/login')).status, 200);
});

test('two users log in at once and the server tells them apart', async () => {
  const a = await srv.login('ilham', ILHAM.password);
  const b = await srv.login('IRFAN', IRFAN.password, { 'CF-Connecting-IP': '203.0.113.9' });
  assert.strictEqual(a.res.status, 200);
  assert.strictEqual(b.res.status, 200);
  assert.notStrictEqual(a.cookie, b.cookie);
  const meA = await (await srv.request('/api/me', { headers: { cookie: a.cookie } })).json();
  const meB = await (await srv.request('/api/me', { headers: { cookie: b.cookie } })).json();
  assert.deepStrictEqual(meA, { username: 'ilham', displayName: 'Ilham', role: 'admin' });
  assert.deepStrictEqual(meB, { username: 'irfan', displayName: 'Irfan', role: 'member' });
  assert.strictEqual((await srv.request('/', { headers: { cookie: a.cookie } })).status, 200);
});

test('session cookie is HttpOnly and SameSite=Lax, and Secure behind https', async () => {
  const plain = await srv.login('ilham', ILHAM.password, { 'CF-Connecting-IP': '203.0.113.20' });
  const sc = plain.res.headers.get('set-cookie');
  assert.match(sc, /^hgchat_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  const tls = await srv.login('ilham', ILHAM.password, { 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': '203.0.113.21' });
  assert.match(tls.res.headers.get('set-cookie'), /; Secure$/);
});

test('wrong password is 401 and sets no cookie', async () => {
  const r = await srv.login('irfan', 'not-the-password', { 'CF-Connecting-IP': '203.0.113.30' });
  assert.strictEqual(r.res.status, 401);
  assert.strictEqual(r.res.headers.get('set-cookie'), null);
});

test('6th failed attempt within the window is 429 with Retry-After', async () => {
  const ip = { 'CF-Connecting-IP': '198.51.100.7' };
  for (let i = 1; i <= 5; i++) assert.strictEqual((await srv.login('cahyo', 'bad-guess-' + i, ip)).res.status, 401);
  const blocked = await srv.login('cahyo', CAHYO.password, ip);
  assert.strictEqual(blocked.res.status, 429, 'even the right password is refused while blocked');
  assert.ok(Number(blocked.res.headers.get('retry-after')) > 0);
  // The username is throttled too, from any IP.
  const otherIp = await srv.login('cahyo', CAHYO.password, { 'CF-Connecting-IP': '198.51.100.8' });
  assert.strictEqual(otherIp.res.status, 429);
  // Other accounts from other IPs are unaffected.
  assert.strictEqual((await srv.login('irfan', IRFAN.password, { 'CF-Connecting-IP': '198.51.100.9' })).res.status, 200);
});

test('logout deletes the session: the old cookie gets 401', async () => {
  const { cookie } = await srv.login('irfan', IRFAN.password, { 'CF-Connecting-IP': '203.0.113.40' });
  assert.strictEqual((await srv.request('/api/me', { headers: { cookie } })).status, 200);
  const out = await srv.request('/logout', { method: 'POST', headers: { cookie } });
  assert.strictEqual(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.strictEqual((await srv.request('/api/me', { headers: { cookie } })).status, 401);
});

test('CLI disable and revoke-sessions take effect on the very next request', async () => {
  const ip = { 'CF-Connecting-IP': '203.0.113.50' };
  let { cookie } = await srv.login('irfan', IRFAN.password, ip);
  cli(srv.dbPath, 'revoke-sessions', 'irfan');
  assert.strictEqual((await srv.request('/api/me', { headers: { cookie } })).status, 401);

  ({ cookie } = await srv.login('irfan', IRFAN.password, ip));
  cli(srv.dbPath, 'disable', 'irfan');
  assert.strictEqual((await srv.request('/api/me', { headers: { cookie } })).status, 401);
  assert.strictEqual((await srv.login('irfan', IRFAN.password, ip)).res.status, 401);
  cli(srv.dbPath, 'enable', 'irfan');
  assert.strictEqual((await srv.login('irfan', IRFAN.password, ip)).res.status, 200);
});

test('no CORS headers, no PIN, and no shared login left in what is served', async () => {
  const { cookie } = await srv.login('ilham', ILHAM.password, { 'CF-Connecting-IP': '203.0.113.60' });
  const page = await srv.request('/', { headers: { cookie, Origin: 'https://evil.example' } });
  assert.strictEqual(page.headers.get('access-control-allow-origin'), null);
  const preflight = await srv.request('/v1/chat/completions', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(preflight.headers.get('access-control-allow-origin'), null);
  const html = await page.text();
  const js = await (await srv.request('/app.js', { headers: { cookie } })).text();
  assert.ok(!/101010|CORRECT_PIN|pinPress|loginScreen/.test(html + js));
  // Basic auth with the old shared credentials does nothing now.
  const basic = await srv.request('/api/me', { headers: { Authorization: 'Basic ' + Buffer.from('ilham:ilham-password-1').toString('base64') } });
  assert.strictEqual(basic.status, 401);
});

test('logged-in visit to /login goes straight to the app', async () => {
  const { cookie } = await srv.login('ilham', ILHAM.password, { 'CF-Connecting-IP': '203.0.113.70' });
  const r = await srv.request('/login', { headers: { cookie } });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), '/');
});
