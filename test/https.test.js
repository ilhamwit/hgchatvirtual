// Login loop fix (2026-10-18): visitors on plain http are sent to https so the
// session cookie is always the Secure one, and the login page's logo loads
// without a session.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startServer } = require('./helpers');

const ILHAM = { username: 'ilham', displayName: 'Ilham', password: 'ilham-password-1' };
let srv;
test.before(async () => { srv = await startServer([ILHAM]); });
test.after(async () => { await srv.stop(); });

// Raw request so the Host header can be set (fetch forbids it).
function raw(method, path, headers) {
  const { port } = new URL(srv.base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end();
  });
}

test('http visitors behind Cloudflare are redirected to https, path and query kept', async () => {
  const viaCfVisitor = await raw('GET', '/login?next=x', { Host: 'agents.herrygunawan.com', 'CF-Visitor': '{"scheme":"http"}' });
  assert.strictEqual(viaCfVisitor.statusCode, 308);
  assert.strictEqual(viaCfVisitor.headers.location, 'https://agents.herrygunawan.com/login?next=x');
  const viaProto = await raw('GET', '/', { Host: 'agents.herrygunawan.com', 'X-Forwarded-Proto': 'http' });
  assert.strictEqual(viaProto.statusCode, 308);
  assert.strictEqual(viaProto.headers.location, 'https://agents.herrygunawan.com/');
});

test('CF-Visitor wins over X-Forwarded-Proto', async () => {
  const r = await raw('GET', '/login', { Host: 'agents.herrygunawan.com', 'CF-Visitor': '{"scheme":"http"}', 'X-Forwarded-Proto': 'https' });
  assert.strictEqual(r.statusCode, 308);
});

test('a login POST over http is redirected (308 keeps the method) and sets no cookie', async () => {
  const r = await srv.login('ilham', ILHAM.password, { 'X-Forwarded-Proto': 'http' });
  assert.strictEqual(r.res.status, 308);
  assert.strictEqual(r.res.headers.get('set-cookie'), null);
});

test('https visitors and direct local requests are served as before', async () => {
  const tls = await srv.login('ilham', ILHAM.password, { 'CF-Visitor': '{"scheme":"https"}' });
  assert.strictEqual(tls.res.status, 200);
  assert.match(tls.res.headers.get('set-cookie'), /; Secure$/, 'Secure follows CF-Visitor too');
  const local = await raw('GET', '/login', { Host: '127.0.0.1' });
  assert.strictEqual(local.statusCode, 200);
});

test('a malformed Host is never echoed into a redirect', async () => {
  const r = await raw('GET', '/login', { Host: 'evil.example/phish?', 'X-Forwarded-Proto': 'http' });
  assert.notStrictEqual(r.statusCode, 308);
});

test('the login page logo loads without a session; agent photos do not', async () => {
  const logo = await srv.request('/assets/hg-logo.png');
  assert.strictEqual(logo.status, 200);
  assert.strictEqual(logo.headers.get('content-type'), 'image/png');
  const photo = await srv.request('/assets/agents/dave.jpg');
  assert.strictEqual(photo.status, 302);
});
