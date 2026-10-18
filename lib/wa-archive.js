// WhatsApp group reading and summaries (EPIC-008 T-043 Pilih Group, T-045
// Summary Chating).
//
// Source: the group archive the Hermes bridge writes when
// WHATSAPP_GROUP_ARCHIVE is set — one JSON line per inbound group message
// (~/.hermes/whatsapp/group_archive.jsonl). It is Hermes' file: we only read
// it, incrementally from the last byte offset, into our own wa_messages table.
// Group names come from the bridge's GET /chat/<id> and are cached.
//
// Known limits (explained to the owner on 2026-10-18): history starts when the
// archive was enabled; the bridge skips the bot's own group messages; media is
// a type label only; a group appears once it has a message in the archive.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const GROUP_RE = /^\d[\d-]*@g\.us$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 92;
const MAX_MESSAGES = 5000;
const CHUNK_CHARS = 20000;

const MEDIA_LABEL = {
  image: '[foto]', video: '[video]', audio: '[pesan suara]', ptt: '[pesan suara]',
  document: '[dokumen]', sticker: '[stiker]', location: '[lokasi]', contact: '[kontak]'
};

const pad = (n) => String(n).padStart(2, '0');
function fmtStamp(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function senderLabel(m) {
  return m.sender_name || (m.sender_number ? '+' + m.sender_number : 'Tidak dikenal');
}

// `fix` rewrites "@<lid>" mentions into names (see createWaArchive).
function messageText(m, fix = (t) => t) {
  const media = m.has_media ? (MEDIA_LABEL[m.media_type] || '[media]') : '';
  return [media, fix(m.body)].filter(Boolean).join(' ').trim();
}

function toPublic(m, fix = (t) => t) {
  return {
    id: m.id, ts: m.ts, sender: senderLabel(m), senderNumber: m.sender_number || null,
    body: fix(m.body), media: m.has_media ? (MEDIA_LABEL[m.media_type] || '[media]') : null,
    fromMe: !!m.from_me
  };
}

// 'YYYY-MM-DD' (server local time) -> start-of-day ms, or null.
function parseDay(s) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d.getTime() : null; // rejects 2026-02-31
}

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

function headHash(fd, len) {
  const b = Buffer.alloc(len);
  if (len) fs.readSync(fd, b, 0, len, 0);
  return crypto.createHash('sha1').update(b).digest('hex');
}

