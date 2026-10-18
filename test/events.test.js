// EPIC-009: Schedule — events, Aurix agendas, sending to WhatsApp groups and
// reminders. A fake clock, a fake Hermes (gateway) and a fake WhatsApp bridge.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createEvents, parseStart, fmtWhen } = require('../lib/events');
const { startServer, startFakeGateway, tempDir } = require('./helpers');

const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';
const at = (s) => Date.parse(s + '+07:00');           // WIB wall clock -> instant
const settle = () => new Promise((r) => setImmediate(r));

function fakeBridge() {
  const sent = [];
  const state = { mode: 'ok' };
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      if (state.mode === 'down') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"Not connected to WhatsApp"}'); }
      sent.push({ path: req.url, ...JSON.parse(raw) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"success":true,"messageId":"x"}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, sent, state, close: () => srv.close() })));
}

async function setup() {
  const db = openDb(path.join(tempDir(), 't.db'));
  db.prepare("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (1, 'irfan', 'Irfan', 'x', 0)").run();
  const addGroup = db.prepare('INSERT INTO wa_groups (chat_id, name, participants, checked_at) VALUES (?, ?, 3, 0)');
  addGroup.run(G1, 'HG Bot Testing');
  addGroup.run(G2, 'Tim Inti');
  const clock = { t: at('2026-10-19T08:00:00') };
  const prompts = [];
  const gateway = { reply: (p) => '*Rapat*\nAgenda dari Aurix', ask: async ({ agentId, conversationId, text }) => { prompts.push({ agentId, conversationId, text }); return gateway.reply(text); } };
  const bridge = await fakeBridge();
  const audit = [];
  const ev = createEvents({ db, gateway, bridgeUrl: bridge.url, now: () => clock.t, onEvent: (...a) => audit.push(a) });
  return { db, clock, prompts, gateway, bridge, audit, ev, user: { id: 1, username: 'irfan' } };
}

test('dates and times are read and written in WIB', () => {
  assert.strictEqual(parseStart('2026-10-20', '10:00'), Date.parse('2026-10-20T03:00:00Z'));
  for (const [d, t] of [['2026-02-30', '10:00'], ['2026-10-20', '24:00'], ['20-10-2026', '10:00'], ['2026-10-20', '9:00'], [undefined, '10:00']]) {
    assert.strictEqual(parseStart(d, t), null, `${d} ${t}`);
  }
  assert.strictEqual(fmtWhen(at('2026-10-20T10:00:00'), 90), 'Selasa, 20 Oktober 2026 · 10.00–11.30 WIB');
});

test('an event is validated, and Aurix drafts its agenda', async () => {
  const { ev, user, prompts, bridge } = await setup();
  try {
    const bad = (body, re) => assert.throws(() => ev.create(user, body), (e) => e.status === 400 && re.test(e.message), JSON.stringify(body));
    bad({ date: '2026-10-20', time: '10:00' }, /judul/);
    bad({ title: 'Rapat', date: '2026-10-20' }, /tanggal dan jam/);
    bad({ title: 'Rapat', date: '2026-10-18', time: '10:00' }, /sudah lewat/);
    bad({ title: 'Rapat', date: '2026-10-20', time: '10:00', groups: ['120363999@g.us'] }, /grup tidak dikenal/);
    bad({ title: 'Rapat', date: '2026-10-20', time: '10:00', groups: ['halo'] }, /grup tidak dikenal/);
    bad({ title: 'Rapat', date: '2026-10-20', time: '10:00', reminders: ['m5'] }, /pengingat tidak dikenal/);
    bad({ title: 'Rapat', date: '2026-10-20', time: '10:00', durationMin: 2 }, /durasi/);
    bad({ title: 'x'.repeat(201), date: '2026-10-20', time: '10:00' }, /maksimal 200/);

    const { event } = ev.create(user, { title: 'Rapat mingguan', date: '2026-10-20', time: '10:00', durationMin: 60, location: 'Ruang Rapat 2', attendees: 'Irfan, Cahyo', groups: [G1] });
    assert.strictEqual(event.agendaStatus, 'running');
    assert.deepStrictEqual(event.reminders, ['d1', 'm60'], 'default reminders');
    assert.deepStrictEqual(event.groups, [{ id: G1, name: 'HG Bot Testing' }]);
    assert.strictEqual(event.status, 'draft');
    assert.strictEqual(event.createdBy, 'Irfan');
    await settle();
    const got = ev.get(event.id).event;
    assert.strictEqual(got.agendaStatus, 'done');
    assert.strictEqual(got.agenda, '*Rapat*\nAgenda dari Aurix');
    assert.strictEqual(prompts[0].agentId, 'aurix');
    assert.strictEqual(prompts[0].conversationId, `event-${event.id}-1`);
    assert.match(prompts[0].text, /Rapat mingguan[\s\S]*Selasa, 20 Oktober 2026 · 10\.00–11\.00 WIB[\s\S]*Ruang Rapat 2[\s\S]*Irfan, Cahyo/);
    assert.strictEqual(bridge.sent.length, 0, 'creating never sends anything');

    // Changing details marks the agenda outdated; choosing groups does not.
    ev.update(user, event.id, { groups: [G1, G2] });
    assert.strictEqual(ev.get(event.id).event.agendaStale, false);
    ev.update(user, event.id, { location: 'Zoom' });
    assert.strictEqual(ev.get(event.id).event.agendaStale, true);
    ev.saveAgenda(event.id, 'Agenda versi saya');
    assert.deepStrictEqual([ev.get(event.id).event.agenda, ev.get(event.id).event.agendaStale], ['Agenda versi saya', false]);
    assert.throws(() => ev.saveAgenda(event.id, '   '), /agenda kosong/);
  } finally { bridge.close(); }
});

