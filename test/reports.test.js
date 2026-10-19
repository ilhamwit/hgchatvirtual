// EPIC-015 Reports: imports (group summaries, Hermes cron outputs), discussion
// summaries, the weekly report (once a week), read marks and sending.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { createReports, toWhatsApp, weekStart } = require('../lib/reports');
const { createRooms } = require('../lib/rooms');
const { startServer, tempDir } = require('./helpers');

const at = (s) => Date.parse(s + '+07:00');
const G = '120363000000000011@g.us';
const settle = () => new Promise((r) => setTimeout(r, 25));

function hermesHome() {
  const home = tempDir();
  const out = path.join(home, 'cron', 'output', 'df2b6e9ac5b9');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(home, 'cron', 'jobs.json'), JSON.stringify({ jobs: [{ id: 'df2b6e9ac5b9', name: 'wa-group-summary', schedule_display: 'every 360m', deliver: 'whatsapp:' + G }] }));
  fs.writeFileSync(path.join(out, '2026-10-18_21-23-35.md'), '# Cron Job\n## Prompt\nrahasia\n## Response\n\n**Ilham** bertanya soal kalender.\n');
  fs.writeFileSync(path.join(out, '2026-10-19_03-23-35.md'), '# Cron Job\n## Response\n\n-\n');   // nothing new
  fs.writeFileSync(path.join(out, 'notes.txt'), 'x');
  return home;
}

function setup({ reply = async () => '# Laporan\n\n**Tugas** selesai 2.' } = {}) {
  const db = openDb(path.join(tempDir(), 't.db'));
  const add = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, 'x', ?, 0, 0)");
  add.run(1, 'ilham', 'Ilham', 'admin'); add.run(2, 'irfan', 'Irfan', 'member');
  db.prepare('INSERT INTO wa_groups (chat_id, name, participants, checked_at) VALUES (?, ?, 3, 0)').run(G, 'HG Bot Testing');
  const clock = { t: at('2026-10-20T10:00:00') };   // Tuesday
  const sent = [];
  const prompts = [];
  const gateway = { ask: async (o) => { prompts.push(o); return reply(o); } };
  const reports = createReports({ db, gateway, hermesHome: hermesHome(), now: () => clock.t, send: async (chatId, text) => sent.push({ chatId, text }) });
  const ilham = { id: 1, username: 'ilham', role: 'admin' }; const irfan = { id: 2, username: 'irfan', role: 'member' };
  return { db, clock, sent, prompts, reports, ilham, irfan, gateway };
}

test('markdown becomes WhatsApp formatting', () => {
  assert.strictEqual(toWhatsApp('# Judul\n\n**Tebal** dan `kode`\n- satu\n* dua'), '*Judul*\n\n*Tebal* dan kode\n• satu\n• dua');
  assert.strictEqual(weekStart(at('2026-10-20T10:00:00')), at('2026-10-19T00:00:00'), 'Monday 00.00 WIB');
  assert.strictEqual(weekStart(at('2026-10-19T00:30:00')), at('2026-10-19T00:00:00'));
  assert.strictEqual(weekStart(at('2026-10-18T23:30:00')), at('2026-10-12T00:00:00'), 'Sunday night belongs to the previous week');
});

test('group summaries and cron outputs are imported once, never "nothing new" runs', () => {
  const { db, reports, ilham, irfan } = setup();
  db.prepare(`INSERT INTO wa_summaries (chat_id, from_ts, to_ts, agent_id, user_id, status, message_count, content, created_at, finished_at)
              VALUES (?, ?, ?, 'aurix', 2, 'done', 12, 'Topik: target Q4', ?, ?)`).run(G, at('2026-10-18T00:00:00'), at('2026-10-18T23:59:59'), at('2026-10-19T09:00:00'), at('2026-10-19T09:01:00'));
  db.prepare(`INSERT INTO wa_summaries (chat_id, from_ts, to_ts, agent_id, user_id, status, message_count, created_at) VALUES (?, 1, 2, 'aurix', 2, 'running', 0, 3)`).run(G);
  let l = reports.list(ilham);
  assert.deepStrictEqual(l.reports.map((r) => [r.kind, r.title, r.subtitle, r.unread]), [
    ['wa_summary', 'Ringkasan grup HG Bot Testing', '18 Okt · 12 pesan', true],
    ['wa_digest', 'Ringkasan otomatis grup HG Bot Testing', 'wa-group-summary · every 360m', true]
  ]);
  assert.strictEqual(l.unread, 2);
  reports.list(ilham); reports.sync();
  assert.strictEqual(reports.list(ilham).reports.length, 2, 'no duplicates');
  const digest = reports.get(ilham, l.reports[1].id, { markRead: true });
  assert.strictEqual(digest.body, '**Ilham** bertanya soal kalender.', 'only the Response section');
  assert.strictEqual(digest.createdAt, at('2026-10-18T21:23:35'));
  assert.strictEqual(reports.unread(ilham), 1);
  assert.strictEqual(reports.unread(irfan), 2, 'read marks are per person');
  assert.deepStrictEqual(reports.list(ilham, { kind: 'wa_summary' }).reports.length, 1);
  assert.throws(() => reports.list(ilham, { kind: 'x' }), /jenis/);
});

