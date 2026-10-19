// EPIC-012 stage 3: WhatsApp number verification and notifications for
// unread mentions / DMs / agent answers. Fake clock, fake WhatsApp sender.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { createRooms } = require('../lib/rooms');
const { createNotifier, normalizeNumber, quietUntil } = require('../lib/notify');
const { startServer, tempDir } = require('./helpers');

const at = (s) => Date.parse(s + '+07:00');

function setup({ online = [], fail = false } = {}) {
  const db = openDb(path.join(tempDir(), 't.db'));
  const add = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, 'x', 'member', 0, 0)");
  add.run(1, 'ilham', 'Ilham'); add.run(2, 'irfan', 'Irfan'); add.run(3, 'cahyo', 'Cahyo');
  const clock = { t: at('2026-10-20T10:00:00') };
  const sent = [];
  const audit = [];
  const state = { online, fail };
  const notifier = createNotifier({
    db, now: () => clock.t, onEvent: (...a) => audit.push(a),
    hub: { online: () => state.online },
    send: async (number, text) => { if (state.fail) throw new Error('bot WhatsApp sedang tidak tersambung'); sent.push({ number, text }); }
  });
  const gateway = { ask: async () => 'jawaban agent' };
  const rooms = createRooms({ db, now: () => clock.t, notify: notifier.enqueue, gateway, agents: ['dave'] });
  const u = { ilham: { id: 1, username: 'ilham' }, irfan: { id: 2, username: 'irfan' }, cahyo: { id: 3, username: 'cahyo' } };
  return { db, clock, sent, audit, state, notifier, rooms, ...u };
}
async function verifyNumber(env, user, number) {
  await env.notifier.requestCode(user, number);
  const code = env.sent.at(-1).text.match(/\*(\d{6})\*/)[1];
  env.notifier.verify(user, code);
  env.sent.length = 0;
}

test('numbers are normalized to country code + digits', () => {
  for (const [raw, want] of [['0812-3456-7890', '6281234567890'], ['+62 812 3456 7890', '6281234567890'], ['81234567890', '6281234567890'],
    ['6281234567890', '6281234567890'], ['+1 415 555 0100', '14155550100'], ['12345', null], ['halo', null], ['', null]]) {
    assert.strictEqual(normalizeNumber(raw), want, raw);
  }
});

test('quiet hours hold notifications until the window ends (WIB)', () => {
  assert.strictEqual(quietUntil(at('2026-10-20T22:30:00'), '21:00', '07:00'), at('2026-10-21T07:00:00'));
  assert.strictEqual(quietUntil(at('2026-10-21T06:59:00'), '21:00', '07:00'), at('2026-10-21T07:00:00'));
  assert.strictEqual(quietUntil(at('2026-10-20T07:00:00'), '21:00', '07:00'), null);
  assert.strictEqual(quietUntil(at('2026-10-20T12:30:00'), '12:00', '13:00'), at('2026-10-20T13:00:00'));
  assert.strictEqual(quietUntil(at('2026-10-20T12:30:00'), '00:00', '00:00'), null, 'same start and end = no quiet hours');
});

test('a number is only used after its code is confirmed', async () => {
  const env = setup();
  const { notifier, irfan, sent, clock, audit } = env;
  await assert.rejects(notifier.requestCode(irfan, '123'), /tidak valid/);
  let p = await notifier.requestCode(irfan, '0812 3456 7890');
  assert.strictEqual(sent[0].number, '6281234567890');
  assert.match(sent[0].text, /Kode verifikasi HG Chat: \*\d{6}\*/);
  assert.deepStrictEqual([p.wa, p.pending.number], [null, '+62 812••••890']);
  assert.throws(() => notifier.verify(irfan, '000000'), /kode salah/);
  const code = sent[0].text.match(/\*(\d{6})\*/)[1];
  p = notifier.verify(irfan, code);
  assert.deepStrictEqual([p.wa.number, p.pending], ['+62 812••••890', null]);
  assert.deepStrictEqual(audit, [['profile_wa_verified', 'irfan', '+62 812••••890']]);

  await notifier.requestCode(irfan, '0812 0000 0001');
  await notifier.requestCode(irfan, '0812 0000 0001');
  await assert.rejects(notifier.requestCode(irfan, '0812 0000 0001'), (e) => e.status === 429, 'three codes an hour');
  clock.t += 11 * 60000;
  assert.throws(() => notifier.verify(irfan, '123456'), /kedaluwarsa/);
  assert.strictEqual(notifier.profile(irfan).wa.number, '+62 812••••890', 'the verified number stays');
  notifier.removeNumber(irfan);
  assert.strictEqual(notifier.profile(irfan).wa, null);
  assert.deepStrictEqual(audit.at(-1), ['profile_wa_removed', 'irfan', null]);
});

test('settings are validated', () => {
  const { notifier, irfan } = setup();
  assert.deepStrictEqual((({ notifyWa, delayMin, quietStart, quietEnd }) => [notifyWa, delayMin, quietStart, quietEnd])(notifier.profile(irfan)), [true, 5, '21:00', '07:00']);
  assert.throws(() => notifier.updateSettings(irfan, { delayMin: 7 }), /jeda/);
  assert.throws(() => notifier.updateSettings(irfan, { quietStart: '25:00' }), /HH:MM/);
  const p = notifier.updateSettings(irfan, { notifyWa: false, delayMin: 15, quietStart: '22:00', quietEnd: '06:30' });
  assert.deepStrictEqual([p.notifyWa, p.delayMin, p.quietStart, p.quietEnd], [false, 15, '22:00', '06:30']);
});