test('an agenda that fails can be written again', async () => {
  const { ev, user, gateway, bridge } = await setup();
  try {
    gateway.reply = () => { throw new Error('Hermes tidak bisa dihubungi'); };
    const { event } = ev.create(user, { title: 'Rapat', date: '2026-10-20', time: '10:00' });
    await settle();
    assert.deepStrictEqual([ev.get(event.id).event.agendaStatus, ev.get(event.id).event.agendaError], ['error', 'Hermes tidak bisa dihubungi']);
    assert.throws(() => ev.send(user, event.id), (e) => e.status === 409 && /agenda belum siap/.test(e.message));
    gateway.reply = () => 'Agenda baru';
    ev.writeAgenda(event.id);
    assert.throws(() => ev.writeAgenda(event.id), (e) => e.status === 409, 'one draft at a time');
    await settle();
    assert.strictEqual(ev.get(event.id).event.agenda, 'Agenda baru');
  } finally { bridge.close(); }
});

test('Kirim sends the agenda as shown, then reminders follow the event', async () => {
  const { ev, user, clock, bridge, audit } = await setup();
  try {
    const { event } = ev.create(user, { title: 'Rapat mingguan', date: '2026-10-20', time: '10:00', location: 'Ruang Rapat 2', groups: [] });
    await settle();
    assert.throws(() => ev.send(user, event.id), (e) => e.status === 400 && /minimal satu grup/.test(e.message));
    ev.update(user, event.id, { groups: [G1, G2] });
    ev.saveAgenda(event.id, 'Agenda final');

    const out = ev.send(user, event.id);
    await ev.tick();
    assert.deepStrictEqual(bridge.sent.map((m) => [m.path, m.chatId, m.message]), [['/send', G1, 'Agenda final'], ['/send', G2, 'Agenda final']]);
    assert.strictEqual(out.event.status, 'sent');
    assert.deepStrictEqual(audit, [['event_sent', 'irfan', `event ${event.id} → 2 grup`]]);
    const rem = () => ev.get(event.id).messages.filter((m) => m.kind === 'reminder');
    assert.deepStrictEqual(rem().map((m) => [m.chatId, m.reminder, m.dueAt, m.status]), [
      [G1, 'd1', at('2026-10-19T09:00:00'), 'pending'], [G2, 'd1', at('2026-10-19T09:00:00'), 'pending'],
      [G1, 'm60', at('2026-10-20T09:00:00'), 'pending'], [G2, 'm60', at('2026-10-20T09:00:00'), 'pending']
    ]);
    assert.ok(ev.get(event.id).messages.filter((m) => m.kind === 'agenda').every((m) => m.status === 'sent'));

    // Nothing is due yet.
    await ev.tick();
    assert.strictEqual(bridge.sent.length, 2);

    // H-1 09.00.
    clock.t = at('2026-10-19T09:00:30');
    await ev.tick();
    assert.strictEqual(bridge.sent.length, 4);
    assert.strictEqual(bridge.sent[2].message, '⏰ *Pengingat: Rapat mingguan*\nBesok — Selasa, 20 Oktober 2026 · 10.00–11.00 WIB\n📍 Ruang Rapat 2');

    // Moving the event reschedules what is still pending; what was sent stays.
    ev.update(user, event.id, { date: '2026-10-21', time: '14:00' });
    assert.deepStrictEqual(rem().map((m) => [m.reminder, m.dueAt, m.status]), [
      ['d1', at('2026-10-19T09:00:00'), 'sent'], ['d1', at('2026-10-19T09:00:00'), 'sent'],
      ['d1', at('2026-10-20T09:00:00'), 'pending'], ['d1', at('2026-10-20T09:00:00'), 'pending'],
      ['m60', at('2026-10-21T13:00:00'), 'pending'], ['m60', at('2026-10-21T13:00:00'), 'pending']
    ]);

    // Bot disconnected: retried with backoff, then delivered.
    bridge.state.mode = 'down';
    clock.t = at('2026-10-20T09:00:00');
    await ev.tick();
    let pending = rem().filter((m) => m.status === 'pending' && m.reminder === 'd1');
    assert.deepStrictEqual(pending.map((m) => [m.attempts, m.error, m.dueAt]), [
      [1, 'bot WhatsApp sedang tidak tersambung', at('2026-10-20T09:01:00')], [1, 'bot WhatsApp sedang tidak tersambung', at('2026-10-20T09:01:00')]
    ]);
    bridge.state.mode = 'ok';
    clock.t = at('2026-10-20T09:01:00');
    await ev.tick();
    assert.strictEqual(bridge.sent.length, 6);

    // A sent event cannot be deleted, only cancelled.
    assert.throws(() => ev.remove(event.id), (e) => e.status === 409);
    ev.cancel(user, event.id, { notify: true });
    await ev.tick();
    assert.deepStrictEqual(bridge.sent.slice(6).map((m) => [m.chatId, m.message.split('\n')[0]]),
      [[G1, '❌ *Acara dibatalkan: Rapat mingguan*'], [G2, '❌ *Acara dibatalkan: Rapat mingguan*']]);
    assert.ok(rem().filter((m) => m.reminder === 'm60').every((m) => m.status === 'skipped'), 'no reminders after cancelling');
    assert.strictEqual(ev.get(event.id).event.status, 'cancelled');
    assert.throws(() => ev.send(user, event.id), (e) => e.status === 409);
    assert.throws(() => ev.update(user, event.id, { title: 'x' }), (e) => e.status === 409);
    assert.deepStrictEqual(audit[1], ['event_cancelled', 'irfan', `event ${event.id} (grup dikabari)`]);
    clock.t = at('2026-10-21T13:00:00');
    await ev.tick();
    assert.strictEqual(bridge.sent.length, 8);
    ev.remove(event.id);
    assert.throws(() => ev.get(event.id), (e) => e.status === 404);
  } finally { bridge.close(); }
});

