// Schedule — team events and meetings (EPIC-009).
//
// A person writes what/when/where; Aurix drafts the meeting agenda; a person
// checks it and presses "Kirim", which queues the agenda for the chosen
// WhatsApp groups and schedules the reminders. A small worker delivers the
// queue (event_messages) through Hermes' WhatsApp bridge (POST /send).
// Nothing reaches a group without that press.
//
// Times are WIB: dates and times from the form are read as Asia/Jakarta
// (no DST, fixed +07:00) and every message is written in WIB, whatever the
// server's own timezone is.
const GROUP_RE = /^\d[\d-]*@g\.us$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WIB_MS = 7 * 3600 * 1000;
const TZ = 'Asia/Jakarta';
const MAX_GROUPS = 10;
const MAX_AGENDA = 4000;
const MAX_ATTEMPTS = 5;

// Reminder choices. `due` gives the send time from the start, in ms.
const REMINDERS = {
  d1: { label: 'H-1 pukul 09.00', lead: 'Besok', due: (s) => wibDayAt(s, -1, 9, 0) },
  d0: { label: 'Hari H pukul 08.00', lead: 'Hari ini', due: (s) => wibDayAt(s, 0, 8, 0) },
  m60: { label: '1 jam sebelum', lead: '1 jam lagi', due: (s) => s - 60 * 60000 },
  m30: { label: '30 menit sebelum', lead: '30 menit lagi', due: (s) => s - 30 * 60000 },
  m15: { label: '15 menit sebelum', lead: '15 menit lagi', due: (s) => s - 15 * 60000 }
};
const DEFAULT_REMINDERS = ['d1', 'm60'];

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const badRequest = (msg) => httpError(400, msg);
const pad = (n) => String(n).padStart(2, '0');

