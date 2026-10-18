// SQLite storage (node:sqlite, built into Node >= 22.5 — no dependency).
// Schema changes are numbered migrations tracked in PRAGMA user_version:
// append to MIGRATIONS, never edit an entry that has shipped.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'chat-center.db');

const MIGRATIONS = [
  // 1 — EPIC-001: per-person accounts and revocable sessions.
  `CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     username      TEXT NOT NULL UNIQUE,
     display_name  TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
     disabled      INTEGER NOT NULL DEFAULT 0,
     created_at    INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash  TEXT PRIMARY KEY,
     user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at  INTEGER NOT NULL,
     expires_at  INTEGER NOT NULL,
     last_seen   INTEGER NOT NULL,
     user_agent  TEXT
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE INDEX sessions_expires ON sessions(expires_at);`
];

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(`database schema v${current} is newer than this code (v${MIGRATIONS.length})`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function openDb(dbPath = process.env.CHAT_DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') fs.chmodSync(dbPath, 0o600); // holds password hashes
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

module.exports = { openDb, DEFAULT_DB_PATH, SCHEMA_VERSION: MIGRATIONS.length };