test('reminders never go out late, early or unapproved', async () => {
  const { ev, user, clock, bridge } = await setup();
  try {
    // Starts in 40 minutes: H-1, hari H 08.00 and 1 jam are already past.
    const { event } = ev.create(user, { title: 'Stand-up', date: '2026-10-19', time: '08:40', groups: [G1], reminders: ['d1', 'd0', 'm60', 'm30', 'm15'] });
    await settle();
    assert.deepStrictEqual(ev.get(event.id).messages, [], 'nothing before Kirim');
    clock.t = at('2026-10-19T08:30:00');
    await ev.tick();
    assert.strictEqual(bridge.sent.length, 0, 'unapproved event: no reminders');

    clock.t = at('2026-10-19T08:00:00');
    ev.send(user, event.id);
    await ev.tick();
    assert.deepStrictEqual(ev.get(event.id).messages.filter((m) => m.kind === 'reminder').map((m) => m.reminder), ['m30', 'm15']);

    // The server was down until after the start: the reminders are dropped.
    clock.t = at('2026-10-19T08:41:00');
    await ev.tick();
    assert.deepStrictEqual(ev.get(event.id).messages.filter((m) => m.kind === 'reminder').map((m) => [m.status, m.error]),
      [['skipped', 'acara sudah dimulai'], ['skipped', 'acara sudah dimulai']]);
    assert.strictEqual(bridge.sent.length, 1, 'only the agenda');
    clock.t = at('2026-10-19T09:41:00');
    assert.throws(() => ev.send(user, event.id), (e) => e.status === 409 && /sudah selesai/.test(e.message));
  } finally { bridge.close(); }
});

