// Notifications outside the web (EPIC-012 stage 3): each person's verified
// WhatsApp number, their settings, and the bot messages for a mention, a DM
// or an agent's answer that stays unread.
//
// Rules (owner's decision, 2026-10-19): wait `notify_delay_min` (default 5);
// skip it if read meanwhile; while the person has Chat Center open the
// browser notifies instead, so WhatsApp waits until 30 minutes after the
// message; quiet hours (default 21.00–07.00 WIB) hold it until morning;
// several notifications go out as one message; at most 6 per person an hour.
const crypto = require('crypto');

const WIB_MS = 7 * 3600 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DELAYS = [0, 5, 15, 30];
const CODE_TTL_MS = 10 * 60 * 1000;
const CODES_PER_HOUR = 3;
const CODE_TRIES = 5;
const ONLINE_GRACE_MS = 30 * 60 * 1000;
const BATCHES_PER_HOUR = 6;
const MAX_ATTEMPTS = 3;

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const badRequest = (msg) => httpError(400, msg);
const hash = (userId, code) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');

// "0812-3456 789", "+62 812…", "812…" -> "62812…"; null if it cannot be a number.
function normalizeNumber(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}
const masked = (n) => (n ? `+${n.slice(0, 2)} ${n.slice(2, 5)}••••${n.slice(-3)}` : null);
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// The next end of the quiet window if `t` falls inside it, else null.
function quietUntil(t, start, end) {
  const d = new Date(t + WIB_MS);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const s = minutesOf(start); const e = minutesOf(end);
  if (s === e) return null;
  const inside = s < e ? m >= s && m < e : m >= s || m < e;
  if (!inside) return null;
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - WIB_MS;
  let until = dayStart + e * 60000;
  if (until <= t) until += 86400000;
  return until;
}