test('discussion summaries are archived when done; the asker already read it', async () => {
  const { db, reports, ilham, irfan, clock } = setup();
  const rooms = createRooms({ db, gateway: { ask: async () => '**Topik utama**\n- target' }, now: () => clock.t, onSummary: reports.addDiscussion });
  const umum = rooms.list(ilham)[0].id;
  rooms.post(irfan, umum, { body: 'Target Q4 Surabaya 1,5 M' });
  rooms.summarize(ilham, umum, { days: 7 });
  await settle();
  const l = reports.list(irfan, { kind: 'discussion' });
  assert.deepStrictEqual(l.reports.map((r) => [r.kind, r.title, r.subtitle, r.createdBy, r.unread]), [['discussion', 'Ringkasan #umum', '7 hari terakhir · 1 pesan', 'Ilham', true]]);
  assert.strictEqual(reports.list(ilham, { kind: 'discussion' }).reports[0].unread, false, 'the asker saw it in the dialog');
  assert.strictEqual(reports.unread(irfan) - reports.unread(ilham), 1);
});

test('weekly report: Aurix writes from last week\'s data; once per week; rewrite on demand', async () => {
  const { db, reports, ilham, clock, prompts } = setup();
  db.prepare("INSERT INTO tasks (title, assignee_id, status, created_by, created_at, updated_at, done_at, done_by) VALUES ('Rekap absensi', 2, 'done', 2, ?, ?, ?, 2)").run(at('2026-10-14T09:00:00'), at('2026-10-15T09:00:00'), at('2026-10-15T09:00:00'));
  db.prepare("INSERT INTO tasks (title, assignee_id, status, due_date, created_by, created_at, updated_at) VALUES ('Kontrak vendor', 1, 'todo', '2026-10-16', 1, 1, 1)").run();
  db.prepare("INSERT INTO events (title, starts_at, duration_min, location, groups, reminders, created_at, updated_at, sent_at) VALUES ('Rapat Q4', ?, 60, 'Zoom', '[]', '[]', 1, 1, 1)").run(at('2026-10-16T10:00:00'));

  // Tuesday 10.00: Monday 07.00 has passed, no report yet -> written automatically (no user to mark read).
  reports.tick();
  assert.strictEqual(reports.list(ilham, { kind: 'weekly' }).reports[0].status, 'running');
  await settle();
  const l = reports.list(ilham, { kind: 'weekly' });
  assert.strictEqual(l.reports.length, 1);
  const r = reports.get(ilham, l.reports[0].id);
  assert.deepStrictEqual([r.title, r.subtitle, r.status, r.body, r.createdBy], ['Laporan mingguan 12 Okt – 18 Okt', 'otomatis, Senin pagi', 'done', '# Laporan\n\n**Tugas** selesai 2.', null]);
  assert.match(prompts[0].text, /Senin, 12 Oktober 2026 – Minggu, 18 Oktober 2026/);
  assert.match(prompts[0].text, /## Tugas selesai \(1\)\n- Rekap absensi \(Irfan\)/);
  assert.match(prompts[0].text, /## Tugas terlambat saat ini \(1\)\n- Kontrak vendor \(Ilham, tenggat 2026-10-16\)/);
  assert.match(prompts[0].text, /## Acara minggu ini\n- 16 Okt Rapat Q4 @ Zoom\n/);
  reports.tick(); reports.tick();
  await settle();
  assert.strictEqual(prompts.length, 1, 'only once a week');

  // Monday 06.00 next week: too early; 07.00: the next one.
  clock.t = at('2026-10-26T06:00:00'); reports.tick(); await settle();
  assert.strictEqual(prompts.length, 1);
  clock.t = at('2026-10-26T07:00:00'); reports.tick(); await settle();
  assert.strictEqual(prompts.length, 2);
  assert.strictEqual(reports.list(ilham, { kind: 'weekly' }).reports[0].title, 'Laporan mingguan 19 Okt – 25 Okt');

  // On demand: rewrite the same week, same row.
  const again = reports.generateWeekly(ilham, weekStart(clock.t) - 7 * 86400000);
  assert.deepStrictEqual([again.status, again.subtitle], ['running', 'diminta Ilham']);
  assert.throws(() => reports.generateWeekly(ilham, weekStart(clock.t) - 7 * 86400000), (e) => e.status === 409);
  await settle();
  assert.strictEqual(reports.list(ilham, { kind: 'weekly' }).reports.length, 2);
});

test('a failed weekly report says so; sending to a group uses WhatsApp formatting', async () => {
  const { reports, ilham, irfan, sent, clock, gateway } = setup({ reply: async () => { throw new Error('Hermes error 500'); } });
  reports.tick(); await settle();
  let r = reports.list(ilham, { kind: 'weekly' }).reports[0];
  assert.deepStrictEqual([r.status, reports.get(ilham, r.id).error], ['error', 'Hermes error 500']);
  await assert.rejects(reports.sendToGroup(ilham, r.id, G), (e) => e.status === 409);
  assert.strictEqual(reports.unread(ilham), 1, 'a failed report is not "unread" (the 1 is the digest from the fake Hermes home)');

  gateway.ask = async () => '# Laporan mingguan\n\n**Tugas**\n- satu';
  reports.generateWeekly(ilham, weekStart(clock.t) - 7 * 86400000); await settle();
  await assert.rejects(reports.sendToGroup(ilham, r.id, '120363999@g.us'), /grup tidak dikenal/);
  const out = await reports.sendToGroup(ilham, r.id, G);
  assert.deepStrictEqual(out.sentTo, [{ id: G, name: 'HG Bot Testing' }]);
  assert.strictEqual(sent[0].chatId, G);
  assert.match(sent[0].text, /^📄 \*Laporan mingguan 12 Okt – 18 Okt\*\n_diminta Ilham_\n\n\*Laporan mingguan\*\n\n\*Tugas\*\n• satu\n\n_Dibagikan oleh Ilham lewat HG Chat_$/);
  assert.throws(() => reports.remove(irfan, r.id), (e) => e.status === 403);
  reports.remove(ilham, r.id);
  assert.throws(() => reports.get(ilham, r.id), (e) => e.status === 404);
});

test('reports API: list with unread, read marks, weekly on demand, delete', async () => {
  const srv = await startServer([{ username: 'ilham', password: 'ilham-password-1', role: 'admin' }, { username: 'irfan', password: 'irfan-password-1' }]);
  try {
    assert.strictEqual((await srv.request('/api/reports')).status, 401);
    const a = (await srv.login('ilham', 'ilham-password-1')).cookie;
    const b = (await srv.login('irfan', 'irfan-password-1')).cookie;
    let l = await srv.json(a, 'GET', '/api/reports');
    assert.deepStrictEqual([l.status, l.body.reports, l.body.unread], [200, [], 0]);
    const w = await srv.json(a, 'POST', '/api/reports/weekly', { week: 'last' });
    assert.strictEqual(w.status, 202);
    assert.strictEqual(w.body.report.status, 'running');
    await new Promise((r) => setTimeout(r, 400));
    const r = await srv.json(b, 'GET', '/api/reports/' + w.body.report.id);
    assert.strictEqual(r.body.report.status, 'error', 'tests have no Hermes');
    assert.strictEqual((await srv.json(b, 'DELETE', '/api/reports/' + w.body.report.id)).status, 403);
    assert.strictEqual((await srv.json(a, 'DELETE', '/api/reports/' + w.body.report.id)).status, 200);
    assert.strictEqual((await srv.json(a, 'GET', '/api/reports/unread')).body.unread, 0);
  } finally {
    await srv.stop();
  }
});
