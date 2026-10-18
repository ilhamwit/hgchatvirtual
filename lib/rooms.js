// Chat & Discussion — team channels and direct messages (EPIC-012).
//
// Channels are open to the whole team (owner's decision, 2026-10-19): every
// active user sees every channel and tracks its unread count. A DM belongs to
// its two members only; for anyone else it does not exist (404), in the API
// and in the live stream. Every change is handed to `publish(event, userIds)`
// (userIds null = everyone), which the SSE hub delivers.
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MAX_BODY = 8000;
const PAGE = 50;

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const badRequest = (msg) => httpError(400, msg);

// "Rapat Tim Sales" -> "rapat-tim-sales"
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function createRooms({ db, publish = () => {}, checkAttachments = (a) => a || [], now = () => Date.now() }) {
  const person = (id) => {
    const u = id && db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(id);
    return u ? { id: u.id, username: u.username, name: u.display_name } : null;
  };
  const people = () => db.prepare('SELECT id, username, display_name FROM users WHERE disabled = 0 ORDER BY display_name')
    .all().map((u) => ({ id: u.id, username: u.username, name: u.display_name }));
  const members = (roomId) => db.prepare('SELECT user_id FROM room_members WHERE room_id = ?').all(roomId).map((r) => r.user_id);
  const audience = (room) => (room.kind === 'dm' ? members(room.id) : null);

  function roomFor(user, id) {
    const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id));
    if (!r || (r.kind === 'dm' && !db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(r.id, user.id))) {
      throw httpError(404, 'ruang tidak ditemukan');
    }
    return r;
  }

  function toRoom(user, r) {
    const read = (db.prepare('SELECT last_read_id FROM room_reads WHERE room_id = ? AND user_id = ?').get(r.id, user.id) || {}).last_read_id || 0;
    const unread = db.prepare(`SELECT COUNT(*) AS n FROM room_messages WHERE room_id = ? AND id > ? AND deleted_at IS NULL
                                AND (user_id IS NULL OR user_id != ?)`).get(r.id, read, user.id).n;
    const mentions = db.prepare(`SELECT COUNT(*) AS n FROM room_mentions x JOIN room_messages m ON m.id = x.message_id
                                  WHERE m.room_id = ? AND x.user_id = ? AND m.id > ? AND m.deleted_at IS NULL`).get(r.id, user.id, read).n;
    const last = db.prepare('SELECT MAX(created_at) AS at FROM room_messages WHERE room_id = ?').get(r.id).at;
    const out = { id: r.id, kind: r.kind, name: r.name, topic: r.topic, createdAt: r.created_at, lastAt: last || r.created_at, unread, mentions, lastReadId: read };
    if (r.kind === 'dm') out.with = person(members(r.id).find((id) => id !== user.id) || user.id);
    return out;
  }

  function list(user) {
    const rows = db.prepare(`SELECT * FROM rooms WHERE kind = 'channel'
                              OR id IN (SELECT room_id FROM room_members WHERE user_id = ?) ORDER BY id`).all(user.id);
    return rows.map((r) => toRoom(user, r));
  }

  function totals(user) {
    return list(user).reduce((t, r) => ({ unread: t.unread + r.unread, mentions: t.mentions + r.mentions }), { unread: 0, mentions: 0 });
  }

  function createChannel(user, { name, topic } = {}) {
    const n = slug(name);
    if (!NAME_RE.test(n)) throw badRequest('nama channel 2–40 huruf/angka');
    if (db.prepare("SELECT 1 FROM rooms WHERE kind = 'channel' AND name = ?").get(n)) throw httpError(409, `channel #${n} sudah ada`);
    const t = typeof topic === 'string' ? topic.trim().slice(0, 200) || null : null;
    const { lastInsertRowid: id } = db.prepare("INSERT INTO rooms (kind, name, topic, created_by, created_at) VALUES ('channel', ?, ?, ?, ?)")
      .run(n, t, user.id, now());
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id));
    publish({ type: 'room', roomId: room.id }, null);
    return toRoom(user, room);
  }

  function setTopic(user, id, topic) {
    const r = roomFor(user, id);
    if (r.kind !== 'channel') throw badRequest('hanya channel yang punya topik');
    const t = typeof topic === 'string' ? topic.trim().slice(0, 200) || null : null;
    db.prepare('UPDATE rooms SET topic = ? WHERE id = ?').run(t, r.id);
    publish({ type: 'room', roomId: r.id }, null);
    return toRoom(user, db.prepare('SELECT * FROM rooms WHERE id = ?').get(r.id));
  }

  // The DM between the user and someone else, created on first use.
  function openDm(user, username) {
    const other = db.prepare('SELECT id FROM users WHERE username = ? AND disabled = 0').get(String(username || ''));
    if (!other) throw badRequest('orang tidak dikenal');
    if (other.id === user.id) throw badRequest('tidak bisa mengirim pesan langsung ke diri sendiri');
    const key = [user.id, other.id].sort((a, b) => a - b).join(':');
    let r = db.prepare('SELECT * FROM rooms WHERE dm_key = ?').get(key);
    if (!r) {
      const { lastInsertRowid: id } = db.prepare("INSERT INTO rooms (kind, dm_key, created_by, created_at) VALUES ('dm', ?, ?, ?)").run(key, user.id, now());
      const add = db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)');
      add.run(Number(id), user.id);
      add.run(Number(id), other.id);
      r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id));
    }
    return toRoom(user, r);
  }

  function toMessage(m) {
    const replies = m.parent_id ? null : db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS at FROM room_messages WHERE parent_id = ? AND deleted_at IS NULL').get(m.id);
    const mentions = db.prepare('SELECT u.username FROM room_mentions x JOIN users u ON u.id = x.user_id WHERE x.message_id = ?').all(m.id).map((r) => r.username);
    return {
      id: m.id, roomId: m.room_id, parentId: m.parent_id, author: person(m.user_id),
      body: m.deleted_at ? '' : m.body, attachments: !m.deleted_at && m.attachments_json ? JSON.parse(m.attachments_json) : [],
      createdAt: m.created_at, editedAt: m.edited_at, deleted: !!m.deleted_at, mentions,
      replies: replies ? replies.n : undefined, lastReplyAt: replies ? replies.at : undefined
    };
  }
  const msgRow = (id) => db.prepare('SELECT * FROM room_messages WHERE id = ?').get(Number(id));

  // Top-level messages, newest page first (returned oldest -> newest), or a
  // whole thread (parent + replies).
  function messages(user, roomId, { before, parentId } = {}) {
    const r = roomFor(user, roomId);
    if (parentId) {
      const p = msgRow(parentId);
      if (!p || p.room_id !== r.id || p.parent_id) throw httpError(404, 'utas tidak ditemukan');
      const replies = db.prepare('SELECT * FROM room_messages WHERE parent_id = ? ORDER BY id').all(p.id);
      return { parent: toMessage(p), messages: replies.map(toMessage), hasMore: false };
    }
    const b = Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER;
    const rows = db.prepare('SELECT * FROM room_messages WHERE room_id = ? AND parent_id IS NULL AND id < ? ORDER BY id DESC LIMIT ?').all(r.id, b, PAGE + 1);
    const hasMore = rows.length > PAGE;
    return { messages: rows.slice(0, PAGE).reverse().map(toMessage), hasMore };
  }

  function text(body) {
    if (body !== undefined && body !== null && typeof body !== 'string') throw badRequest('pesan harus berupa teks');
    const t = String(body || '').trim();
    if (t.length > MAX_BODY) throw badRequest(`pesan maksimal ${MAX_BODY} karakter`);
    return t;
  }

  // @username of an active user who can see the room; never oneself.
  function mentionIds(user, room, body) {
    const names = [...new Set([...body.matchAll(/(^|[^\w@])@([a-z0-9._-]{2,32})/gi)].map((m) => m[2].toLowerCase()))];
    const allowed = room.kind === 'dm' ? members(room.id) : null;
    const ids = [];
    for (const n of names) {
      const u = db.prepare('SELECT id FROM users WHERE lower(username) = ? AND disabled = 0').get(n);
      if (u && u.id !== user.id && (!allowed || allowed.includes(u.id))) ids.push(u.id);
    }
    return ids;
  }
  function saveMentions(msgId, ids) {
    db.prepare('DELETE FROM room_mentions WHERE message_id = ?').run(msgId);
    const ins = db.prepare('INSERT INTO room_mentions (message_id, user_id) VALUES (?, ?)');
    for (const id of ids) ins.run(msgId, id);
  }

  function markRead(user, roomId, lastId) {
    const r = roomFor(user, roomId);
    const max = db.prepare('SELECT MAX(id) AS id FROM room_messages WHERE room_id = ?').get(r.id).id || 0;
    const to = Math.min(Number(lastId) > 0 ? Number(lastId) : max, max);
    db.prepare(`INSERT INTO room_reads (room_id, user_id, last_read_id) VALUES (?, ?, ?)
                ON CONFLICT (room_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(r.id, user.id, to);
    publish({ type: 'read', roomId: r.id }, [user.id]);   // the reader's other tabs
    return toRoom(user, r);
  }

  function post(user, roomId, { body, attachments, parentId } = {}) {
    const r = roomFor(user, roomId);
    const t = text(body);
    const att = checkAttachments(attachments);
    if (!t && !att.length) throw badRequest('pesan kosong');
    let parent = null;
    if (parentId) {
      parent = msgRow(parentId);
      if (!parent || parent.room_id !== r.id || parent.parent_id || parent.deleted_at) throw badRequest('pesan yang dibalas tidak ditemukan');
    }
    const { lastInsertRowid } = db.prepare(`INSERT INTO room_messages (room_id, user_id, parent_id, body, attachments_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(r.id, user.id, parent ? parent.id : null, t, att.length ? JSON.stringify(att) : null, now());
    const id = Number(lastInsertRowid);
    saveMentions(id, mentionIds(user, r, t));
    markRead(user, r.id, id);
    const message = toMessage(msgRow(id));
    publish({ type: 'message', roomId: r.id, message, parent: parent ? toMessage(msgRow(parent.id)) : null }, audience(r));
    return message;
  }

  function ownMessage(user, id) {
    const m = msgRow(id);
    if (!m) throw httpError(404, 'pesan tidak ditemukan');
    const r = roomFor(user, m.room_id);
    if (m.user_id !== user.id) throw httpError(403, 'hanya pesan sendiri yang bisa diubah');
    if (m.deleted_at) throw httpError(409, 'pesan sudah dihapus');
    return { m, r };
  }

  function edit(user, id, body) {
    const { m, r } = ownMessage(user, id);
    const t = text(body);
    if (!t && !m.attachments_json) throw badRequest('pesan kosong');
    if (t === m.body) return toMessage(m);
    db.prepare('UPDATE room_messages SET body = ?, edited_at = ? WHERE id = ?').run(t, now(), m.id);
    saveMentions(m.id, mentionIds(user, r, t));
    const message = toMessage(msgRow(m.id));
    publish({ type: 'edit', roomId: r.id, message }, audience(r));
    return message;
  }

  function remove(user, id) {
    const { m, r } = ownMessage(user, id);
    db.prepare("UPDATE room_messages SET body = '', attachments_json = NULL, deleted_at = ? WHERE id = ?").run(now(), m.id);
    db.prepare('DELETE FROM room_mentions WHERE message_id = ?').run(m.id);
    const message = toMessage(msgRow(m.id));
    publish({ type: 'delete', roomId: r.id, message, parent: m.parent_id ? toMessage(msgRow(m.parent_id)) : null }, audience(r));
    return message;
  }

  // An attachment in a room message the user may see, or null.
  function findAttachment(user, fileName) {
    const like = '%' + String(fileName).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const rows = db.prepare(`SELECT m.room_id, m.attachments_json FROM room_messages m
                              WHERE m.deleted_at IS NULL AND m.attachments_json LIKE ? ESCAPE '\\'`).all(like);
    for (const row of rows) {
      try { roomFor(user, row.room_id); } catch (e) { continue; }
      for (const a of JSON.parse(row.attachments_json)) {
        if (a && typeof a.path === 'string' && a.path.split('/').pop() === fileName) return a;
      }
    }
    return null;
  }

  // Who may receive events about this room (null = everyone).
  function roomAudience(roomId) {
    const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(roomId));
    return r ? audience(r) : [];
  }

  return { people, list, totals, createChannel, setTopic, openDm, messages, post, edit, remove, markRead, findAttachment, roomAudience };
}

module.exports = { createRooms, slug };