function createNotifier({
  db, hub = null, onEvent = () => {},
  bridgeUrl = process.env.CHAT_WA_BRIDGE_URL || 'http://127.0.0.1:3010',
  publicUrl = process.env.CHAT_PUBLIC_URL || 'https://agents.herrygunawan.com',
  now = () => Date.now(), tickMs = 30000,
  send = null    // (number, text) => Promise; default: the Hermes WhatsApp bridge
}) {
  async function bridgeSend(number, message) {
    let res;
    try {
      res = await fetch(bridgeUrl + '/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: number + '@s.whatsapp.net', message }), signal: AbortSignal.timeout(20000)
      });
    } catch (e) { throw new Error('bot WhatsApp tidak bisa dihubungi'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (res.status === 503) throw new Error('bot WhatsApp sedang tidak tersambung');
    if (!res.ok || !data || data.success === false) throw new Error('gagal mengirim' + (data && data.error ? ': ' + data.error : ` (HTTP ${res.status})`));
  }
  const deliver = send || bridgeSend;

  function profileRow(userId) {
    db.prepare('INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)').run(userId);
    return db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
  }

  function profile(user) {
    const p = profileRow(user.id);
    return {
      wa: p.wa_number ? { number: masked(p.wa_number), verifiedAt: p.wa_verified_at } : null,
      pending: p.wa_pending && p.wa_code_expires > now() ? { number: masked(p.wa_pending), expiresAt: p.wa_code_expires } : null,
      notifyWa: !!p.notify_wa, delayMin: p.notify_delay_min, quietStart: p.quiet_start, quietEnd: p.quiet_end,
      delays: DELAYS
    };
  }

  // Step 1: the bot sends a 6-digit code to the number.
  async function requestCode(user, rawNumber) {
    const number = normalizeNumber(rawNumber);
    if (!number) throw badRequest('nomor WhatsApp tidak valid (contoh: 0812 3456 7890)');
    const p = profileRow(user.id);
    const recent = JSON.parse(p.wa_codes_sent).filter((t) => now() - t < 3600000);
    if (recent.length >= CODES_PER_HOUR) throw httpError(429, 'terlalu banyak permintaan kode; coba lagi dalam 1 jam');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await deliver(number, `Kode verifikasi HG Chat: *${code}*\nBerlaku 10 menit. Abaikan pesan ini jika Anda tidak memintanya.`);
    db.prepare(`UPDATE user_profiles SET wa_pending = ?, wa_code_hash = ?, wa_code_expires = ?, wa_code_tries = 0, wa_codes_sent = ?
                WHERE user_id = ?`).run(number, hash(user.id, code), now() + CODE_TTL_MS, JSON.stringify([...recent, now()]), user.id);
    return profile(user);
  }

  // Step 2: the code proves the number is the person's.
  function verify(user, code) {
    const p = profileRow(user.id);
    if (!p.wa_pending || !(p.wa_code_expires > now())) throw badRequest('kode sudah kedaluwarsa; minta kode baru');
    if (p.wa_code_tries >= CODE_TRIES) throw httpError(429, 'terlalu banyak percobaan; minta kode baru');
    if (hash(user.id, String(code || '').trim()) !== p.wa_code_hash) {
      db.prepare('UPDATE user_profiles SET wa_code_tries = wa_code_tries + 1 WHERE user_id = ?').run(user.id);
      throw badRequest('kode salah');
    }
    db.prepare(`UPDATE user_profiles SET wa_number = wa_pending, wa_verified_at = ?, wa_pending = NULL, wa_code_hash = NULL,
                wa_code_expires = NULL, wa_code_tries = 0 WHERE user_id = ?`).run(now(), user.id);
    onEvent('profile_wa_verified', user.username, masked(p.wa_pending));
    return profile(user);
  }

  function removeNumber(user) {
    profileRow(user.id);
    db.prepare(`UPDATE user_profiles SET wa_number = NULL, wa_verified_at = NULL, wa_pending = NULL, wa_code_hash = NULL,
                wa_code_expires = NULL WHERE user_id = ?`).run(user.id);
    db.prepare("UPDATE notify_queue SET status = 'skipped', error = 'nomor dihapus' WHERE user_id = ? AND status = 'pending'").run(user.id);
    onEvent('profile_wa_removed', user.username, null);
    return profile(user);
  }

  function updateSettings(user, body = {}) {
    profileRow(user.id);
    const set = {};
    if (body.notifyWa !== undefined) set.notify_wa = body.notifyWa ? 1 : 0;
    if (body.delayMin !== undefined) {
      if (!DELAYS.includes(Number(body.delayMin))) throw badRequest('jeda harus 0, 5, 15, atau 30 menit');
      set.notify_delay_min = Number(body.delayMin);
    }
    for (const [k, col] of [['quietStart', 'quiet_start'], ['quietEnd', 'quiet_end']]) {
      if (body[k] !== undefined) {
        if (!TIME_RE.test(String(body[k]))) throw badRequest('jam tenang harus berformat HH:MM');
        set[col] = body[k];
      }
    }
    const cols = Object.keys(set);
    if (cols.length) db.prepare(`UPDATE user_profiles SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE user_id = ?`).run(...cols.map((c) => set[c]), user.id);
    return profile(user);
  }

  async function sendTest(user) {
    const p = profileRow(user.id);
    if (!p.wa_number) throw badRequest('belum ada nomor WhatsApp terverifikasi');
    await deliver(p.wa_number, `🔔 *HG Chat* — tes notifikasi.\nBeginilah notifikasi sebutan, pesan langsung, dan jawaban agent akan tampil.\n${publicUrl}/#discuss`);
    return { ok: true };
  }

  // From the rooms module: who should hear about a new message.
  function enqueue(items) {
    const t = now();
    for (const it of items) {
      const p = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(it.userId);
      if (!p || !p.wa_number || !p.notify_wa) continue;
      db.prepare('INSERT INTO notify_queue (user_id, kind, room_id, message_id, created_at, due_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(it.userId, it.kind, it.roomId, it.messageId, t, t + p.notify_delay_min * 60000);
    }
  }

  function line(item) {
    const m = db.prepare('SELECT * FROM room_messages WHERE id = ?').get(item.message_id);
    const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(item.room_id);
    const who = m.agent_id ? m.agent_id.charAt(0).toUpperCase() + m.agent_id.slice(1)
      : ((db.prepare('SELECT display_name FROM users WHERE id = ?').get(m.user_id) || {}).display_name || 'Seseorang');
    const text = String(m.body || '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
    const quote = text ? `: "${text.length > 90 ? text.slice(0, 87) + '…' : text}"` : (m.attachments_json ? ': 📎 lampiran' : '');
    if (item.kind === 'dm') return `• Pesan langsung dari *${who}*${quote}`;
    if (item.kind === 'agent') return `• *${who}* menjawab Anda di ${r.kind === 'dm' ? 'pesan langsung' : '#' + r.name}${quote}`;
    return `• *${who}* menyebut Anda di ${r.kind === 'dm' ? 'pesan langsung' : '#' + r.name}${quote}`;
  }

  // Deliver what is due, one message per person.
  let ticking = null;
  function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      const t = now();
      const due = db.prepare("SELECT * FROM notify_queue WHERE status = 'pending' AND due_at <= ? ORDER BY user_id, id").all(t);
      const byUser = new Map();
      for (const q of due) (byUser.get(q.user_id) || byUser.set(q.user_id, []).get(q.user_id)).push(q);
      const mark = (ids, status, extra = {}) => {
        const stmt = db.prepare('UPDATE notify_queue SET status = ?, sent_at = ?, error = ? WHERE id = ?');
        for (const id of ids) stmt.run(status, extra.sentAt || null, extra.error || null, id);
      };
      const later = (ids, at) => { const stmt = db.prepare('UPDATE notify_queue SET due_at = ? WHERE id = ?'); for (const id of ids) stmt.run(at, id); };

      for (const [userId, items] of byUser) {
        const u = db.prepare('SELECT username, disabled FROM users WHERE id = ?').get(userId);
        const p = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
        if (!u || u.disabled || !p || !p.wa_number || !p.notify_wa) { mark(items.map((q) => q.id), 'skipped', { error: 'notifikasi WhatsApp mati' }); continue; }
        const live = [];
        for (const q of items) {
          const m = db.prepare('SELECT deleted_at FROM room_messages WHERE id = ?').get(q.message_id);
          const read = (db.prepare('SELECT last_read_id FROM room_reads WHERE room_id = ? AND user_id = ?').get(q.room_id, userId) || {}).last_read_id || 0;
          if (!m || m.deleted_at) mark([q.id], 'skipped', { error: 'pesan dihapus' });
          else if (read >= q.message_id) mark([q.id], 'read');
          else live.push(q);
        }
        if (!live.length) continue;
        // Chat Center open: the browser notified; WhatsApp only if still unread later.
        if (hub && hub.online().includes(u.username)) {
          const wait = live.filter((q) => t - q.created_at < ONLINE_GRACE_MS);
          if (wait.length === live.length) { later(live.map((q) => q.id), Math.min(...live.map((q) => q.created_at)) + ONLINE_GRACE_MS); continue; }
        }
        const quiet = quietUntil(t, p.quiet_start, p.quiet_end);
        if (quiet) { later(live.map((q) => q.id), quiet); continue; }
        const sentHour = db.prepare("SELECT COUNT(DISTINCT sent_at) AS n FROM notify_queue WHERE user_id = ? AND status = 'sent' AND sent_at > ?").get(userId, t - 3600000).n;
        if (sentHour >= BATCHES_PER_HOUR) { later(live.map((q) => q.id), t + 10 * 60000); continue; }

        const shown = live.slice(0, 5).map(line);
        const more = live.length > 5 ? `\n…dan ${live.length - 5} lainnya` : '';
        const text = `🔔 *HG Chat* — ${live.length === 1 ? 'ada pesan untuk Anda' : `${live.length} pesan untuk Anda`}\n${shown.join('\n')}${more}\n\nBuka: ${publicUrl}/#discuss`;
        try {
          await deliver(p.wa_number, text);
          mark(live.map((q) => q.id), 'sent', { sentAt: now() });
        } catch (err) {
          for (const q of live) {
            const attempts = q.attempts + 1;
            if (attempts >= MAX_ATTEMPTS) db.prepare("UPDATE notify_queue SET status = 'error', attempts = ?, error = ? WHERE id = ?").run(attempts, err.message, q.id);
            else db.prepare('UPDATE notify_queue SET attempts = ?, error = ?, due_at = ? WHERE id = ?').run(attempts, err.message, now() + 2 * 60000 * attempts, q.id);
          }
        }
      }
    })().catch((e) => console.error('notify tick:', e)).finally(() => { ticking = null; });
    return ticking;
  }

  let timer = null;
  function start() { if (!timer) { timer = setInterval(tick, tickMs); timer.unref(); } }
  function stop() { clearInterval(timer); timer = null; }

  return { profile, requestCode, verify, removeNumber, updateSettings, sendTest, enqueue, tick, start, stop };
}

module.exports = { createNotifier, normalizeNumber, quietUntil };
