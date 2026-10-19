// Settings (EPIC-014): team accounts for admins, system status, and a
// person's own password change. Same tables and helpers as scripts/users.js,
// so the terminal and the web never disagree.
//
// A new or reset password is generated here and shown to the admin once; it
// is never stored in clear and never typed by the admin.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const auth = require('./auth');
const { SCHEMA_VERSION, DEFAULT_DB_PATH } = require('./db');

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const badRequest = (msg) => httpError(400, msg);
// 14 characters from an unambiguous alphabet (no 0/O, 1/l/I).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const tempPassword = () => Array.from(crypto.randomBytes(14), (b) => ALPHABET[b % ALPHABET.length]).join('');

function createSettings({
  db, onEvent = () => {}, whatsapp = null, gatewayUrl = 'http://127.0.0.1:8642',
  dbPath = process.env.CHAT_DB_PATH || DEFAULT_DB_PATH,
  backupDir = process.env.CHAT_BACKUP_DIR || path.join(path.dirname(process.env.CHAT_DB_PATH || DEFAULT_DB_PATH), 'backups'),
  root = path.join(__dirname, '..'), startedAt = Date.now()
}) {
  const wrap = (fn) => { try { return fn(); } catch (e) { throw badRequest(e.message); } };
  const act = (event, actor, target, detail) => onEvent(event, target, `by ${actor.username} (web)${detail ? ', ' + detail : ''}`);
  const requireOther = (actor, username) => { if (username === actor.username) throw badRequest('tidak bisa untuk akun sendiri'); };
  const adminsLeft = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n;

  const users = () => auth.listUsers(db);

  async function addUser(actor, { username, displayName, role } = {}) {
    const password = tempPassword();
    const user = await (async () => { try { return await auth.createUser(db, { username, displayName, password, role: role === 'admin' ? 'admin' : 'member' }); } catch (e) { throw badRequest(e.message); } })();
    act('user_added', actor, user.username, user.role);
    return { user, tempPassword: password };
  }

  function setRole(actor, username, role) {
    requireOther(actor, username);
    const before = wrap(() => auth.getUserByUsername(db, username));
    if (!before) throw httpError(404, 'akun tidak ditemukan');
    if (before.role === 'admin' && role !== 'admin' && adminsLeft() <= 1) throw badRequest('ini admin terakhir');
    const was = wrap(() => auth.setRole(db, username, role));
    if (was !== role) act('role_changed', actor, username, `${was} -> ${role}`);
    return users().find((u) => u.username === username);
  }

  function setDisabled(actor, username, disabled) {
    requireOther(actor, username);
    const u = auth.getUserByUsername(db, username);
    if (!u) throw httpError(404, 'akun tidak ditemukan');
    if (disabled && u.role === 'admin' && !u.disabled && adminsLeft() <= 1) throw badRequest('ini admin terakhir');
    wrap(() => auth.setDisabled(db, username, !!disabled));
    act(disabled ? 'user_disabled' : 'user_enabled', actor, username);
    return users().find((x) => x.username === username);
  }

  async function resetPassword(actor, username) {
    requireOther(actor, username);
    const password = tempPassword();
    try { await auth.setPassword(db, username, password); } catch (e) { throw e.message.startsWith('no user') ? httpError(404, 'akun tidak ditemukan') : badRequest(e.message); }
    act('password_reset', actor, username);
    return { tempPassword: password };
  }

  function revokeSessions(actor, username) {
    const u = auth.getUserByUsername(db, username);
    if (!u) throw httpError(404, 'akun tidak ditemukan');
    const n = auth.revokeUserSessions(db, u.id);
    act('sessions_revoked', actor, username, `${n} session(s)`);
    return { ended: n };
  }

  // One's own password. setPassword ends every session, so a fresh token is
  // returned for this browser; the caller puts it in the cookie.
  async function changeOwnPassword(user, { current, next } = {}, userAgent) {
    const ok = await auth.authenticate(db, user.username, String(current || ''));
    if (!ok) throw badRequest('password lama salah');
    try { auth.validatePassword(String(next || '')); } catch (e) { throw badRequest(`password baru minimal ${auth.MIN_PASSWORD} karakter`); }
    if (String(next) === String(current)) throw badRequest('password baru sama dengan yang lama');
    await auth.setPassword(db, user.username, String(next));
    onEvent('password_changed', user.username, 'by self (web)');
    return { token: auth.createSession(db, user.id, userAgent) };
  }

  function version() {
    try { return execFileSync('git', ['-C', root, 'log', '-1', '--format=%h %cs'], { encoding: 'utf8', timeout: 3000 }).trim(); } catch (e) { return null; }
  }
  function lastBackup() {
    try {
      const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).map((f) => ({ f, st: fs.statSync(path.join(backupDir, f)) }))
        .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
      return files.length ? { file: files[0].f, at: files[0].st.mtimeMs, size: files[0].st.size, count: files.length } : null;
    } catch (e) { return null; }
  }
  async function probe(url, ms = 3000) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok ? 'ok' : 'error'; } catch (e) { return 'unreachable'; }
  }

  async function status() {
    let dbSize = null;
    try { dbSize = fs.statSync(dbPath).size + (fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0); } catch (e) { /* unknown */ }
    const counts = {
      users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 0').get().n,
      sessions: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?').get(Date.now()).n,
      conversations: db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n,
      messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
      events: db.prepare('SELECT COUNT(*) AS n FROM events').get().n,
      tasks: db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,
      roomMessages: db.prepare('SELECT COUNT(*) AS n FROM room_messages').get().n
    };
    let wa = null;
    if (whatsapp) { try { const s = await whatsapp.status(); wa = { bridge: s.bridge, phone: s.account ? s.account.phone : null, name: s.account ? s.account.name : null }; } catch (e) { wa = { bridge: 'error' }; } }
    return {
      version: version(), schema: SCHEMA_VERSION, node: process.version, pid: process.pid,
      startedAt, uptimeSec: Math.round((Date.now() - startedAt) / 1000), dbSize, counts,
      backup: lastBackup(), hermes: await probe(gatewayUrl + '/health'), whatsapp: wa
    };
  }

  return { users, addUser, setRole, setDisabled, resetPassword, revokeSessions, changeOwnPassword, status };
}

module.exports = { createSettings, tempPassword };