function createWaArchive({
  db, gateway, agents,
  archivePath = process.env.CHAT_WA_ARCHIVE || path.join(os.homedir(), '.hermes', 'whatsapp', 'group_archive.jsonl'),
  bridgeUrl = process.env.CHAT_WA_BRIDGE_URL || 'http://127.0.0.1:3010',
  // The bridge never archives the bot's own group messages; Hermes keeps its
  // replies in its session store, which we read (read-only) to show them.
  hermesStateDb = process.env.CHAT_HERMES_STATE_DB || path.join(os.homedir(), '.hermes', 'state.db'),
  // The WhatsApp session holds the bot's identity and the LID -> phone maps
  // used to turn "@<lid>" mentions into names.
  sessionDir = process.env.CHAT_WA_SESSION_DIR || path.join(os.homedir(), '.hermes', 'whatsapp', 'session'),
  chunkChars = CHUNK_CHARS
}) {
  // Summaries cut off by a restart can never finish.
  db.prepare("UPDATE wa_summaries SET status = 'error', error = 'Terhenti karena server di-restart.', finished_at = ? WHERE status = 'running'")
    .run(Date.now());

  const insert = db.prepare(`INSERT OR IGNORE INTO wa_messages
    (chat_id, ts, sender_id, sender_number, sender_name, body, has_media, media_type, from_me)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // ── Who is who: the bot, and "@<lid>" mentions ──
  let bot = { at: 0, value: null };
  function botIdentity() {
    if (Date.now() - bot.at < 60000) return bot.value;
    let value = null;
    try {
      const me = JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8')).me || {};
      const digits = (id) => String(id || '').split('@')[0].split(':')[0].replace(/\D+/g, '') || null;
      if (me.id) value = { name: me.name || null, phone: digits(me.id), lid: digits(me.lid) };
    } catch (e) { /* not paired */ }
    bot = { at: Date.now(), value };
    return value;
  }

  const mentionCache = new Map();
  function mentionName(token) {
    const me = botIdentity();
    if (me && (token === me.lid || token === me.phone)) return me.name || '+' + me.phone;
    const hit = mentionCache.get(token);
    if (hit && Date.now() - hit.at < 60000) return hit.label;
    let phone = null;
    try {
      // token is digits only (see the regex below), so this stays in sessionDir.
      const v = JSON.parse(fs.readFileSync(path.join(sessionDir, `lid-mapping-${token}_reverse.json`), 'utf8'));
      if (typeof v === 'string' && /^\d+$/.test(v)) phone = v;
    } catch (e) { /* no mapping for this LID */ }
    if (!phone && /^62\d{8,}$/.test(token)) phone = token; // an old-style phone mention
    let label = null;
    if (phone) {
      const r = db.prepare('SELECT sender_name FROM wa_messages WHERE sender_number = ? AND sender_name IS NOT NULL AND from_me = 0 ORDER BY ts DESC LIMIT 1').get(phone);
      label = r ? r.sender_name : '+' + phone;
    }
    mentionCache.set(token, { label, at: Date.now() });
    return label;
  }
  const withMentions = (text) => String(text || '').replace(/@(\d{6,})/g, (m, t) => {
    const name = mentionName(t);
    return name ? '@' + name : m;
  });

  function sync() {
    return syncArchive() + syncBotReplies();
  }

  // The bot's final replies in WhatsApp group sessions, from Hermes'
  // state.db (opened read-only), after the last one we imported.
  function syncBotReplies() {
    if (!fs.existsSync(hermesStateDb)) return 0;
    const key = 'hermes-state:' + hermesStateDb;
    const last = (db.prepare('SELECT offset FROM wa_archive_state WHERE path = ?').get(key) || {}).offset || 0;
    let src;
    let rows;
    try {
      src = new DatabaseSync(hermesStateDb, { readOnly: true });
      src.exec('PRAGMA busy_timeout = 3000');
      rows = src.prepare(`SELECT m.id, s.chat_id, m.content, m.timestamp
          FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE m.id > ? AND s.source = 'whatsapp' AND s.chat_type = 'group'
           AND m.role = 'assistant' AND m.finish_reason = 'stop' AND trim(coalesce(m.content, '')) <> ''
         ORDER BY m.id LIMIT 5000`).all(last);
    } catch (err) {
      return 0; // locked or a schema this code does not know: try again later
    } finally {
      if (src) src.close();
    }
    if (!rows.length) return 0;
    const me = botIdentity() || {};
    let added = 0;
    db.exec('BEGIN');
    try {
      for (const r of rows) {
        if (!GROUP_RE.test(String(r.chat_id)) || !Number.isFinite(r.timestamp)) continue;
        added += insert.run(r.chat_id, Math.round(r.timestamp * 1000), 'bot', me.phone || null, me.name || 'Bot',
          String(r.content), 0, null, 1).changes;
      }
      db.prepare(`INSERT INTO wa_archive_state (path, offset) VALUES (?, ?)
                  ON CONFLICT(path) DO UPDATE SET offset = excluded.offset`).run(key, rows[rows.length - 1].id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return added;
  }

  // Reads whatever the bridge appended since last time. Only complete lines
  // are consumed; a line still being written is picked up next time.
  function syncArchive() {
    let st;
    try { st = fs.statSync(archivePath); } catch (e) { return 0; }
    const row = db.prepare('SELECT ino, offset, head, head_len FROM wa_archive_state WHERE path = ?').get(archivePath);
    const fd = fs.openSync(archivePath, 'r');
    let buf;
    let offset;
    let head;
    let headLen;
    try {
      // Same file only if the inode matches, it has not shrunk, and its first
      // bytes are unchanged (rotation can hand the new file the old inode).
      const sameFile = row && row.ino === st.ino && row.offset <= st.size && row.head_len <= st.size &&
        headHash(fd, row.head_len) === row.head;
      offset = sameFile ? row.offset : 0;
      headLen = sameFile ? row.head_len : Math.min(256, st.size);
      head = sameFile ? row.head : headHash(fd, headLen);
      if (offset >= st.size) return 0;
      buf = Buffer.alloc(st.size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
    } finally {
      fs.closeSync(fd);
    }
    const end = buf.lastIndexOf(0x0a);
    if (end < 0) return 0;
    let added = 0;
    db.exec('BEGIN');
    try {
      for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
        let r;
        try { r = JSON.parse(line); } catch (e) { continue; }
        if (!r || !GROUP_RE.test(String(r.chatId)) || !Number.isFinite(r.ts)) continue;
        added += insert.run(r.chatId, r.ts, r.senderId || null, r.senderNumber || null, r.senderName || null,
          String(r.body || ''), r.hasMedia ? 1 : 0, r.mediaType || null, r.fromMe ? 1 : 0).changes;
      }
      offset += end + 1;
      db.prepare(`INSERT INTO wa_archive_state (path, ino, offset, head, head_len) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(path) DO UPDATE SET ino = excluded.ino, offset = excluded.offset, head = excluded.head, head_len = excluded.head_len`)
        .run(archivePath, st.ino, offset, head, headLen);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return added;
  }

  // Asks the bridge for group names it has not told us about recently. The
  // bridge answers with the bare id when it cannot resolve one.
  async function refreshNames(chatIds) {
    const now = Date.now();
    const stale = chatIds.filter((id) => {
      const g = db.prepare('SELECT name, checked_at FROM wa_groups WHERE chat_id = ?').get(id);
      return !g || !g.checked_at || now - g.checked_at > NAME_TTL_MS || !g.name;
    }).slice(0, 10);
    await Promise.all(stale.map(async (id) => {
      try {
        const r = await fetch(`${bridgeUrl}/chat/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(2000) });
        const j = await r.json();
        const name = j.name && j.name !== id.replace(/@.*/, '') ? String(j.name).slice(0, 200) : null;
        db.prepare(`INSERT INTO wa_groups (chat_id, name, participants, checked_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT(chat_id) DO UPDATE SET name = COALESCE(excluded.name, wa_groups.name),
                      participants = COALESCE(excluded.participants, wa_groups.participants), checked_at = excluded.checked_at`)
          .run(id, name, Array.isArray(j.participants) && j.participants.length ? j.participants.length : null, now);
      } catch (e) { /* bridge down: keep what we have, try again next time */ }
    }));
  }

  async function groups() {
    sync();
    const rows = db.prepare(`
      SELECT m.chat_id, COUNT(*) AS message_count, MAX(m.ts) AS last_ts, MIN(m.ts) AS first_ts
        FROM wa_messages m GROUP BY m.chat_id`).all();
    await refreshNames(rows.map((r) => r.chat_id));
    const last = db.prepare('SELECT * FROM wa_messages WHERE chat_id = ? ORDER BY ts DESC, id DESC LIMIT 1');
    const meta = db.prepare('SELECT name, participants FROM wa_groups WHERE chat_id = ?');
    return rows.map((r) => {
      const g = meta.get(r.chat_id) || {};
      const l = last.get(r.chat_id);
      return {
        id: r.chat_id, name: g.name || null, participants: g.participants || null,
        messageCount: r.message_count, firstTs: r.first_ts, lastTs: r.last_ts,
        last: l ? { sender: senderLabel(l), text: messageText(l, withMentions), fromMe: !!l.from_me } : null
      };
    }).sort((a, b) => b.lastTs - a.lastTs);
  }

  function requireGroup(chatId) {
    if (!GROUP_RE.test(String(chatId))) throw badRequest('bukan id grup WhatsApp');
    sync();
    if (!db.prepare('SELECT 1 FROM wa_messages WHERE chat_id = ? LIMIT 1').get(chatId)) return null;
    const g = db.prepare('SELECT name, participants FROM wa_groups WHERE chat_id = ?').get(chatId) || {};
    return { id: chatId, name: g.name || null, participants: g.participants || null };
  }

  // Newest page first in the query, returned oldest-first for display.
  function messages(chatId, { before, limit = 100 } = {}) {
    const group = requireGroup(chatId);
    if (!group) return null;
    const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const rows = before
      ? db.prepare('SELECT * FROM wa_messages WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(chatId, Number(before), n + 1)
      : db.prepare('SELECT * FROM wa_messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(chatId, n + 1);
    const hasMore = rows.length > n;
    return { group, messages: rows.slice(0, n).reverse().map((m) => toPublic(m, withMentions)), hasMore };
  }

  // ── Summaries ──

  const INSTRUCTIONS = `Tulis dalam Bahasa Indonesia, format Markdown, dengan bagian:
## Ringkasan
(2–4 kalimat)
## Topik utama
- …
## Keputusan
- … (tulis "Tidak ada" bila tidak ada)
## Tindak lanjut
- **Nama** — tugas (tenggat bila disebut)
## Pertanyaan terbuka
- …
Hanya gunakan isi yang diberikan; jangan menambah informasi atau menebak. Jangan memakai tool apa pun dan jangan mengirim pesan ke siapa pun — cukup balas dengan ringkasannya.`;

  function transcriptChunks(rows) {
    const chunks = [];
    let cur = '';
    for (const m of rows) {
      const who = m.from_me ? `${senderLabel(m)} (bot)` : senderLabel(m);
      const line = `[${fmtStamp(m.ts)}] ${who}: ${messageText(m, withMentions).replace(/\s+/g, ' ')}\n`;
      if (cur && cur.length + line.length > chunkChars) { chunks.push(cur); cur = ''; }
      cur += line;
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  async function run(id, s, groupName, rows) {
    const label = `grup WhatsApp "${groupName}" dari ${fmtStamp(s.from_ts).slice(0, 10)} sampai ${fmtStamp(s.to_ts).slice(0, 10)}`;
    const ask = (n, text) => gateway.ask({ agentId: s.agent_id, conversationId: `wasum-${id}-${n}`, text });
    try {
      const chunks = transcriptChunks(rows);
      let content;
      if (chunks.length === 1) {
        content = await ask(0, `Ringkas percakapan ${label} (${rows.length} pesan).\n${INSTRUCTIONS}\n\nPercakapan (format: [tanggal jam] Pengirim: pesan):\n${chunks[0]}`);
      } else {
        // Map: notes per part. Reduce: one summary from the notes.
        const notes = [];
        for (let i = 0; i < chunks.length; i++) {
          notes.push(await ask(i + 1, `Ini bagian ${i + 1} dari ${chunks.length} percakapan ${label}. Buat catatan poin-poin dari bagian ini saja: topik, keputusan, tindak lanjut (dengan nama), dan pertanyaan terbuka. Jangan memakai tool dan jangan mengirim pesan.\n\n${chunks[i]}`));
        }
        content = await ask(0, `Berikut catatan dari ${chunks.length} bagian percakapan ${label} (${rows.length} pesan). Gabungkan menjadi satu ringkasan utuh.\n${INSTRUCTIONS}\n\n` +
          notes.map((n, i) => `### Catatan bagian ${i + 1}\n${n}`).join('\n\n'));
      }
      db.prepare("UPDATE wa_summaries SET status = 'done', content = ?, finished_at = ? WHERE id = ?").run(content, Date.now(), id);
    } catch (err) {
      db.prepare("UPDATE wa_summaries SET status = 'error', error = ?, finished_at = ? WHERE id = ?").run(err.message || 'gagal', Date.now(), id);
    }
  }

  function toSummary(r) {
    return r && {
      id: r.id, chatId: r.chat_id, from: fmtStamp(r.from_ts).slice(0, 10), to: fmtStamp(r.to_ts).slice(0, 10),
      agentId: r.agent_id, by: r.username || null, status: r.status, messageCount: r.message_count,
      content: r.content, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at
    };
  }

  const SUMMARY_SQL = 'SELECT s.*, u.username FROM wa_summaries s LEFT JOIN users u ON u.id = s.user_id';

  function createSummary(user, { chatId, from, to, agentId }) {
    const group = requireGroup(chatId);
    if (!group) throw badRequest('grup tidak ditemukan di arsip');
    if (!agents.includes(agentId)) throw badRequest('agent tidak dikenal');
    const fromTs = parseDay(from);
    const toDay = parseDay(to);
    if (fromTs === null || toDay === null) throw badRequest('tanggal harus berformat YYYY-MM-DD');
    if (toDay < fromTs) throw badRequest('tanggal akhir sebelum tanggal awal');
    if ((toDay - fromTs) / 86400000 + 1 > MAX_RANGE_DAYS) throw badRequest(`rentang maksimal ${MAX_RANGE_DAYS} hari`);
    const end = new Date(toDay); end.setDate(end.getDate() + 1);
    const toTs = end.getTime() - 1;
    if (db.prepare("SELECT 1 FROM wa_summaries WHERE chat_id = ? AND status = 'running'").get(chatId)) {
      throw Object.assign(new Error('ringkasan untuk grup ini sedang dibuat'), { status: 409 });
    }
    const rows = db.prepare('SELECT * FROM wa_messages WHERE chat_id = ? AND ts BETWEEN ? AND ? ORDER BY ts, id').all(chatId, fromTs, toTs);
    if (!rows.length) throw badRequest('tidak ada pesan di rentang tanggal ini');
    if (rows.length > MAX_MESSAGES) throw badRequest(`terlalu banyak pesan (${rows.length}); persempit rentang tanggal (maks ${MAX_MESSAGES})`);
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO wa_summaries
      (chat_id, from_ts, to_ts, agent_id, user_id, status, message_count, created_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`)
      .run(chatId, fromTs, toTs, agentId, user.id, rows.length, Date.now());
    const s = db.prepare('SELECT * FROM wa_summaries WHERE id = ?').get(id);
    run(Number(id), s, group.name || chatId, rows);
    return getSummary(Number(id));
  }

  function getSummary(id) {
    return toSummary(db.prepare(SUMMARY_SQL + ' WHERE s.id = ?').get(Number(id)));
  }

  function listSummaries(chatId) {
    if (chatId && !GROUP_RE.test(String(chatId))) throw badRequest('bukan id grup WhatsApp');
    const rows = chatId
      ? db.prepare(SUMMARY_SQL + ' WHERE s.chat_id = ? ORDER BY s.id DESC LIMIT 30').all(chatId)
      : db.prepare(SUMMARY_SQL + ' ORDER BY s.id DESC LIMIT 30').all();
    return rows.map(toSummary);
  }

  return { sync, groups, messages, createSummary, getSummary, listSummaries };
}

module.exports = { createWaArchive, parseDay, fmtStamp };
