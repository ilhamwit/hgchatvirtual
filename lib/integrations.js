// Integrations (EPIC-013): API keys, and the v1 API the WhatsApp agent
// (Hermes, bot "Rederp") uses to create and list events.
//
// Who asks is never taken from what the model writes: the Hermes gateway
// puts the sender's WhatsApp id and the chat id on every command the agent
// runs (HERMES_SESSION_USER_ID / _ALT, HERMES_SESSION_CHAT_ID); the skill's
// script forwards those. The id must belong to a team member whose number is
// verified in Chat Center, and in a group that person must have just written
// there (the bridge's group archive, last 15 minutes).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCOPES = { 'events:write': 'Membuat acara', 'events:read': 'Melihat jadwal mendatang' };
const RECENT_MS = 15 * 60 * 1000;
const RATE_PER_MIN = 60;

const httpError = (status, msg, code) => Object.assign(new Error(msg), { status, code });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createIntegrations({
  db, events, waArchive = null, onEvent = () => {},
  sessionDir = process.env.CHAT_WA_SESSION_DIR || path.join(os.homedir(), '.hermes', 'whatsapp', 'session'),
  publicUrl = process.env.CHAT_PUBLIC_URL || 'https://agents.herrygunawan.com',
  now = () => Date.now()
}) {
  // ── keys (admins, from the web) ──
  const toKey = (k) => ({
    id: k.id, name: k.name, prefix: k.prefix, scopes: JSON.parse(k.scopes),
    createdBy: (db.prepare('SELECT display_name FROM users WHERE id = ?').get(k.created_by) || {}).display_name || null,
    createdAt: k.created_at, lastUsedAt: k.last_used_at, revokedAt: k.revoked_at
  });
  const listKeys = () => db.prepare('SELECT * FROM api_keys ORDER BY revoked_at IS NOT NULL, id DESC').all().map(toKey);

  function createKey(user, { name, scopes } = {}) {
    const n = typeof name === 'string' ? name.trim().slice(0, 60) : '';
    if (!n) throw httpError(400, 'nama key wajib diisi');
    const sc = [...new Set(Array.isArray(scopes) ? scopes.map(String) : [])];
    if (!sc.length || sc.some((s) => !SCOPES[s])) throw httpError(400, 'pilih izin: ' + Object.keys(SCOPES).join(', '));
    const key = 'cc_' + crypto.randomBytes(24).toString('base64url');
    const { lastInsertRowid: id } = db.prepare('INSERT INTO api_keys (name, prefix, key_hash, scopes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(n, key.slice(0, 10), sha(key), JSON.stringify(sc), user.id, now());
    onEvent('api_key_created', user.username, `${n} [${sc.join(',')}]`);
    return { key, apiKey: toKey(db.prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(id))) };
  }

  function revokeKey(user, id) {
    const k = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(id));
    if (!k) throw httpError(404, 'key tidak ditemukan');
    if (!k.revoked_at) {
      db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(now(), k.id);
      onEvent('api_key_revoked', user.username, k.name);
    }
    return toKey(db.prepare('SELECT * FROM api_keys WHERE id = ?').get(k.id));
  }

  // ── authenticating a call ──
  const hits = new Map();   // key id -> recent call times
  function authenticate(req, scope) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(cc_[A-Za-z0-9_-]{20,})$/);
    const k = m && db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(sha(m[1]));
    if (!k || k.revoked_at) throw httpError(401, 'API key tidak valid atau sudah dicabut', 'invalid_key');
    if (!JSON.parse(k.scopes).includes(scope)) throw httpError(403, `API key ini tidak punya izin ${scope}`, 'missing_scope');
    const t = now();
    const recent = (hits.get(k.id) || []).filter((x) => t - x < 60000);
    if (recent.length >= RATE_PER_MIN) throw httpError(429, 'terlalu banyak permintaan; coba lagi sebentar', 'rate_limited');
    hits.set(k.id, [...recent, t]);
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(t, k.id);
    return k;
  }

  // ── who is asking ──
  // "6281…@s.whatsapp.net", "6281…:12@s.whatsapp.net" -> "6281…"; "1234@lid" -> its phone via
  // the bridge's lid-mapping files; null when unknown.
  function phoneOf(waId) {
    const id = String(waId || '').trim();
    if (!id) return null;
    const local = id.replace(/@.*/, '').replace(/:.*$/, '');
    if (!/^\d{5,20}$/.test(local)) return null;
    if (!id.endsWith('@lid')) return local;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(sessionDir, `lid-mapping-${local}_reverse.json`), 'utf8'));
      const phone = String(v).replace(/@.*/, '').replace(/:.*$/, '');
      return /^\d{8,15}$/.test(phone) ? phone : null;
    } catch (e) { return null; }
  }

  function requesterOf({ waId, waIdAlt } = {}) {
    const ids = [waId, waIdAlt].filter(Boolean).map(String);
    const phones = [...new Set(ids.map(phoneOf).filter(Boolean))];
    for (const ph of phones) {
      const u = db.prepare(`SELECT u.id, u.username, u.display_name, u.role FROM user_profiles p JOIN users u ON u.id = p.user_id
                             WHERE p.wa_number = ? AND u.disabled = 0`).get(ph);
      if (u) return { user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role }, ids, phones };
    }
    return { user: null, ids, phones };
  }

  // In a group, the requester must have written there just now.
  function wroteRecently(chatId, ids, phones) {
    if (waArchive) { try { waArchive.sync(); } catch (e) { /* use what is indexed */ } }
    const since = now() - RECENT_MS;
    const q = db.prepare('SELECT 1 FROM wa_messages WHERE chat_id = ? AND ts >= ? AND (sender_number = ? OR sender_id = ?) LIMIT 1');
    return [...phones, ...ids.map((x) => x.replace(/:\d+@/, '@'))].some((v) => q.get(chatId, since, v, v));
  }

  // ── v1: events ──
  function createEvent(req, body = {}) {
    const key = authenticate(req, 'events:write');
    const mode = body.mode === 'send' ? 'send' : body.mode === 'draft' ? 'draft' : null;
    if (!mode) throw httpError(400, 'mode harus "draft" atau "send" — tanyakan dulu ke peminta', 'mode_required');
    const r = body.requester || {};
    const { user, ids, phones } = requesterOf(r);
    const chatId = String(body.chatId || '');
    const isGroup = /^\d[\d-]*@g\.us$/.test(chatId);
    const deny = (msg, code) => {
      onEvent('api_denied', null, `${key.name}: ${code} ${phones.map((p) => p.slice(0, 4) + '…' + p.slice(-3)).join(',') || ids.join(',') || '-'}`);
      return httpError(403, msg, code);
    };
    if (!user) throw deny('Nomor WhatsApp peminta belum terhubung ke akun Chat Center. Minta yang bersangkutan memverifikasi nomornya di agents.herrygunawan.com → Profil & notifikasi.', 'requester_not_verified');
    if (isGroup && !wroteRecently(chatId, ids, phones)) throw deny('Permintaan ini tidak cocok dengan pesan terbaru peminta di grup.', 'requester_not_in_chat');
    const groups = Array.isArray(body.groups) && body.groups.length ? body.groups : isGroup ? [chatId] : [];
    const { event } = events.create(user, {
      title: body.title, date: body.date, time: body.time, durationMin: body.durationMin === undefined ? undefined : Number(body.durationMin),
      location: body.location, attendees: body.attendees, notes: body.notes, groups, reminders: body.reminders
    }, { source: 'whatsapp', autoSend: mode === 'send' });
    onEvent('api_event_created', user.username, `${key.name}: event ${event.id} (${mode})`);
    const where = event.location ? ` di ${event.location}` : '';
    const rem = event.reminders.length ? ` Pengingat: ${event.reminders.length} kali sebelum acara.` : '';
    const reply = mode === 'send'
      ? `✅ Acara dibuat: *${event.title}* — ${event.when}${where}. Agenda sedang disusun dan akan dikirim otomatis ke grup.${rem}`
      : `✅ Draf acara dibuat: *${event.title}* — ${event.when}${where}. Agenda sedang disusun; cek & kirim di ${publicUrl}/#schedule`;
    return { ok: true, mode, requester: user.displayName, event: { id: event.id, title: event.title, when: event.when, location: event.location, groups: event.groups.map((g) => g.name || g.id), reminders: event.reminders }, url: `${publicUrl}/#schedule`, reply };
  }

  function listEvents(req, url) {
    authenticate(req, 'events:read');
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 60);
    const until = now() + days * 86400000;
    const list = events.list({ upcoming: true }).filter((e) => e.startsAt <= until);
    return { days, events: list.map((e) => ({ id: e.id, title: e.title, when: e.when, location: e.location, status: e.status })) };
  }

  return { scopes: SCOPES, listKeys, createKey, revokeKey, createEvent, listEvents, phoneOf };
}

module.exports = { createIntegrations, SCOPES };
