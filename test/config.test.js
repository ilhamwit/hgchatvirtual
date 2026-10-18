// EPIC-000 T-004 / EPIC-001: server.js must refuse to start with missing or
// invalid config, or with no account to log in with.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { freePort, tempDir, seedDb, runServer } = require('./helpers');

const ADMIN = { username: 'admin', password: 'admin-password-1', role: 'admin' };

async function dbWith(users) {
  const dir = tempDir();
  const file = await seedDb(path.join(dir, 't.db'), users);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function start(env) {
  const r = await runServer({ CHAT_PORT: String(await freePort()), ...env });
  await r.stop();
  return r;
}

test('refuses to start without GATEWAY_TOKEN and names it', async () => {
  const db = await dbWith([ADMIN]);
  const r = await start({ CHAT_DB_PATH: db.file });
  db.cleanup();
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /missing required env GATEWAY_TOKEN/);
});

test('refuses to start in production with no active users', async () => {
  const db = await dbWith([]);
  const r = await start({ GATEWAY_TOKEN: 't', CHAT_DB_PATH: db.file });
  db.cleanup();
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /no active users — create one with: node scripts\/users\.js add/);
});

test('rejects a non-numeric port', async () => {
  const r = await runServer({ GATEWAY_TOKEN: 't', CHAT_PORT: 'eighty' });
  await r.stop();
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /CHAT_PORT must be an integer/);
});

test('starts with a gateway token and at least one user', async () => {
  const db = await dbWith([ADMIN]);
  const r = await start({ GATEWAY_TOKEN: 't', CHAT_DB_PATH: db.file });
  db.cleanup();
  assert.ok(r.listening, r.out);
});

test('CHAT_DEV=1 starts with nothing set and warns that there are no users', async () => {
  const db = await dbWith([]);
  const r = await start({ CHAT_DEV: '1', CHAT_DB_PATH: db.file });
  db.cleanup();
  assert.ok(r.listening, r.out);
  assert.match(r.out, /Warning: no active users/);
});