test('unread mentions and DMs go out once, batched, after the delay', async () => {
  const env = setup();
  const { rooms, notifier, ilham, irfan, cahyo, sent, clock, db } = env;
  await verifyNumber(env, irfan, '081234567890');
  const umum = rooms.list(ilham)[0].id;
  rooms.post(ilham, umum, { body: 'Halo @irfan, cek angka Surabaya ya' });
  rooms.post(cahyo, umum, { body: 'tanpa sebutan' });
  const dm = rooms.openDm(cahyo, 'irfan');
  rooms.post(cahyo, dm.id, { body: 'Bisa call sore ini?' });
  rooms.post(ilham, umum, { body: '@cahyo juga (Cahyo belum punya nomor)' });
  assert.deepStrictEqual(db.prepare('SELECT user_id, kind FROM notify_queue ORDER BY id').all().map((r) => [r.user_id, r.kind]), [[2, 'mention'], [2, 'dm']]);

  await notifier.tick();
  assert.strictEqual(sent.length, 0, 'not before the delay');
  clock.t += 5 * 60000;
  await notifier.tick();
  assert.strictEqual(sent.length, 1, 'one message for both');
  assert.strictEqual(sent[0].number, '6281234567890');
  assert.match(sent[0].text, /^🔔 \*HG Chat\* — 2 pesan untuk Anda\n• \*Ilham\* menyebut Anda di #umum: "Halo @irfan, cek angka Surabaya ya"\n• Pesan langsung dari \*Cahyo\*: "Bisa call sore ini\?"\n\nBuka: https:\/\/agents\.herrygunawan\.com\/#discuss$/);
  clock.t += 60000;
  await notifier.tick();
  assert.strictEqual(sent.length, 1, 'never twice');
});

test('read, deleted, online, quiet hours and failures', async () => {
  const env = setup();
  const { rooms, notifier, ilham, irfan, sent, clock, state, db } = env;
  await verifyNumber(env, irfan, '081234567890');
  const umum = rooms.list(ilham)[0].id;
  const status = () => db.prepare('SELECT status FROM notify_queue ORDER BY id').all().map((r) => r.status);

  rooms.post(ilham, umum, { body: '@irfan satu' });
  rooms.markRead(irfan, umum);
  const del = rooms.post(ilham, umum, { body: '@irfan dua' });
  rooms.remove(ilham, del.id);
  clock.t += 5 * 60000;
  await notifier.tick();
  assert.deepStrictEqual(status(), ['read', 'skipped']);

  // Chat Center open in a browser: wait until 30 minutes after the message.
  state.online = ['irfan'];
  const t0 = clock.t;
  rooms.post(ilham, umum, { body: '@irfan tiga' });
  clock.t += 5 * 60000; await notifier.tick();
  assert.strictEqual(sent.length, 0);
  clock.t = t0 + 30 * 60000; await notifier.tick();
  assert.strictEqual(sent.length, 1, 'still unread after 30 minutes: sent anyway');

  // Quiet hours: held until 07.00.
  state.online = [];
  clock.t = at('2026-10-20T22:00:00');
  rooms.post(ilham, umum, { body: '@irfan malam' });
  clock.t += 5 * 60000; await notifier.tick();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(db.prepare('SELECT due_at FROM notify_queue ORDER BY id DESC').get().due_at, at('2026-10-21T07:00:00'));
  clock.t = at('2026-10-21T07:00:00'); await notifier.tick();
  assert.strictEqual(sent.length, 2);

  // The bot is down: retried, then given up with the reason.
  state.fail = true;
  rooms.post(ilham, umum, { body: '@irfan gagal' });
  for (let i = 0; i < 4; i++) { clock.t += 10 * 60000; await notifier.tick(); }
  const last = db.prepare('SELECT status, attempts, error FROM notify_queue ORDER BY id DESC').get();
  assert.deepStrictEqual([last.status, last.attempts, last.error], ['error', 3, 'bot WhatsApp sedang tidak tersambung']);
});

test('an agent answer notifies the asker; switched off means nothing is queued', async () => {
  const env = setup();
  const { rooms, notifier, irfan, sent, clock, db } = env;
  await verifyNumber(env, irfan, '081234567890');
  const umum = rooms.list(irfan)[0].id;
  rooms.post(irfan, umum, { body: '@dave tolong ringkas' });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(db.prepare('SELECT kind FROM notify_queue').all().map((r) => r.kind), ['agent']);
  clock.t += 5 * 60000; await notifier.tick();
  assert.match(sent[0].text, /• \*Dave\* menjawab Anda di #umum: "jawaban agent"/);

  notifier.updateSettings(irfan, { notifyWa: false });
  rooms.post({ id: 1, username: 'ilham' }, umum, { body: '@irfan lagi' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM notify_queue').get().n, 1);
});

test('profile API is the logged-in user\'s own', async () => {
  const srv = await startServer([{ username: 'irfan', password: 'irfan-password-1' }]);
  try {
    assert.strictEqual((await srv.request('/api/profile')).status, 401);
    const { cookie } = await srv.login('irfan', 'irfan-password-1');
    const p = (await srv.json(cookie, 'GET', '/api/profile')).body.profile;
    assert.deepStrictEqual([p.wa, p.notifyWa, p.delayMin], [null, true, 5]);
    assert.strictEqual((await srv.json(cookie, 'PATCH', '/api/profile', { delayMin: 9 })).status, 400);
    assert.strictEqual((await srv.json(cookie, 'PATCH', '/api/profile', { delayMin: 15 })).body.profile.delayMin, 15);
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/profile/wa', { number: 'x' })).status, 400);
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/profile/wa/verify', { code: '1' })).status, 400);
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/profile/wa/test')).status, 400, 'no number yet');
  } finally {
    await srv.stop();
  }
});
