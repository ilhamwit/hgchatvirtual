// EPIC-013: API keys and the v1 API the WhatsApp agent uses to create
// events — the requester is a verified team member who just wrote in the group.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createEvents } = require('../lib/events');
const { createIntegrations } = require('../lib/integrations');
const { startServer, tempDir } = require('./helpers');

const G = '120363000000000077@g.us';
const PHONE = '6281234567890';
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const wibDate = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(Date.now() + offsetDays * 86400000);

function fakeBridge() {
  const sent = [];
  const srv = http.createServer((req, res) => { let raw = ''; req.on('data', (d) => { raw += d; }); req.on('end', () => {
    sent.push(JSON.parse(raw || '{}')); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"success":true}'); }); });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, sent, close: () => srv.close() })));
}

async function setup({ agenda = async () => '*Agenda dari Aurix*' } = {}) {
  const db = openDb(path.join(tempDir(), 't.db'));
  const add = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, 'x', ?, 0, 0)");
  add.run(1, 'ilham', 'Ilham', 'admin'); add.run(2, 'irfan', 'Irfan', 'member');
  db.prepare('INSERT INTO user_profiles (user_id, wa_number, wa_verified_at) VALUES (2, ?, 1)').run(PHONE);
  db.prepare('INSERT INTO wa_groups (chat_id, name, participants, checked_at) VALUES (?, ?, 5, 0)').run(G, 'Tim Inti');
  const sessionDir = tempDir();
  fs.writeFileSync(path.join(sessionDir, 'lid-mapping-99887766554433_reverse.json'), JSON.stringify(PHONE + '@s.whatsapp.net'));
  const bridge = await fakeBridge();
  const audit = [];
  const events = createEvents({ db, gateway: { ask: ({ text }) => agenda(text) }, bridgeUrl: bridge.url });
  const integ = createIntegrations({ db, events, sessionDir, onEvent: (...a) => audit.push(a) });
  const wrote = (who = PHONE, ago = 60000) => db.prepare('INSERT INTO wa_messages (chat_id, ts, sender_id, sender_number, sender_name, body) VALUES (?, ?, ?, ?, ?, ?)')
    .run(G, Date.now() - ago, '99887766554433@lid', who, 'Irfan', '@Aurix jadwalkan rapat');
  const { key } = integ.createKey({ id: 1, username: 'ilham' }, { name: 'Aurix (WhatsApp)', scopes: ['events:write', 'events:read'] });
  const req = (k = key) => ({ headers: { authorization: 'Bearer ' + k } });
  return { db, events, integ, bridge, audit, wrote, key, req };
}
const body = (extra = {}) => ({ title: 'Rapat evaluasi Q4', date: wibDate(3), time: '10:00', location: 'Ruang rapat lt.3', chatId: G,
  requester: { waId: PHONE + '@s.whatsapp.net' }, ...extra });

test('keys: shown once, stored hashed, scoped, revocable, rate limited', async () => {
  const { db, integ, key, req, audit, bridge } = await setup();
  try {
    assert.match(key, /^cc_[A-Za-z0-9_-]{32}$/);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM api_keys').all()).includes(key), 'never stored in clear');
    assert.deepStrictEqual(integ.listKeys().map((k) => [k.name, k.prefix, k.scopes]), [['Aurix (WhatsApp)', key.slice(0, 10), ['events:write', 'events:read']]]);
    assert.deepStrictEqual(audit[0], ['api_key_created', 'ilham', 'Aurix (WhatsApp) [events:write,events:read]']);
    assert.throws(() => integ.createKey({ id: 1 }, { name: '', scopes: ['events:read'] }), /nama/);
    assert.throws(() => integ.createKey({ id: 1 }, { name: 'x', scopes: ['admin'] }), /izin/);
    const { key: ro } = integ.createKey({ id: 1, username: 'ilham' }, { name: 'baca saja', scopes: ['events:read'] });

    const url = new URL('http://x/api/v1/events?days=7');
    assert.throws(() => integ.listEvents({ headers: {} }, url), (e) => e.status === 401 && e.code === 'invalid_key');
    assert.throws(() => integ.listEvents(req('cc_' + 'x'.repeat(30)), url), (e) => e.status === 401);
    assert.throws(() => integ.createEvent(req(ro), body({ mode: 'draft' })), (e) => e.status === 403 && e.code === 'missing_scope');
    assert.deepStrictEqual(integ.listEvents(req(ro), url).events, []);
    integ.revokeKey({ id: 1, username: 'ilham' }, integ.listKeys().find((k) => k.name === 'baca saja').id);
    assert.throws(() => integ.listEvents(req(ro), url), (e) => e.status === 401, 'revoked at once');
    for (let i = 0; i < 60; i++) integ.listEvents(req(), url);
    assert.throws(() => integ.listEvents(req(), url), (e) => e.status === 429);
  } finally { bridge.close(); }
});

test('WhatsApp ids map to phones, LIDs through the bridge mapping', async () => {
  const { integ, bridge } = await setup();
  bridge.close();
  assert.strictEqual(integ.phoneOf(PHONE + '@s.whatsapp.net'), PHONE);
  assert.strictEqual(integ.phoneOf(PHONE + ':12@s.whatsapp.net'), PHONE);
  assert.strictEqual(integ.phoneOf('99887766554433@lid'), PHONE);
  assert.strictEqual(integ.phoneOf('11112222333344@lid'), null, 'unknown LID');
  assert.strictEqual(integ.phoneOf('halo'), null);
});

test('only a verified member who just wrote in the group can create; draft stays a draft', async () => {
  const { db, integ, bridge, audit, wrote, req, events } = await setup();
  try {
    assert.throws(() => integ.createEvent(req(), body()), (e) => e.status === 400 && e.code === 'mode_required', 'the agent must ask first');
    assert.throws(() => integ.createEvent(req(), body({ mode: 'draft', requester: { waId: '6289999999999@s.whatsapp.net' } })),
      (e) => e.status === 403 && e.code === 'requester_not_verified' && /Profil & notifikasi/.test(e.message));
    assert.throws(() => integ.createEvent(req(), body({ mode: 'draft' })), (e) => e.code === 'requester_not_in_chat', 'not written in the group yet');
    wrote(PHONE, 20 * 60000);
    assert.throws(() => integ.createEvent(req(), body({ mode: 'draft' })), (e) => e.code === 'requester_not_in_chat', '20 minutes is too old');
    assert.deepStrictEqual(audit.filter((a) => a[0] === 'api_denied').length, 3);
    wrote();
    // The gateway may give a LID instead of the phone: still the same person.
    const out = integ.createEvent(req(), body({ mode: 'draft', requester: { waId: '99887766554433@lid' } }));
    assert.deepStrictEqual([out.ok, out.mode, out.requester, out.event.groups], [true, 'draft', 'Irfan', ['Tim Inti']]);
    assert.match(out.reply, /^✅ Draf acara dibuat: \*Rapat evaluasi Q4\* — .+ di Ruang rapat lt\.3\. Agenda sedang disusun; cek & kirim di https:\/\/agents\.herrygunawan\.com\/#schedule$/);
    const row = db.prepare('SELECT source, created_by, auto_send_by FROM events WHERE id = ?').get(out.event.id);
    assert.deepStrictEqual([row.source, row.created_by, row.auto_send_by], ['whatsapp', 2, null]);
    assert.deepStrictEqual(audit.at(-1), ['api_event_created', 'irfan', `Aurix (WhatsApp): event ${out.event.id} (draft)`]);
    await settle(); await events.tick();
    assert.strictEqual(bridge.sent.length, 0, 'a draft sends nothing');
    assert.strictEqual(events.get(out.event.id).event.status, 'draft');
    assert.throws(() => integ.createEvent(req(), body({ mode: 'draft', date: '2020-01-01' })), (e) => e.status === 400 && /sudah lewat/.test(e.message));
    assert.throws(() => integ.createEvent(req(), body({ mode: 'draft', groups: ['120363999@g.us'] })), (e) => e.status === 400 && /grup tidak dikenal/.test(e.message));
  } finally { bridge.close(); }
});

test('"langsung dibuatkan" sends the agenda to the group once Aurix is done', async () => {
  const { integ, bridge, wrote, req, events } = await setup();
  try {
    wrote();
    const out = integ.createEvent(req(), body({ mode: 'send' }));
    assert.match(out.reply, /akan dikirim otomatis ke grup/);
    await settle(); await events.tick();
    assert.deepStrictEqual(bridge.sent.map((m) => [m.chatId, m.message]), [[G, '*Agenda dari Aurix*']]);
    const ev = events.get(out.event.id);
    assert.deepStrictEqual([ev.event.status, ev.event.sentBy, ev.event.source], ['sent', 'Irfan', 'whatsapp']);
    assert.ok(ev.messages.some((m) => m.kind === 'reminder'), 'reminders scheduled');
  } finally { bridge.close(); }
});

test('if Aurix fails, "langsung" still goes out with a plain agenda', async () => {
  const { integ, bridge, wrote, req, events } = await setup({ agenda: async () => { throw new Error('Hermes error 500'); } });
  try {
    wrote();
    integ.createEvent(req(), body({ mode: 'send', notes: 'Bawa laporan' }));
    await settle(); await events.tick();
    assert.strictEqual(bridge.sent.length, 1);
    assert.match(bridge.sent[0].message, /^\*Rapat evaluasi Q4\*\n🗓 .+ WIB\n📍 Ruang rapat lt\.3\n\nBawa laporan$/);
  } finally { bridge.close(); }
});

test('HTTP: /api/v1 uses API keys, key management is admin-only', async () => {
  const srv = await startServer([{ username: 'ilham', password: 'ilham-password-1', role: 'admin' }, { username: 'irfan', password: 'irfan-password-1' }]);
  try {
    let r = await srv.request('/api/v1/events');
    assert.strictEqual(r.status, 401);
    assert.deepStrictEqual(await r.json(), { error: 'invalid_key', message: 'API key tidak valid atau sudah dicabut' });
    assert.strictEqual((await srv.request('/api/v1/nope')).status, 404);
    const admin = (await srv.login('ilham', 'ilham-password-1')).cookie;
    const member = (await srv.login('irfan', 'irfan-password-1')).cookie;
    assert.strictEqual((await srv.json(member, 'GET', '/api/integrations/keys')).status, 403);
    assert.strictEqual((await srv.json(member, 'POST', '/api/integrations/keys', { name: 'x', scopes: ['events:read'] })).status, 403);
    const made = await srv.json(admin, 'POST', '/api/integrations/keys', { name: 'Aurix', scopes: ['events:write', 'events:read'] });
    assert.strictEqual(made.status, 201);
    const auth = { authorization: 'Bearer ' + made.body.key, 'content-type': 'application/json' };
    r = await srv.request('/api/v1/events?days=14', { headers: auth });
    assert.deepStrictEqual([r.status, (await r.json()).days], [200, 14]);
    r = await srv.request('/api/v1/events', { method: 'POST', headers: auth, body: JSON.stringify({ ...body({ mode: 'draft' }), requester: { waId: '6280000000000@s.whatsapp.net' } }) });
    assert.deepStrictEqual([r.status, (await r.json()).error], [403, 'requester_not_verified']);
    const keys = (await srv.json(admin, 'GET', '/api/integrations/keys')).body.keys;
    assert.ok(keys[0].lastUsedAt, 'last use is shown');
    assert.ok(!JSON.stringify(keys).includes(made.body.key));
    await srv.json(admin, 'DELETE', `/api/integrations/keys/${keys[0].id}`);
    assert.strictEqual((await srv.request('/api/v1/events', { headers: auth })).status, 401);
  } finally {
    await srv.stop();
  }
});

// The skill's script, run the way the WhatsApp agent runs it: identity from
// the HERMES_SESSION_* variables, key from a file.
test('skill script: creates from a WhatsApp session, refuses outside WhatsApp', async () => {
  const { execFile } = require('node:child_process');
  const srv = await startServer([{ username: 'ilham', password: 'ilham-password-1', role: 'admin' }, { username: 'irfan', password: 'irfan-password-1' }]);
  try {
    const admin = (await srv.login('ilham', 'ilham-password-1')).cookie;
    const key = (await srv.json(admin, 'POST', '/api/integrations/keys', { name: 'Aurix', scopes: ['events:write', 'events:read'] })).body.key;
    const db = openDb(srv.dbPath);
    const irfan = db.prepare("SELECT id FROM users WHERE username = 'irfan'").get().id;
    db.prepare('INSERT INTO user_profiles (user_id, wa_number, wa_verified_at) VALUES (?, ?, 1)').run(irfan, PHONE);
    db.prepare('INSERT INTO wa_groups (chat_id, name, participants, checked_at) VALUES (?, ?, 5, 0)').run(G, 'Tim Inti');
    db.prepare('INSERT INTO wa_messages (chat_id, ts, sender_id, sender_number, sender_name, body) VALUES (?, ?, ?, ?, ?, ?)')
      .run(G, Date.now() - 30000, PHONE + '@s.whatsapp.net', PHONE, 'Irfan', '@Aurix jadwalkan rapat');
    db.close();
    const keyFile = path.join(tempDir(), 'k'); fs.writeFileSync(keyFile, key + '\n');
    const script = path.join(__dirname, '..', 'deploy', 'hermes', 'skills', 'chat-center', 'scripts', 'chat_center.py');
    const run = (args, env) => new Promise((resolve) => execFile('python3', [script, ...args], {
      env: { PATH: process.env.PATH, CHAT_CENTER_URL: srv.base, CHAT_CENTER_KEY_FILE: keyFile, ...env }
    }, (err, stdout) => resolve({ code: err ? err.code : 0, out: JSON.parse(stdout) })));
    const wa = { HERMES_SESSION_PLATFORM: 'whatsapp', HERMES_SESSION_CHAT_ID: G, HERMES_SESSION_USER_ID: PHONE + '@s.whatsapp.net', HERMES_SESSION_USER_NAME: 'Irfan' };
    const args = ['create', '--title', 'Rapat evaluasi Q4', '--date', wibDate(2), '--time', '14:00', '--location', 'Zoom', '--mode', 'draft'];

    let r = await run(args, { ...wa, HERMES_SESSION_PLATFORM: 'api_server' });
    assert.deepStrictEqual([r.code, r.out.error], [1, 'not_whatsapp']);
    r = await run(args, { ...wa, HERMES_SESSION_USER_ID: '6280000000000@s.whatsapp.net' });
    assert.deepStrictEqual([r.code, r.out.ok, r.out.error], [1, false, 'requester_not_verified']);
    r = await run(args, wa);
    assert.deepStrictEqual([r.code, r.out.ok, r.out.mode, r.out.requester], [0, true, 'draft', 'irfan']);
    assert.match(r.out.reply, /^✅ Draf acara dibuat: \*Rapat evaluasi Q4\*/);
    r = await run(['list', '--days', '7'], {});
    assert.deepStrictEqual(r.out.events.map((e) => [e.title, e.status]), [['Rapat evaluasi Q4', 'draft']]);
    r = await run(['list'], { CHAT_CENTER_KEY_FILE: '/nonexistent' });
    assert.deepStrictEqual([r.code, r.out.error], [1, 'no_key']);
  } finally {
    await srv.stop();
  }
});