test('a failing bridge gives up after 5 attempts with the reason', async () => {
  const { ev, user, clock, bridge } = await setup();
  try {
    const { event } = ev.create(user, { title: 'Rapat', date: '2026-10-20', time: '10:00', groups: [G1], reminders: [] });
    await settle();
    bridge.state.mode = 'down';
    ev.send(user, event.id);
    for (let i = 0; i < 6; i++) { await ev.tick(); clock.t += 10 * 60000; }
    const [m] = ev.get(event.id).messages;
    assert.deepStrictEqual([m.kind, m.status, m.attempts, m.error], ['agenda', 'error', 5, 'bot WhatsApp sedang tidak tersambung']);
  } finally { bridge.close(); }
});

test('events API: login, create, list by month and upcoming, edit, delete', async () => {
  const gw = await startFakeGateway(() => ({ json: { choices: [{ message: { role: 'assistant', content: 'Agenda API' } }] } }));
  const srv = await startServer([{ username: 'cahyo', password: 'cahyo-password-1' }], { CHAT_HERMES_URL: gw.url });
  try {
    const db = openDb(srv.dbPath);
    db.prepare('INSERT INTO wa_groups (chat_id, name, participants, checked_at) VALUES (?, ?, 3, 0)').run(G1, 'HG Bot Testing');
    db.close();
    assert.strictEqual((await srv.request('/api/events?upcoming=1')).status, 401);
    const { cookie } = await srv.login('cahyo', 'cahyo-password-1');
    const opts = (await srv.json(cookie, 'GET', '/api/events/options')).body;
    assert.deepStrictEqual(opts.reminders.map((r) => r.key), ['d1', 'd0', 'm60', 'm30', 'm15']);

    const future = new Date(Date.now() + 3 * 86400000);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(future);
    const created = await srv.json(cookie, 'POST', '/api/events', { title: 'Review Q4', date, time: '13:30', location: 'Kantor', groups: [G1] });
    assert.strictEqual(created.status, 201);
    const id = created.body.event.id;
    assert.strictEqual(created.body.event.time, '13:30');
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/events', { title: '' })).status, 400);

    let got;
    for (let i = 0; i < 50; i++) {
      got = (await srv.json(cookie, 'GET', '/api/events/' + id)).body;
      if (got.event.agendaStatus !== 'running') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(got.event.agenda, 'Agenda API');
    assert.match(gw.calls[0].path, /^\/p\/aurix\//);

    const month = date.slice(0, 7);
    const [y, mo] = month.split('-').map(Number);
    const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
    const list = await srv.json(cookie, 'GET', `/api/events?from=${month}-01&to=${next}`);
    assert.deepStrictEqual(list.body.events.map((e) => e.title), ['Review Q4']);
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/events?from=2026-01-01&to=2026-12-31')).status, 400, 'range too long');
    assert.deepStrictEqual((await srv.json(cookie, 'GET', '/api/events?upcoming=1')).body.events.map((e) => e.id), [id]);

    const patched = await srv.json(cookie, 'PATCH', '/api/events/' + id, { time: '15:00', reminders: ['m30'] });
    assert.deepStrictEqual([patched.body.event.time, patched.body.event.reminders], ['15:00', ['m30']]);
    assert.strictEqual((await srv.json(cookie, 'PUT', `/api/events/${id}/agenda`, { agenda: 'Diedit' })).body.event.agenda, 'Diedit');
    assert.strictEqual((await srv.json(cookie, 'DELETE', '/api/events/' + id)).status, 200);
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/events/' + id)).status, 404);
  } finally {
    await srv.stop();
    await gw.close();
  }
});
