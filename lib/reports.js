// Reports (EPIC-015): every report an agent produced, in one archive.
//
// Sources: group summaries from Summary Chat (wa_summaries), the bot's own
// scheduled digests (Hermes cron output files, read only), discussion
// summaries (stored here the moment they are done), and the weekly team
// report Aurix writes every Monday 07.00 WIB from last week's tasks, events
// and discussions. Each person has their own read marks; the sidebar badge
// is what they have not read.
const fs = require('fs');
const os = require('os');
const path = require('path');

const WIB_MS = 7 * 3600 * 1000;
const OUTPUT_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const PROFILE_RE = /^[a-z0-9_-]{1,64}$/;
const MAX_BODY = 60000;
const WEEKLY_HOUR = 7;      // Monday 07.00 WIB
const KINDS = { wa_summary: 'Ringkasan grup WA', wa_digest: 'Ringkasan otomatis bot', discussion: 'Ringkasan diskusi', weekly: 'Laporan mingguan' };

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const badRequest = (msg) => httpError(400, msg);
const wibDate = (ms) => new Date(ms + WIB_MS).toISOString().slice(0, 10);
const fmtDay = (ms) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' }).format(ms);
const fmtLong = (ms) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ms);

// Monday 00.00 WIB of the week containing `ms`.
function weekStart(ms) {
  const d = new Date(ms + WIB_MS);
  const dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) - WIB_MS;
}

