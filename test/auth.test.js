// EPIC-001 T-006..T-009: accounts, password hashing, sessions, throttling.
const test = require('node:test');
const assert = require('node:assert');
const { openDb, SCHEMA_VERSION } = require('../lib/db');
const auth = require('../lib/auth');

const freshDb = () => openDb(':memory:');

test('migrations bring a new database to the current schema version', () => {
  const db = freshDb();
  assert.strictEqual(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});

test('passwords are stored as salted scrypt hashes, never plaintext', async () => {
  const db = freshDb();
  await auth.createUser(db, { username: 'ilham', password: 'correct horse battery' });
  const { password_hash: stored } = db.prepare('SELECT password_hash FROM users').get();
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!stored.includes('correct horse battery'));
  const again = await auth.hashPassword('correct horse battery');
  assert.notStrictEqual(again, stored, 'same password must hash differently (salt)');
});

test('authenticate accepts the right password and rejects everything else', async () => {
  const db = freshDb();
  await auth.createUser(db, { username: 'Irfan', displayName: 'Irfan', password: 'irfan-password-1' });
  assert.strictEqual((await auth.authenticate(db, 'irfan', 'irfan-password-1')).username, 'irfan');
  assert.strictEqual((await auth.authenticate(db, ' IRFAN ', 'irfan-password-1')).username, 'irfan');
  assert.strictEqual(await auth.authenticate(db, 'irfan', 'wrong-password-1'), null);
  assert.strictEqual(await auth.authenticate(db, 'nobody', 'irfan-password-1'), null);
  assert.strictEqual(await auth.authenticate(db, 'irfan', undefined), null);
});

test('createUser validates username, password and uniqueness', async () => {
  const db = freshDb();
  await assert.rejects(auth.createUser(db, { username: 'a', password: 'long-enough-pw' }), /username/);
  await assert.rejects(auth.createUser(db, { username: 'has space', password: 'long-enough-pw' }), /username/);
  await assert.rejects(auth.createUser(db, { username: 'cahyo', password: 'short' }), /at least 10/);
  await auth.createUser(db, { username: 'cahyo', password: 'long-enough-pw' });
  await assert.rejects(auth.createUser(db, { username: 'Cahyo', password: 'long-enough-pw' }), /already exists/);
});

test('sessions resolve to their user and end on logout', async () => {
  const db = freshDb();
  const u = await auth.createUser(db, { username: 'dave', password: 'dave-password-1' });
  const token = auth.createSession(db, u.id, 'test-agent');
  assert.strictEqual(auth.getSessionUser(db, token).username, 'dave');
  const stored = db.prepare('SELECT token_hash FROM sessions').get().token_hash;
  assert.notStrictEqual(stored, token, 'only the hash of the token is stored');
  auth.deleteSession(db, token);
  assert.strictEqual(auth.getSessionUser(db, token), null);
  assert.strictEqual(auth.getSessionUser(db, 'made-up-token'), null);
  assert.strictEqual(auth.getSessionUser(db, ''), null);
});

test('expired sessions are rejected and removed', async () => {
  const db = freshDb();
  const u = await auth.createUser(db, { username: 'joel', password: 'joel-password-1' });
  const token = auth.createSession(db, u.id);
  db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.strictEqual(auth.getSessionUser(db, token), null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('disabling a user, resetting a password, or revoking ends their sessions', async () => {
  const db = freshDb();
  const u = await auth.createUser(db, { username: 'nana', password: 'nana-password-1' });
  const other = await auth.createUser(db, { username: 'dylan', password: 'dylan-password-1' });
  const otherToken = auth.createSession(db, other.id);

  let token = auth.createSession(db, u.id);
  auth.setDisabled(db, 'nana', true);
  assert.strictEqual(auth.getSessionUser(db, token), null);
  assert.strictEqual(await auth.authenticate(db, 'nana', 'nana-password-1'), null, 'disabled users cannot log in');
  auth.setDisabled(db, 'nana', false);

  token = auth.createSession(db, u.id);
  await auth.setPassword(db, 'nana', 'new-password-123');
  assert.strictEqual(auth.getSessionUser(db, token), null);
  assert.ok(await auth.authenticate(db, 'nana', 'new-password-123'));

  token = auth.createSession(db, u.id);
  assert.strictEqual(auth.revokeUserSessions(db, u.id), 1);
  assert.strictEqual(auth.getSessionUser(db, token), null);

  assert.strictEqual(auth.getSessionUser(db, otherToken).username, 'dylan', 'other users are untouched');
});

test('rate limiter blocks after max failures and frees up after the window', () => {
  let t = 1_000_000;
  const rl = auth.createRateLimiter({ max: 5, windowMs: 60_000, now: () => t });
  for (let i = 0; i < 5; i++) { assert.strictEqual(rl.retryAfter('ip:1'), 0); rl.fail('ip:1'); }
  assert.strictEqual(rl.retryAfter('ip:1'), 60);
  assert.strictEqual(rl.retryAfter('ip:2'), 0, 'keys are independent');
  t += 30_000;
  assert.strictEqual(rl.retryAfter('ip:1'), 30);
  t += 30_001;
  assert.strictEqual(rl.retryAfter('ip:1'), 0);
  rl.fail('ip:1'); rl.reset('ip:1');
  assert.strictEqual(rl.retryAfter('ip:1'), 0);
});
