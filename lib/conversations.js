// Conversations and messages (EPIC-002). Every read and write takes the
// owner's user id: a conversation that belongs to someone else behaves
// exactly like one that does not exist.
const crypto = require('crypto');

const MAX_TITLE = 80;
const MAX_IMPORT_MESSAGES = 2000;

function title(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TITLE ? flat.slice(0, MAX_TITLE - 1) + '…' : flat;
}

function toConversation(row) {
  return row && {
    id: row.id, agentId: row.agent_id, title: row.title,
    createdAt: row.created_at, updatedAt: row.updated_at, archived: !!row.archived,
    lastMessage: row.last_content === undefined || row.last_content === null ? null
      : { role: row.last_role, content: row.last_content, createdAt: row.last_at }
  };
}

function toMessage(row) {
  return {
    id: row.id, role: row.role, content: row.content,
    attachments: row.attachments_json ? JSON.parse(row.attachments_json) : [],
    createdAt: row.created_at
  };
}

function create(db, userId, agentId, now = Date.now()) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO conversations (id, user_id, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, agentId, now, now);
  return get(db, userId, id);
}

const LIST_SQL = `
  SELECT c.*, m.role AS last_role, m.content AS last_content, m.created_at AS last_at
    FROM conversations c
    LEFT JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
   WHERE c.user_id = ?`;

function get(db, userId, id) {
  return toConversation(db.prepare(LIST_SQL + ' AND c.id = ?').get(userId, String(id)));
}

function list(db, userId, { agentId, includeArchived = false } = {}) {
  let sql = LIST_SQL;
  const args = [userId];
  if (agentId) { sql += ' AND c.agent_id = ?'; args.push(agentId); }
  if (!includeArchived) sql += ' AND c.archived = 0';
  return db.prepare(sql + ' ORDER BY c.updated_at DESC, c.created_at DESC').all(...args).map(toConversation);
}

// Only title and archived can change. Returns the updated conversation, or
// null if it is not the user's.
function update(db, userId, id, { title: newTitle, archived } = {}) {
  if (!get(db, userId, id)) return null;
  if (newTitle !== undefined) db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title(newTitle), id);
  if (archived !== undefined) db.prepare('UPDATE conversations SET archived = ? WHERE id = ?').run(archived ? 1 : 0, id);
  return get(db, userId, id);
}

function messages(db, userId, id) {
  if (!get(db, userId, id)) return null;
  return db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(id).map(toMessage);
}

// Appends a message and bumps the conversation. The first user message names
// an untitled conversation.
function addMessage(db, conversationId, { role, content, attachments, createdAt = Date.now() }) {
  const att = attachments && attachments.length ? JSON.stringify(attachments) : null;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO messages (conversation_id, role, content, attachments_json, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(conversationId, role, String(content), att, createdAt);
  db.prepare('UPDATE conversations SET updated_at = MAX(updated_at, ?) WHERE id = ?').run(createdAt, conversationId);
  if (role === 'user') {
    const named = title(content) || title((attachments || []).map((a) => a.name).join(', '));
    db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND title = ''").run(named, conversationId);
  }
  return toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(lastInsertRowid));
}

function lastMessage(db, conversationId) {
  const row = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversationId);
  return row ? toMessage(row) : null;
}

function lastUserMessage(db, conversationId) {
  const row = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1").get(conversationId);
  return row ? toMessage(row) : null;
}

// Imports the old per-browser history ({ agentId: [{role:'u'|'a', text, ts, att}] })
// as one conversation per agent. Re-importing the same history is a no-op.
function importBrowserHistory(db, userId, history, allowedAgents) {
  const result = { imported: 0, skipped: 0, messages: 0 };
  db.exec('BEGIN');
  try {
    for (const [agentId, list] of Object.entries(history || {})) {
      if (!allowedAgents.includes(agentId) || !Array.isArray(list) || !list.length) continue;
      const msgs = list.slice(-MAX_IMPORT_MESSAGES)
        .filter((m) => m && (m.role === 'u' || m.role === 'a') && typeof m.text === 'string');
      if (!msgs.length) continue;
      const key = 'browser:' + agentId + ':' + crypto.createHash('sha256')
        .update(JSON.stringify(msgs.map((m) => [m.role, m.text, m.ts || 0]))).digest('hex');
      if (db.prepare('SELECT 1 FROM conversations WHERE user_id = ? AND import_key = ?').get(userId, key)) {
        result.skipped++;
        continue;
      }
      const first = msgs[0].ts || Date.now();
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO conversations (id, user_id, agent_id, title, created_at, updated_at, import_key)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, userId, agentId, 'Riwayat lama (browser)', first, first, key);
      for (const m of msgs) {
        const att = Array.isArray(m.att) ? m.att.map((a) => ({ name: String(a.name || ''), size: Number(a.size) || 0 })) : [];
        addMessage(db, id, { role: m.role === 'u' ? 'user' : 'assistant', content: m.text, attachments: att, createdAt: m.ts || first });
      }
      result.imported++;
      result.messages += msgs.length;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return result;
}

module.exports = { create, get, list, update, messages, addMessage, lastMessage, lastUserMessage, importBrowserHistory };
