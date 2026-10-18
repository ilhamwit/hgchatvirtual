#!/usr/bin/env node
// Daily backup of the Chat Center database (EPIC-005 T-027).
//
//   node scripts/backup.js                 make a backup, verify it, prune old ones
//   node scripts/backup.js --verify FILE   check that FILE is a usable backup
//
// The snapshot comes from `VACUUM INTO` on a read-only connection: consistent
// even while the server writes (WAL), and it never migrates or touches the
// live database. Each backup is checked (integrity_check + row counts) before
// old ones are pruned, so a broken run can never delete the good copies.
//
// Env: CHAT_DB_PATH (default data/chat-center.db), CHAT_BACKUP_DIR (default
// data/backups), CHAT_BACKUP_KEEP_DAYS (default 14), CHAT_BACKUP_COPY_DIR
// (optional second location, e.g. a synced folder; pruned the same way).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_DB_PATH } = require('../lib/db');

const NAME_RE = /^chat-center-(\d{8})-(\d{6})\.db$/;
const TABLES = ['users', 'conversations', 'messages'];

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function counts(db) {
  const out = {};
  for (const t of TABLES) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    out[t] = exists ? db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : 0;
  }
  return out;
}

// Opens a backup read-only and reports whether it is usable.
function verify(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const version = db.prepare('PRAGMA user_version').get().user_version;
    return { ok: integrity === 'ok', integrity, schema: version, counts: counts(db) };
  } finally {
    db.close();
  }
}

// Deletes chat-center-*.db files in `dir` older than `keepDays`, judged by the
// timestamp in the name (mtimes change when files are copied around).
function prune(dir, keepDays, now = new Date()) {
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const m = name.match(NAME_RE);
    if (!m) continue;
    const [, d, t] = m;
    const when = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
    if (when.getTime() < cutoff) { fs.unlinkSync(path.join(dir, name)); removed.push(name); }
  }
  return removed;
}

function backup({
  src = process.env.CHAT_DB_PATH || DEFAULT_DB_PATH,
  dir = process.env.CHAT_BACKUP_DIR || path.join(path.dirname(DEFAULT_DB_PATH), 'backups'),
  keepDays = Number(process.env.CHAT_BACKUP_KEEP_DAYS || 14),
  copyDir = process.env.CHAT_BACKUP_COPY_DIR || '',
  now = new Date()
} = {}) {
  if (!fs.existsSync(src)) throw new Error(`database not found: ${src}`);
  if (!Number.isInteger(keepDays) || keepDays < 1) throw new Error('CHAT_BACKUP_KEEP_DAYS must be a whole number of days >= 1');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `chat-center-${stamp(now)}.db`);
  if (fs.existsSync(file)) throw new Error(`backup already exists: ${file}`);

  const live = new DatabaseSync(src, { readOnly: true });
  try {
    live.exec('PRAGMA busy_timeout = 5000');
    live.prepare('VACUUM INTO ?').run(file);
  } finally {
    live.close();
  }
  fs.chmodSync(file, 0o600); // holds password hashes and every team chat

  const check = verify(file);
  if (!check.ok) throw new Error(`backup failed integrity_check (${check.integrity}): ${file}`);

  let copy = null;
  if (copyDir) {
    fs.mkdirSync(copyDir, { recursive: true, mode: 0o700 });
    copy = path.join(copyDir, path.basename(file));
    fs.copyFileSync(file, copy);
    fs.chmodSync(copy, 0o600);
  }

  // Prune only after this run's backup is known good.
  const removed = prune(dir, keepDays, now);
  if (copyDir) removed.push(...prune(copyDir, keepDays, now).map((n) => path.join(copyDir, n)));
  return { file, copy, size: fs.statSync(file).size, ...check, removed };
}

function main(argv) {
  if (argv[0] === '--verify') {
    if (!argv[1]) throw new Error('usage: node scripts/backup.js --verify FILE');
    const r = verify(argv[1]);
    console.log(`${r.ok ? 'OK' : 'BROKEN'} ${argv[1]} schema v${r.schema} ` +
      TABLES.map((t) => `${t}=${r.counts[t]}`).join(' '));
    return r.ok ? 0 : 1;
  }
  const r = backup();
  console.log(`backup OK ${r.file} (${Math.round(r.size / 1024)} KB, schema v${r.schema}, ` +
    TABLES.map((t) => `${t}=${r.counts[t]}`).join(' ') + ')' +
    (r.copy ? ` copy=${r.copy}` : '') + (r.removed.length ? ` pruned=${r.removed.length}` : ''));
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error('backup FAILED: ' + err.message);
    process.exit(1);
  }
}

module.exports = { backup, verify, prune, stamp };
