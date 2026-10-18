// Accounts, password hashing, sessions and login throttling (EPIC-001).
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;
const MIN_PASSWORD = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000; // throttle last_seen writes

// scrypt cost: N=2^15 is ~100 ms here — slow for guessing, fine for a login.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const scryptOpts = (N, r, p) => ({ N, r, p, maxmem: 128 * N * r * 2 });

// --- passwords ------------------------------------------------------------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, scryptOpts(SCRYPT.N, SCRYPT.r, SCRYPT.p));
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, scryptOpts(+N, +r, +p));
  return crypto.timingSafeEqual(actual, expected);
}

// Verifying against this when the username is unknown keeps the response time
// the same, so timing does not reveal which usernames exist.
let dummyHash = null;
async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

function validateUsername(username) {
  if (!USERNAME_RE.test(username)) {
    throw new Error('username must be 2-32 chars of a-z, 0-9, ".", "_" or "-" (lowercase)');
  }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
  }
}

// --- users ----------------------------------------------------------------

function publicUser(row) {
  return row && {
    id: row.id, username: row.username, displayName: row.display_name,
    role: row.role, disabled: !!row.disabled, createdAt: row.created_at
  };
}

async function createUser(db, { username, displayName, password, role = 'member' }) {
  username = String(username || '').trim().toLowerCase();
  validateUsername(username);
  validatePassword(password);
  if (!['admin', 'member'].includes(role)) throw new Error('role must be admin or member');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new Error(`user "${username}" already exists`);
  }
  const hash = await hashPassword(password);
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(username, String(displayName || username).trim() || username, hash, role, Date.now());
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid));
}

function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
}

function requireUser(db, username) {
  const row = getUserByUsername(db, username);
  if (!row) throw new Error(`no user "${username}"`);
  return row;
}

function listUsers(db) {
  return db.prepare(`
    SELECT u.*, COUNT(s.token_hash) AS active_sessions, MAX(s.last_seen) AS last_seen
      FROM users u LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > ?
     GROUP BY u.id ORDER BY u.username`).all(Date.now())
    .map((r) => ({ ...publicUser(r), activeSessions: r.active_sessions, lastSeen: r.last_seen }));
}

function countActiveUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 0').get().n;
}

// Disabling also ends every session, so access stops on the next request.
function setDisabled(db, username, disabled) {
  const user = requireUser(db, username);
  db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
  if (disabled) revokeUserSessions(db, user.id);
}

async function setPassword(db, username, password) {
  const user = requireUser(db, username);
  validatePassword(password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
  revokeUserSessions(db, user.id);
}

// Returns the user on success, null on any failure (unknown, disabled, wrong password).
async function authenticate(db, username, password) {
  const row = getUserByUsername(db, username);
  const ok = await verifyPassword(String(password || ''), row ? row.password_hash : await getDummyHash());
  if (!row || !ok || row.disabled) return null;
  return publicUser(row);
}

// --- sessions -------------------------------------------------------------
// The cookie carries a random token; the database stores only its SHA-256, so
// a leaked database cannot be replayed as cookies.

const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function createSession(db, userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(tokenHash(token), userId, now, now + SESSION_TTL_MS, now, String(userAgent || '').slice(0, 200));
  return token;
}

// Returns the session's user, or null if the token is unknown, expired, or the
// user is disabled.
function getSessionUser(db, token) {
  if (!token) return null;
  const now = Date.now();
  const row = db.prepare(`
    SELECT u.*, s.token_hash, s.expires_at, s.last_seen AS s_last_seen
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`).get(tokenHash(token));
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  if (row.disabled) return null;
  if (now - row.s_last_seen > TOUCH_EVERY_MS) {
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, row.token_hash);
  }
  return publicUser(row);
}

function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

function revokeUserSessions(db, userId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

function purgeExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).changes;
}

// --- login throttling -----------------------------------------------------
// In memory on purpose: one process, and a restart forgetting old failures is
// acceptable. Keys are "ip:<addr>" and "user:<name>".

function createRateLimiter({ max = 5, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const failures = new Map();
  const recent = (key) => {
    const cutoff = now() - windowMs;
    const list = (failures.get(key) || []).filter((t) => t > cutoff);
    if (list.length) failures.set(key, list); else failures.delete(key);
    return list;
  };
  return {
    // Seconds until the key may try again, or 0 if it is not limited.
    retryAfter(key) {
      const list = recent(key);
      return list.length >= max ? Math.ceil((list[0] + windowMs - now()) / 1000) : 0;
    },
    fail(key) { failures.set(key, [...recent(key), now()]); },
    reset(key) { failures.delete(key); }
  };
}

module.exports = {
  MIN_PASSWORD, SESSION_TTL_MS,
  hashPassword, verifyPassword, validatePassword,
  createUser, getUserByUsername, listUsers, countActiveUsers, setDisabled, setPassword, authenticate,
  createSession, getSessionUser, deleteSession, revokeUserSessions, purgeExpiredSessions,
  createRateLimiter
};