// Markdown -> what WhatsApp renders: *bold*, • lists, headings in bold.
function toWhatsApp(md) {
  return String(md || '')
    .replace(/^#{1,6}\s+(.+)$/gm, (m, t) => `*${t.replace(/\*/g, '').trim()}*`)
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function createReports({
  db, gateway = null, agentId = process.env.CHAT_WA_SUMMARY_AGENT || 'aurix', onEvent = () => {},
  hermesHome = process.env.CHAT_HERMES_HOME || path.join(os.homedir(), '.hermes'),
  bridgeUrl = process.env.CHAT_WA_BRIDGE_URL || 'http://127.0.0.1:3010',
  send = null, now = () => Date.now(), tickMs = 60000
}) {
  const person = (id) => (id ? (db.prepare('SELECT display_name FROM users WHERE id = ?').get(id) || {}).display_name || null : null);
  const groupName = (chatId) => (db.prepare('SELECT name FROM wa_groups WHERE chat_id = ?').get(chatId) || {}).name || null;
  const insert = db.prepare(`INSERT OR IGNORE INTO reports (kind, title, subtitle, period_from, period_to, agent_id, body, status, source_key, created_by, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?)`);

  // ── sources ──
  function importWaSummaries() {
    const rows = db.prepare(`SELECT s.* FROM wa_summaries s WHERE s.status = 'done'
                              AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.source_key = 'wa_summary:' || s.id)`).all();
    for (const s of rows) {
      const g = groupName(s.chat_id) || s.chat_id.replace(/@.*/, '');
      const span = wibDate(s.from_ts) === wibDate(s.to_ts) ? fmtDay(s.from_ts) : `${fmtDay(s.from_ts)}–${fmtDay(s.to_ts)}`;
      insert.run('wa_summary', `Ringkasan grup ${g}`, `${span} · ${s.message_count} pesan`, s.from_ts, s.to_ts, s.agent_id, String(s.content || '').slice(0, MAX_BODY), 'wa_summary:' + s.id, s.user_id, s.finished_at || s.created_at);
    }
  }

  function cronDirs() {
    const out = [['default', path.join(hermesHome, 'cron')]];
    try {
      for (const p of fs.readdirSync(path.join(hermesHome, 'profiles'))) if (PROFILE_RE.test(p)) out.push([p, path.join(hermesHome, 'profiles', p, 'cron')]);
    } catch (e) { /* no profiles */ }
    return out;
  }
  function importCronOutputs() {
    for (const [profile, dir] of cronDirs()) {
      let jobs = [];
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8')); jobs = Array.isArray(j) ? j : Object.values(j.jobs || {}); } catch (e) { continue; }
      for (const job of jobs) {
        if (!job || !JOB_ID_RE.test(String(job.id))) continue;
        let files = [];
        try { files = fs.readdirSync(path.join(dir, 'output', String(job.id))).filter((f) => OUTPUT_RE.test(f)); } catch (e) { continue; }
        for (const f of files) {
          const key = `cron:${profile}:${job.id}:${f}`;
          if (db.prepare('SELECT 1 FROM reports WHERE source_key = ?').get(key)) continue;
          let text;
          try { text = fs.readFileSync(path.join(dir, 'output', String(job.id), f), 'utf8'); } catch (e) { continue; }
          const at = text.search(/^## Response[ \t]*$/m);
          const body = (at < 0 ? text : text.slice(at).replace(/^## Response[ \t]*\r?\n/, '')).trim().slice(0, MAX_BODY);
          if (!body || body === '-') continue;      // "nothing new" runs are not reports
          const [, y, mo, d, h, mi, s] = f.match(OUTPUT_RE);
          const ts = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - WIB_MS;
          const to = typeof job.deliver === 'string' && job.deliver.startsWith('whatsapp:') ? groupName(job.deliver.slice(9)) : null;
          insert.run('wa_digest', to ? `Ringkasan otomatis grup ${to}` : `Hasil otomatis · ${job.name || job.id}`, `${job.name || job.id} · ${job.schedule_display || 'terjadwal'}`, null, ts, profile === 'default' ? 'bot' : profile, body, key, null, ts);
        }
      }
    }
  }
  function sync() {
    try { importWaSummaries(); } catch (e) { console.error('reports: wa summaries:', e.message); }
    try { importCronOutputs(); } catch (e) { console.error('reports: cron outputs:', e.message); }
  }

  // From Chat & Discussion when a summary job finishes.
  function addDiscussion({ user, room, label, count, from, to, content, agentId: a }) {
    insert.run('discussion', `Ringkasan ${room.kind === 'dm' ? 'pesan langsung' : '#' + room.name}`, `${label} · ${count} pesan`, from, to, a || agentId,
      String(content || '').slice(0, MAX_BODY), `discussion:${room.id}:${to}:${user.id}`, user.id, now());
    const r = db.prepare('SELECT * FROM reports WHERE source_key = ?').get(`discussion:${room.id}:${to}:${user.id}`);
    // The asker read it in the dialog already.
    if (r) db.prepare('INSERT OR IGNORE INTO report_reads (report_id, user_id, read_at) VALUES (?, ?, ?)').run(r.id, user.id, now());
    return r && r.id;
  }

  // ── weekly team report ──
  function weekData(from, to) {
    const name = (id) => person(id) || '—';
    const done = db.prepare('SELECT title, assignee_id FROM tasks WHERE status = ? AND done_at >= ? AND done_at < ? ORDER BY done_at').all('done', from, to);
    const overdue = db.prepare("SELECT title, assignee_id, due_date FROM tasks WHERE status != 'done' AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date").all(wibDate(to));
    const created = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE created_at >= ? AND created_at < ?').get(from, to).n;
    const events = db.prepare('SELECT title, starts_at, location, cancelled_at, sent_at FROM events WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at').all(from, to);
    const upcoming = db.prepare('SELECT title, starts_at FROM events WHERE starts_at >= ? AND starts_at < ? AND cancelled_at IS NULL ORDER BY starts_at').all(to, to + 7 * 86400000);
    const rooms = db.prepare(`SELECT r.kind, r.name, COUNT(*) AS n FROM room_messages m JOIN rooms r ON r.id = m.room_id
                               WHERE m.created_at >= ? AND m.created_at < ? AND m.deleted_at IS NULL AND r.kind = 'channel' GROUP BY r.id ORDER BY n DESC`).all(from, to);
    const agentAnswers = db.prepare('SELECT COUNT(*) AS n FROM room_messages WHERE agent_id IS NOT NULL AND created_at >= ? AND created_at < ?').get(from, to).n;
    const chats = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE role = ? AND created_at >= ? AND created_at < ?').get('user', from, to).n;
    const waSummaries = db.prepare("SELECT title, body FROM reports WHERE kind IN ('wa_summary', 'wa_digest') AND created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 6").all(from, to);
    const topics = db.prepare(`SELECT r.name, m.body FROM room_messages m JOIN rooms r ON r.id = m.room_id
                                WHERE m.created_at >= ? AND m.created_at < ? AND m.deleted_at IS NULL AND m.parent_id IS NULL AND r.kind = 'channel' AND length(m.body) > 40
                                ORDER BY length(m.body) DESC LIMIT 15`).all(from, to);
    return {
      done: done.map((t) => `- ${t.title} (${name(t.assignee_id)})`), overdue: overdue.map((t) => `- ${t.title} (${name(t.assignee_id)}, tenggat ${t.due_date})`), created,
      events: events.map((e) => `- ${fmtDay(e.starts_at)} ${e.title}${e.location ? ' @ ' + e.location : ''}${e.cancelled_at ? ' (dibatalkan)' : e.sent_at ? '' : ' (draf)'}`),
      upcoming: upcoming.map((e) => `- ${fmtDay(e.starts_at)} ${e.title}`),
      rooms: rooms.map((r) => `- #${r.name}: ${r.n} pesan`), agentAnswers, chats,
      waSummaries: waSummaries.map((r) => `### ${r.title}\n${r.body.slice(0, 1200)}`),
      topics: topics.map((t) => `- [#${t.name}] ${t.body.replace(/\s+/g, ' ').slice(0, 240)}`)
    };
  }

  function weeklyPrompt(from, to, d) {
    const sec = (h, lines, empty) => `${h}\n${lines.length ? lines.join('\n') : empty}`;
    return [
      `Tulis *laporan mingguan tim HG* untuk ${fmtLong(from)} – ${fmtLong(to - 1)} dalam Bahasa Indonesia, Markdown, untuk dibaca pimpinan dan tim.`,
      'Struktur: ringkasan 3–4 kalimat; **Tugas** (selesai, terlambat — sebut nama); **Acara & meeting**; **Diskusi tim** (topik penting, keputusan); **Dari grup WhatsApp** (bila ada); **Perhatian minggu depan** (acara mendatang, tugas terlambat). Lewati bagian yang kosong. Jangan mengarang; hanya dari data di bawah. Jangan memakai tool, jangan mengirim pesan.', '',
      sec(`## Tugas selesai (${d.done.length})`, d.done, '(tidak ada)'), sec(`## Tugas terlambat saat ini (${d.overdue.length})`, d.overdue, '(tidak ada)'), `Tugas baru dibuat: ${d.created}`, '',
      sec('## Acara minggu ini', d.events, '(tidak ada)'), sec('## Acara minggu depan', d.upcoming, '(tidak ada)'), '',
      sec('## Aktivitas diskusi', d.rooms, '(tidak ada)'), `Jawaban agent di diskusi: ${d.agentAnswers}; pertanyaan ke agent di chat pribadi: ${d.chats}`, '',
      sec('## Pesan diskusi terpanjang (bahan topik)', d.topics, '(tidak ada)'), '',
      sec('## Ringkasan grup WhatsApp minggu ini', d.waSummaries, '(tidak ada)')
    ].join('\n');
  }

  // Writes (or rewrites) the report for the week starting at `from`.
  function generateWeekly(user, from) {
    if (!gateway) throw httpError(503, 'agent tidak tersedia');
    const to = from + 7 * 86400000;
    const key = 'weekly:' + wibDate(from);
    const existing = db.prepare('SELECT * FROM reports WHERE source_key = ?').get(key);
    if (existing && existing.status === 'running') throw httpError(409, 'laporan minggu ini sedang dibuat');
    const title = `Laporan mingguan ${fmtDay(from)} – ${fmtDay(to - 1)}`;
    let id;
    if (existing) {
      db.prepare("UPDATE reports SET status = 'running', error = NULL, subtitle = ?, created_by = ?, created_at = ? WHERE id = ?")
        .run(user ? `diminta ${person(user.id)}` : 'otomatis, Senin pagi', user ? user.id : null, now(), existing.id);
      db.prepare('DELETE FROM report_reads WHERE report_id = ?').run(existing.id);
      id = existing.id;
    } else {
      id = Number(db.prepare(`INSERT INTO reports (kind, title, subtitle, period_from, period_to, agent_id, body, status, source_key, created_by, created_at)
                              VALUES ('weekly', ?, ?, ?, ?, ?, '', 'running', ?, ?, ?)`).run(title, user ? `diminta ${person(user.id)}` : 'otomatis, Senin pagi', from, to, agentId, key, user ? user.id : null, now()).lastInsertRowid);
    }
    gateway.ask({ agentId, conversationId: `weekly-${wibDate(from)}-${now()}`, text: weeklyPrompt(from, to, weekData(from, to)) })
      .then((c) => db.prepare("UPDATE reports SET body = ?, status = 'done', error = NULL WHERE id = ?").run(c.trim().slice(0, MAX_BODY), id))
      .catch((e) => db.prepare("UPDATE reports SET status = 'error', error = ? WHERE id = ?").run(e.message, id));
    return get(user, id);
  }

  // Monday from 07.00 WIB: last week's report, once.
  function tick() {
    sync();
    if (!gateway) return;
    const t = now();
    const thisWeek = weekStart(t);
    if (t < thisWeek + WEEKLY_HOUR * 3600000) return;
    const lastWeek = thisWeek - 7 * 86400000;
    if (db.prepare('SELECT 1 FROM reports WHERE source_key = ?').get('weekly:' + wibDate(lastWeek))) return;
    try { generateWeekly(null, lastWeek); } catch (e) { console.error('weekly report:', e.message); }
  }
  let timer = null;
  function start() { if (!timer) { timer = setInterval(tick, tickMs); timer.unref(); setTimeout(tick, 2000).unref(); } }
  function stop() { clearInterval(timer); timer = null; }

  // ── reading ──
  const isRead = db.prepare('SELECT 1 FROM report_reads WHERE report_id = ? AND user_id = ?');
  function toReport(user, r, full) {
    return {
      id: r.id, kind: r.kind, kindLabel: KINDS[r.kind], title: r.title, subtitle: r.subtitle, periodFrom: r.period_from, periodTo: r.period_to,
      agent: r.agent_id, status: r.status, error: r.error, createdBy: person(r.created_by), createdAt: r.created_at,
      sentTo: JSON.parse(r.sent_to).map((id) => ({ id, name: groupName(id) })), unread: !isRead.get(r.id, user.id),
      body: full ? r.body : undefined, preview: full ? undefined : String(r.body || '').replace(/[#*_`>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)
    };
  }
  function list(user, { kind } = {}) {
    sync();
    if (kind && !KINDS[kind]) throw badRequest('jenis laporan tidak dikenal');
    const rows = kind ? db.prepare('SELECT * FROM reports WHERE kind = ? ORDER BY created_at DESC LIMIT 200').all(kind)
      : db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT 200').all();
    return { reports: rows.map((r) => toReport(user, r, false)), kinds: KINDS, unread: unread(user) };
  }
  function unread(user) {
    return db.prepare(`SELECT COUNT(*) AS n FROM reports r WHERE r.status = 'done' AND r.kind != 'discussion' AND NOT EXISTS
                        (SELECT 1 FROM report_reads x WHERE x.report_id = r.id AND x.user_id = ?)`).get(user.id).n
      + db.prepare(`SELECT COUNT(*) AS n FROM reports r WHERE r.status = 'done' AND r.kind = 'discussion' AND r.created_by != ? AND NOT EXISTS
                        (SELECT 1 FROM report_reads x WHERE x.report_id = r.id AND x.user_id = ?)`).get(user.id, user.id).n;
  }
  // `user` may be null for the scheduler (then nothing is marked read).
  function get(user, id, { markRead = false } = {}) {
    const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(id));
    if (!r) throw httpError(404, 'laporan tidak ditemukan');
    if (markRead && user && r.status === 'done') db.prepare('INSERT OR IGNORE INTO report_reads (report_id, user_id, read_at) VALUES (?, ?, ?)').run(r.id, user.id, now());
    return toReport(user || { id: 0 }, r, true);
  }
  function remove(user, id) {
    const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(id));
    if (!r) throw httpError(404, 'laporan tidak ditemukan');
    if (user.role !== 'admin' && r.created_by !== user.id) throw httpError(403, 'hanya pembuat laporan atau admin yang bisa menghapus');
    db.prepare('DELETE FROM reports WHERE id = ?').run(r.id);
    onEvent('report_deleted', user.username, `${r.kind} #${r.id} ${r.title}`);
    return { ok: true };
  }

  // ── sending to a WhatsApp group ──
  async function bridgeSend(chatId, message) {
    let res;
    try {
      res = await fetch(bridgeUrl + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, message }), signal: AbortSignal.timeout(20000) });
    } catch (e) { throw httpError(502, 'bot WhatsApp tidak bisa dihubungi'); }
    if (res.status === 503) throw httpError(502, 'bot WhatsApp sedang tidak tersambung');
    let data = null; try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || !data || data.success === false) throw httpError(502, 'gagal mengirim' + (data && data.error ? ': ' + data.error : ''));
  }
  async function sendToGroup(user, id, chatId) {
    const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(id));
    if (!r) throw httpError(404, 'laporan tidak ditemukan');
    if (r.status !== 'done') throw httpError(409, 'laporan belum selesai');
    if (!/^\d[\d-]*@g\.us$/.test(String(chatId)) || !db.prepare('SELECT 1 FROM wa_groups WHERE chat_id = ?').get(chatId)) throw badRequest('grup tidak dikenal');
    const text = `📄 *${r.title}*${r.subtitle ? `\n_${r.subtitle}_` : ''}\n\n${toWhatsApp(r.body)}\n\n_Dibagikan oleh ${person(user.id)} lewat HG Chat_`;
    await (send || bridgeSend)(chatId, text);
    const sent = [...new Set([...JSON.parse(r.sent_to), chatId])];
    db.prepare('UPDATE reports SET sent_to = ? WHERE id = ?').run(JSON.stringify(sent), r.id);
    onEvent('report_sent', user.username, `${r.kind} #${r.id} → ${groupName(chatId) || chatId}`);
    return get(user, r.id);
  }

  return { sync, addDiscussion, generateWeekly, tick, start, stop, list, unread, get, remove, sendToGroup, weekStart, KINDS };
}

module.exports = { createReports, toWhatsApp, weekStart };
