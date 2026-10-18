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
   CREATE INDEX sessions_expires ON sessions(expires_at);`,

  // 2 — EPIC-002: server-side conversations. One conversation = one user + one
  // agent + one agent-backend session (Hermes since EPIC-007). import_key makes the browser-history import
  // idempotent per user.
  `CREATE TABLE conversations (
     id          TEXT PRIMARY KEY,
     user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     agent_id    TEXT NOT NULL,
     title       TEXT NOT NULL DEFAULT '',
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL,
     archived    INTEGER NOT NULL DEFAULT 0,
     import_key  TEXT,
     UNIQUE (user_id, import_key)
   );
   CREATE INDEX conversations_user ON conversations(user_id, updated_at);
   CREATE TABLE messages (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
     content          TEXT NOT NULL,
     attachments_json TEXT,
     created_at       INTEGER NOT NULL
   );
   CREATE INDEX messages_conversation ON messages(conversation_id, id);`,

  // 3 — EPIC-005: security audit trail (logins, account changes). No foreign
  // key on purpose: failed logins name users that may not exist.
  `CREATE TABLE audit_log (
     id        INTEGER PRIMARY KEY AUTOINCREMENT,
     at        INTEGER NOT NULL,
     event     TEXT NOT NULL,
     username  TEXT,
     ip        TEXT,
     detail    TEXT
   );
   CREATE INDEX audit_log_at ON audit_log(at);`,

  // 4 — EPIC-008: WhatsApp group messages indexed from Hermes' archive (read
  // only; the JSONL file stays Hermes'), group names from the bridge, and
  // on-demand summaries.
  `CREATE TABLE wa_messages (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     chat_id        TEXT NOT NULL,
     ts             INTEGER NOT NULL,
     sender_id      TEXT,
     sender_number  TEXT,
     sender_name    TEXT,
     body           TEXT NOT NULL DEFAULT '',
     has_media      INTEGER NOT NULL DEFAULT 0,
     media_type     TEXT,
     from_me        INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX wa_messages_chat ON wa_messages(chat_id, ts);
   -- Re-reading the archive (rotated or rewritten file) must not duplicate.
   CREATE UNIQUE INDEX wa_messages_dedup ON wa_messages(chat_id, ts, sender_id, body);
   CREATE TABLE wa_groups (
     chat_id       TEXT PRIMARY KEY,
     name          TEXT,
     participants  INTEGER,
     checked_at    INTEGER
   );
   CREATE TABLE wa_archive_state (
     path      TEXT PRIMARY KEY,
     ino       INTEGER,
     offset    INTEGER NOT NULL,
     head      TEXT,               -- sha1 of the first head_len bytes: a rotated
     head_len  INTEGER             -- file can reuse the inode, not its contents
   );
   CREATE TABLE wa_summaries (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     chat_id        TEXT NOT NULL,
     from_ts        INTEGER NOT NULL,
     to_ts          INTEGER NOT NULL,
     agent_id       TEXT NOT NULL,
     user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
     status         TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
     message_count  INTEGER NOT NULL DEFAULT 0,
     content        TEXT,
     error          TEXT,
     created_at     INTEGER NOT NULL,
     finished_at    INTEGER
   );
   CREATE INDEX wa_summaries_chat ON wa_summaries(chat_id, created_at);`,

  // v5 — EPIC-009 Schedule: team events/meetings, the agenda Aurix writes,
  // and the outbox of WhatsApp messages (agenda sends + reminders) the bot
  // delivers. Nothing enters the outbox until a person presses "Kirim".
  `CREATE TABLE events (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     title          TEXT NOT NULL,
     starts_at      INTEGER NOT NULL,
     duration_min   INTEGER NOT NULL DEFAULT 60,
     location       TEXT,
     attendees      TEXT,
     notes          TEXT,
     agenda         TEXT,
     agenda_status  TEXT NOT NULL DEFAULT 'none' CHECK (agenda_status IN ('none', 'running', 'done', 'error')),
     agenda_error   TEXT,
     agenda_runs    INTEGER NOT NULL DEFAULT 0,
     agenda_at      INTEGER,
     groups         TEXT NOT NULL DEFAULT '[]',   -- JSON array of WhatsApp group ids
     reminders      TEXT NOT NULL DEFAULT '[]',   -- JSON array of reminder keys (d1, d0, m60, …)
     created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
     sent_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at     INTEGER NOT NULL,
     updated_at     INTEGER NOT NULL,
     sent_at        INTEGER,
     cancelled_at   INTEGER
   );
   CREATE INDEX events_start ON events(starts_at);
   CREATE TABLE event_messages (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     chat_id     TEXT NOT NULL,
     kind        TEXT NOT NULL CHECK (kind IN ('agenda', 'reminder', 'cancel')),
     reminder    TEXT,
     body        TEXT,                 -- fixed when queued (agenda / cancel); reminders are written at send time
     due_at      INTEGER NOT NULL,
     status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'error', 'skipped')),
     attempts    INTEGER NOT NULL DEFAULT 0,
     error       TEXT,
     sent_at     INTEGER,
     created_at  INTEGER NOT NULL
   );
   CREATE INDEX event_messages_due ON event_messages(status, due_at);
   CREATE INDEX event_messages_event ON event_messages(event_id);`,

  // v6 — EPIC-010 Task Focus: team tasks, visible to the whole team, and their
  // activity (comments + a readable history of every change).
  `CREATE TABLE tasks (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     title        TEXT NOT NULL,
     notes        TEXT,
     assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
     due_date     TEXT,                 -- YYYY-MM-DD (WIB), optional
     priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
     status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
     created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
     done_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL,
     done_at      INTEGER
   );
   CREATE INDEX tasks_assignee ON tasks(assignee_id, status);
   CREATE INDEX tasks_status ON tasks(status, due_date);
   CREATE TABLE task_activity (
     id        INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
     kind      TEXT NOT NULL CHECK (kind IN ('created', 'changed', 'comment')),
     body      TEXT NOT NULL,
     at        INTEGER NOT NULL
   );
   CREATE INDEX task_activity_task ON task_activity(task_id, at);`,

  // v7 — EPIC-012 Chat & Discussion: team channels (open to everyone) and
  // direct messages (only their two members), threads, mentions, and how far
  // each person has read each room.
  `CREATE TABLE rooms (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     kind        TEXT NOT NULL CHECK (kind IN ('channel', 'dm')),
     name        TEXT,                 -- channel: unique slug; dm: NULL
     topic       TEXT,
     dm_key      TEXT UNIQUE,          -- dm: "<lowId>:<highId>"
     created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at  INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX rooms_channel_name ON rooms(name) WHERE kind = 'channel';
   CREATE TABLE room_members (           -- dm only: channels are open to all
     room_id  INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     PRIMARY KEY (room_id, user_id)
   );
   CREATE TABLE room_messages (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     room_id           INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
     parent_id         INTEGER REFERENCES room_messages(id) ON DELETE CASCADE,
     body              TEXT NOT NULL DEFAULT '',
     attachments_json  TEXT,
     created_at        INTEGER NOT NULL,
     edited_at         INTEGER,
     deleted_at        INTEGER
   );
   CREATE INDEX room_messages_room ON room_messages(room_id, parent_id, id);
   CREATE INDEX room_messages_parent ON room_messages(parent_id, id);
   CREATE TABLE room_mentions (
     message_id  INTEGER NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
     user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     PRIMARY KEY (message_id, user_id)
   );
   CREATE INDEX room_mentions_user ON room_mentions(user_id, message_id);
   CREATE TABLE room_reads (
     room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     last_read_id  INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (room_id, user_id)
   );
   INSERT INTO rooms (kind, name, topic, created_at)
     VALUES ('channel', 'umum', 'Obrolan umum tim', CAST(strftime('%s', 'now') AS INTEGER) * 1000);`,

  // v8 — EPIC-012 stage 2: agents answer in discussions (@dave), and Aurix
  // can post a summary. Such a message has no user_id but an agent_id.
  `ALTER TABLE room_messages ADD COLUMN agent_id TEXT;`
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