// Wall-clock parts of an instant in WIB.
function wib(ms) {
  const d = new Date(ms + WIB_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
function wibDayAt(ms, dayOffset, h, mi) {
  const p = wib(ms);
  return Date.UTC(p.y, p.mo - 1, p.d + dayOffset, h, mi) - WIB_MS;
}
const wibDate = (ms) => { const p = wib(ms); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; };
const wibTime = (ms) => { const p = wib(ms); return `${pad(p.h)}:${pad(p.mi)}`; };

// "2026-10-20" + "10:00" -> instant, or null for an impossible date/time.
function parseStart(date, time) {
  if (!DATE_RE.test(String(date)) || !TIME_RE.test(String(time))) return null;
  const ms = Date.parse(`${date}T${time}:00+07:00`);
  return Number.isFinite(ms) && wibDate(ms) === date ? ms : null;
}

// "Senin, 20 Oktober 2026 · 10.00–11.00 WIB"
function fmtWhen(start, durationMin) {
  const day = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start);
  const t = (ms) => wibTime(ms).replace(':', '.');
  return `${day} · ${t(start)}–${t(start + durationMin * 60000)} WIB`;
}

function agendaPrompt(ev) {
  const lines = [
    `- Judul / agenda: ${ev.title}`,
    `- Waktu: ${fmtWhen(ev.starts_at, ev.duration_min)} (durasi ${ev.duration_min} menit)`,
    `- Lokasi: ${ev.location || '(belum ditentukan)'}`,
    ev.attendees ? `- Peserta: ${ev.attendees}` : null,
    ev.notes ? `- Catatan dari penyelenggara: ${ev.notes}` : null
  ].filter(Boolean);
  return [
    'Susun agenda meeting dalam Bahasa Indonesia yang akan dikirim bot ke grup WhatsApp tim.',
    'Data acara:', ...lines, '',
    'Aturan:',
    '- Format WhatsApp: *tebal* dengan satu bintang, _miring_, daftar dengan angka atau "•". Tanpa tabel, tanpa heading #, tanpa **.',
    '- Mulai dengan judul tebal, lalu baris 🗓 waktu, 📍 lokasi, dan 👥 peserta (bila ada).',
    '- Lalu *Agenda*: susunan acara bernomor dengan perkiraan jam yang muat dalam durasi meeting.',
    '- Lalu *Persiapan* (bila relevan): apa yang perlu dibawa/disiapkan peserta.',
    '- Singkat dan jelas, maksimal sekitar 25 baris. Jangan mengarang link, nama, atau fakta yang tidak ada di data.',
    '- Jangan memakai tool dan jangan mengirim pesan. Balas hanya dengan teks agendanya.'
  ].join('\n');
}

function reminderText(ev, key) {
  const r = REMINDERS[key];
  return [
    `⏰ *Pengingat: ${ev.title}*`,
    `${r ? r.lead : 'Segera'} — ${fmtWhen(ev.starts_at, ev.duration_min)}`,
    ev.location ? `📍 ${ev.location}` : null,
    ev.attendees ? `👥 ${ev.attendees}` : null
  ].filter(Boolean).join('\n');
}

function cancelText(ev) {
  return [`❌ *Acara dibatalkan: ${ev.title}*`, `Semula: ${fmtWhen(ev.starts_at, ev.duration_min)}`, ev.location ? `📍 ${ev.location}` : null]
    .filter(Boolean).join('\n');
}

function createEvents({
  db,
  gateway,
  agentId = process.env.CHAT_EVENT_AGENT || 'aurix',
  bridgeUrl = process.env.CHAT_WA_BRIDGE_URL || 'http://127.0.0.1:3010',
  onEvent = () => {},
  now = () => Date.now(),
  tickMs = 30000
}) {
  const groupName = (chatId) => (db.prepare('SELECT name FROM wa_groups WHERE chat_id = ?').get(chatId) || {}).name || null;
  // A group the bot is in: it has written to the archive, or its name was looked up.
  const knownGroup = (chatId) => !!(db.prepare('SELECT 1 FROM wa_groups WHERE chat_id = ?').get(chatId)
    || db.prepare('SELECT 1 FROM wa_messages WHERE chat_id = ? LIMIT 1').get(chatId));

  const row = (id) => db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
  function requireEvent(id) {
    const ev = row(id);
    if (!ev) throw httpError(404, 'acara tidak ditemukan');
    return ev;
  }

  function text(v, max, label) {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw badRequest(`${label} harus berupa teks`);
    const t = v.trim();
    if (t.length > max) throw badRequest(`${label} maksimal ${max} karakter`);
    return t || null;
  }

  // Form body -> column values. `cur` is the stored row when updating.
  function validate(body, cur) {
    if (!body || typeof body !== 'object') throw badRequest('data acara tidak valid');
    const out = {};
    const has = (k) => body[k] !== undefined;
    if (!cur || has('title')) {
      out.title = text(body.title, 200, 'judul');
      if (!out.title) throw badRequest('judul / agenda wajib diisi');
    }
    if (!cur || has('date') || has('time')) {
      const start = parseStart(has('date') || !cur ? body.date : wibDate(cur.starts_at), has('time') || !cur ? body.time : wibTime(cur.starts_at));
      if (start === null) throw badRequest('tanggal dan jam wajib diisi dengan benar');
      if ((!cur || start !== cur.starts_at) && start < now() - 5 * 60000) throw badRequest('waktu acara sudah lewat');
      out.starts_at = start;
    }
    if (has('durationMin')) {
      const d = Number(body.durationMin);
      if (!Number.isInteger(d) || d < 5 || d > 1440) throw badRequest('durasi harus 5–1440 menit');
      out.duration_min = d;
    }
    if (has('location')) out.location = text(body.location, 300, 'lokasi');
    if (has('attendees')) out.attendees = text(body.attendees, 500, 'peserta');
    if (has('notes')) out.notes = text(body.notes, 2000, 'catatan');
    if (has('groups')) {
      if (!Array.isArray(body.groups) || body.groups.length > MAX_GROUPS) throw badRequest(`pilih maksimal ${MAX_GROUPS} grup`);
      const groups = [...new Set(body.groups.map(String))];
      for (const g of groups) if (!GROUP_RE.test(g) || !knownGroup(g)) throw badRequest('grup tidak dikenal: ' + g);
      out.groups = JSON.stringify(groups);
    }
    if (has('reminders')) {
      if (!Array.isArray(body.reminders)) throw badRequest('pengingat tidak valid');
      const keys = [...new Set(body.reminders.map(String))];
      for (const k of keys) if (!REMINDERS[k]) throw badRequest('pengingat tidak dikenal: ' + k);
      out.reminders = JSON.stringify(Object.keys(REMINDERS).filter((k) => keys.includes(k)));
    }
    return out;
  }

  function toEvent(r) {
    if (!r) return null;
    const user = (id) => (id ? (db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(id) || null) : null);
    const by = user(r.created_by);
    const sentBy = user(r.sent_by);
    return {
      id: r.id, title: r.title, startsAt: r.starts_at, durationMin: r.duration_min,
      date: wibDate(r.starts_at), time: wibTime(r.starts_at), when: fmtWhen(r.starts_at, r.duration_min),
      location: r.location, attendees: r.attendees, notes: r.notes,
      agenda: r.agenda, agendaStatus: r.agenda_status, agendaError: r.agenda_error,
      // The details changed after the agenda was written: offer a rewrite.
      agendaStale: r.agenda_status === 'done' && !!r.agenda_at && r.updated_at > r.agenda_at,
      groups: JSON.parse(r.groups).map((id) => ({ id, name: groupName(id) })),
      reminders: JSON.parse(r.reminders),
      status: r.cancelled_at ? 'cancelled' : r.sent_at ? 'sent' : 'draft',
      createdBy: by && (by.display_name || by.username), sentBy: sentBy && (sentBy.display_name || sentBy.username),
      source: r.source || null, autoSend: !!r.auto_send_by,
      createdAt: r.created_at, updatedAt: r.updated_at, sentAt: r.sent_at, cancelledAt: r.cancelled_at
    };
  }

  function messages(eventId) {
    return db.prepare('SELECT * FROM event_messages WHERE event_id = ? ORDER BY due_at, id').all(eventId).map((m) => ({
      id: m.id, chatId: m.chat_id, groupName: groupName(m.chat_id), kind: m.kind,
      reminder: m.reminder, reminderLabel: m.reminder && REMINDERS[m.reminder] ? REMINDERS[m.reminder].label : null,
      dueAt: m.due_at, status: m.status, attempts: m.attempts, error: m.error, sentAt: m.sent_at
    }));
  }

  function get(id) {
    const ev = requireEvent(id);
    return { event: toEvent(ev), messages: messages(ev.id) };
  }

  // Events that start in [from, to) (YYYY-MM-DD, WIB), or the next upcoming ones.
  function list({ from, to, upcoming } = {}) {
    if (upcoming) {
      return db.prepare('SELECT * FROM events WHERE cancelled_at IS NULL AND starts_at + duration_min * 60000 >= ? ORDER BY starts_at LIMIT 20')
        .all(now()).map(toEvent);
    }
    const a = parseStart(from, '00:00');
    const b = parseStart(to, '00:00');
    if (a === null || b === null || b <= a) throw badRequest('rentang tanggal tidak valid');
    if (b - a > 62 * 86400000) throw badRequest('rentang maksimal 62 hari');
    return db.prepare('SELECT * FROM events WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at').all(a, b).map(toEvent);
  }

  // `source`: null = the web, 'whatsapp' = the WhatsApp agent (EPIC-013).
  // `autoSend`: "langsung dibuatkan" — send to the groups as soon as the
  // agenda is ready, as if `user` had pressed Kirim.
  function create(user, body, { source = null, autoSend = false } = {}) {
    const v = validate(body, null);
    if (autoSend && !JSON.parse(v.groups || '[]').length) throw badRequest('pilih minimal satu grup WhatsApp untuk dikirim langsung');
    const t = now();
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO events
      (title, starts_at, duration_min, location, attendees, notes, groups, reminders, created_by, created_at, updated_at, source, auto_send_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      v.title, v.starts_at, v.duration_min || 60, v.location || null, v.attendees || null, v.notes || null,
      v.groups || '[]', v.reminders || JSON.stringify(DEFAULT_REMINDERS), user.id, t, t, source, autoSend ? user.id : null);
    writeAgenda(Number(id));
    return get(Number(id));
  }

  // A plain agenda from the event's own details, when Aurix cannot write one
  // and the event must go out anyway.
  function fallbackAgenda(ev) {
    return [`*${ev.title}*`, `🗓 ${fmtWhen(ev.starts_at, ev.duration_min)}`, ev.location ? `📍 ${ev.location}` : null,
      ev.attendees ? `👥 ${ev.attendees}` : null, ev.notes ? `\n${ev.notes}` : null].filter(Boolean).join('\n');
  }

  function autoSendIfAsked(id) {
    const ev = row(id);
    if (!ev || !ev.auto_send_by || ev.cancelled_at) return;
    db.prepare('UPDATE events SET auto_send_by = NULL WHERE id = ?').run(id);
    const u = db.prepare('SELECT id, username FROM users WHERE id = ? AND disabled = 0').get(ev.auto_send_by);
    if (!u) return;
    try { send(u, id); } catch (e) { console.error(`event ${id}: auto-send failed: ${e.message}`); }
  }

  function update(user, id, body) {
    const cur = requireEvent(id);
    if (cur.cancelled_at) throw httpError(409, 'acara sudah dibatalkan');
    const v = validate(body, cur);
    const cols = Object.keys(v).filter((c) => v[c] !== cur[c]);
    if (cols.length) {
      // updated_at tracks the details the agenda is written from; choosing
      // groups or reminders does not make the agenda outdated.
      const details = cols.some((c) => c !== 'groups' && c !== 'reminders');
      db.prepare(`UPDATE events SET ${cols.map((c) => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...cols.map((c) => v[c]), details ? Math.max(now(), cur.updated_at + 1) : cur.updated_at, cur.id);
      scheduleReminders(cur.id);
    }
    return get(cur.id);
  }

  function remove(id) {
    const ev = requireEvent(id);
    if (ev.sent_at && !ev.cancelled_at) throw httpError(409, 'agenda sudah dikirim ke grup — batalkan acaranya saja');
    if (ev.agenda_status === 'running') throw httpError(409, 'agenda sedang disusun, tunggu sebentar');
    db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
    return { ok: true };
  }

  // Aurix drafts the agenda, in the background; the page polls the event.
  function writeAgenda(id) {
    const ev = requireEvent(id);
    if (ev.cancelled_at) throw httpError(409, 'acara sudah dibatalkan');
    if (ev.agenda_status === 'running') throw httpError(409, 'agenda sedang disusun');
    db.prepare("UPDATE events SET agenda_status = 'running', agenda_error = NULL, agenda_runs = agenda_runs + 1 WHERE id = ?").run(ev.id);
    const runs = ev.agenda_runs + 1;
    gateway.ask({ agentId, conversationId: `event-${ev.id}-${runs}`, text: agendaPrompt(ev) })
      .then((content) => {
        // agenda_at = the version of the details the agenda was written from.
        db.prepare("UPDATE events SET agenda = ?, agenda_status = 'done', agenda_at = ? WHERE id = ?")
          .run(content.trim().slice(0, MAX_AGENDA), ev.updated_at, ev.id);
        autoSendIfAsked(ev.id);
      })
      .catch((err) => {
        if (row(ev.id) && row(ev.id).auto_send_by) {
          // "Langsung dibuatkan" must not stall on Aurix: send a plain agenda.
          db.prepare("UPDATE events SET agenda = ?, agenda_status = 'done', agenda_error = ?, agenda_at = ? WHERE id = ?")
            .run(fallbackAgenda(row(ev.id)), 'Aurix gagal: ' + (err.message || 'gagal') + ' — memakai agenda sederhana', ev.updated_at, ev.id);
          autoSendIfAsked(ev.id);
          return;
        }
        db.prepare("UPDATE events SET agenda_status = 'error', agenda_error = ? WHERE id = ?").run(err.message || 'gagal', ev.id);
      });
    return get(ev.id);
  }

  // A person's edit of the agenda text: what they see is what gets sent.
  function saveAgenda(id, agenda) {
    const ev = requireEvent(id);
    if (ev.cancelled_at) throw httpError(409, 'acara sudah dibatalkan');
    if (ev.agenda_status === 'running') throw httpError(409, 'agenda sedang disusun');
    const t = text(agenda, MAX_AGENDA, 'agenda');
    if (!t) throw badRequest('agenda kosong');
    db.prepare("UPDATE events SET agenda = ?, agenda_status = 'done', agenda_error = NULL, agenda_at = ? WHERE id = ?")
      .run(t, ev.updated_at, ev.id);
    return get(ev.id);
  }

  // Pending reminders always follow the current time, groups and choices.
  function scheduleReminders(id) {
    const ev = row(id);
    db.prepare("DELETE FROM event_messages WHERE event_id = ? AND kind = 'reminder' AND status = 'pending'").run(id);
    if (!ev || !ev.sent_at || ev.cancelled_at) return;
    const t = now();
    const ins = db.prepare("INSERT INTO event_messages (event_id, chat_id, kind, reminder, due_at, created_at) VALUES (?, ?, 'reminder', ?, ?, ?)");
    const done = db.prepare("SELECT 1 FROM event_messages WHERE event_id = ? AND chat_id = ? AND kind = 'reminder' AND reminder = ? AND due_at = ? AND status = 'sent'");
    for (const chatId of JSON.parse(ev.groups)) {
      for (const key of JSON.parse(ev.reminders)) {
        const due = REMINDERS[key].due(ev.starts_at);
        if (due <= t || due >= ev.starts_at) continue;          // already passed, or not before the start
        if (done.get(id, chatId, key, due)) continue;           // this exact reminder already went out
        ins.run(id, chatId, key, due, t);
      }
    }
  }

  // "Kirim ke grup": the human approval. Queues the agenda as shown, now.
  function send(user, id) {
    const ev = requireEvent(id);
    if (ev.cancelled_at) throw httpError(409, 'acara sudah dibatalkan');
    if (ev.agenda_status !== 'done' || !ev.agenda) throw httpError(409, 'agenda belum siap');
    const groups = JSON.parse(ev.groups);
    if (!groups.length) throw badRequest('pilih minimal satu grup WhatsApp');
    if (ev.starts_at + ev.duration_min * 60000 < now()) throw httpError(409, 'acara sudah selesai');
    const t = now();
    const pending = db.prepare("SELECT 1 FROM event_messages WHERE event_id = ? AND chat_id = ? AND kind = 'agenda' AND status = 'pending'");
    const ins = db.prepare("INSERT INTO event_messages (event_id, chat_id, kind, body, due_at, created_at) VALUES (?, ?, 'agenda', ?, ?, ?)");
    for (const chatId of groups) if (!pending.get(ev.id, chatId)) ins.run(ev.id, chatId, ev.agenda, t, t);
    db.prepare('UPDATE events SET sent_at = COALESCE(sent_at, ?), sent_by = ? WHERE id = ?').run(t, user.id, ev.id);
    scheduleReminders(ev.id);
    onEvent('event_sent', user.username, `event ${ev.id} → ${groups.length} grup`);
    tick();
    return get(ev.id);
  }

  function cancel(user, id, { notify = false } = {}) {
    const ev = requireEvent(id);
    if (ev.cancelled_at) throw httpError(409, 'acara sudah dibatalkan');
    const t = now();
    db.prepare('UPDATE events SET cancelled_at = ? WHERE id = ?').run(t, ev.id);
    db.prepare("UPDATE event_messages SET status = 'skipped', error = 'acara dibatalkan' WHERE event_id = ? AND status = 'pending'").run(ev.id);
    if (notify) {
      // Tell only the groups that actually received the agenda.
      const got = db.prepare("SELECT DISTINCT chat_id FROM event_messages WHERE event_id = ? AND kind = 'agenda' AND status = 'sent'").all(ev.id);
      const ins = db.prepare("INSERT INTO event_messages (event_id, chat_id, kind, body, due_at, created_at) VALUES (?, ?, 'cancel', ?, ?, ?)");
      for (const g of got) ins.run(ev.id, g.chat_id, cancelText(ev), t, t);
    }
    onEvent('event_cancelled', user.username, `event ${ev.id}${notify ? ' (grup dikabari)' : ''}`);
    tick();
    return get(ev.id);
  }

  async function bridgeSend(chatId, message) {
    let res;
    try {
      res = await fetch(bridgeUrl + '/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message }), signal: AbortSignal.timeout(20000)
      });
    } catch (e) {
      throw new Error('bot WhatsApp tidak bisa dihubungi');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (res.status === 503) throw new Error('bot WhatsApp sedang tidak tersambung');
    if (!res.ok || !data || data.success === false) throw new Error('gagal mengirim' + (data && data.error ? ': ' + data.error : ` (HTTP ${res.status})`));
  }

  // Deliver what is due. One tick at a time; failures retry with backoff.
  let ticking = null;
  function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      const due = db.prepare("SELECT * FROM event_messages WHERE status = 'pending' AND due_at <= ? ORDER BY due_at, id LIMIT 50").all(now());
      for (const m of due) {
        const ev = row(m.event_id);
        const skip = (why) => db.prepare("UPDATE event_messages SET status = 'skipped', error = ? WHERE id = ?").run(why, m.id);
        if (!ev) { skip('acara dihapus'); continue; }
        if (m.kind !== 'cancel' && ev.cancelled_at) { skip('acara dibatalkan'); continue; }
        if (m.kind === 'reminder' && now() >= ev.starts_at) { skip('acara sudah dimulai'); continue; }
        const body = m.kind === 'reminder' ? reminderText(ev, m.reminder) : m.body;
        try {
          await bridgeSend(m.chat_id, body);
          db.prepare("UPDATE event_messages SET status = 'sent', body = ?, sent_at = ?, error = NULL, attempts = attempts + 1 WHERE id = ?").run(body, now(), m.id);
        } catch (err) {
          const attempts = m.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            db.prepare("UPDATE event_messages SET status = 'error', error = ?, attempts = ? WHERE id = ?").run(err.message, attempts, m.id);
          } else {
            // 1, 2, 4, 8 minutes.
            db.prepare('UPDATE event_messages SET error = ?, attempts = ?, due_at = ? WHERE id = ?')
              .run(err.message, attempts, now() + 60000 * 2 ** (attempts - 1), m.id);
          }
        }
      }
    })().catch((err) => console.error('events tick:', err)).finally(() => { ticking = null; });
    return ticking;
  }

  let timer = null;
  function start() {
    if (timer) return;
    timer = setInterval(tick, tickMs);
    timer.unref();
    tick();
  }
  function stop() { clearInterval(timer); timer = null; }

  const options = () => ({
    reminders: Object.entries(REMINDERS).map(([key, r]) => ({ key, label: r.label })),
    defaultReminders: DEFAULT_REMINDERS, agent: agentId
  });

  return { list, get, create, update, remove, writeAgenda, saveAgenda, send, cancel, tick, start, stop, options, knownGroup };
}

module.exports = { createEvents, parseStart, fmtWhen, reminderText, REMINDERS };
