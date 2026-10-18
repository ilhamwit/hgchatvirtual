// EPIC-012 Chat & Discussion: channels, DMs, threads, mentions, unread, and
// the live stream (SSE) — DMs never reach anyone but their two members.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { createRooms, slug } = require('../lib/rooms');
const { startServer, tempDir } = require('./helpers');

function setup() {
  const db = openDb(path.join(tempDir(), 't.db'));
  const add = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, 'x', 'member', ?, 0)");
  add.run(1, 'ilham', 'Ilham', 0); add.run(2, 'irfan', 'Irfan', 0); add.run(3, 'cahyo', 'Cahyo', 0); add.run(4, 'lama', 'Lama', 1);
  const published = [];
  const clock = { t: 1000 };
  const rooms = createRooms({ db, now: () => ++clock.t, publish: (e, ids) => published.push([e.type, e.roomId, ids]) });
  return { db, rooms, published, ilham: { id: 1, username: 'ilham' }, irfan: { id: 2, username: 'irfan' }, cahyo: { id: 3, username: 'cahyo' } };
}

test('channel names become slugs, unique; #umum exists', () => {
  const { rooms, ilham, published } = setup();
  assert.strictEqual(slug('Rapat Tim  Sales!'), 'rapat-tim-sales');
  assert.deepStrictEqual(rooms.list(ilham).map((r) => r.name), ['umum']);
  const r = rooms.createChannel(ilham, { name: 'Proyek Website', topic: 'Redesign 2026' });
  assert.deepStrictEqual([r.kind, r.name, r.topic], ['channel', 'proyek-website', 'Redesign 2026']);
  assert.throws(() => rooms.createChannel(ilham, { name: 'proyek website' }), (e) => e.status === 409);
  assert.throws(() => rooms.createChannel(ilham, { name: '!' }), (e) => e.status === 400);
  assert.deepStrictEqual(published.at(-1), ['room', r.id, null], 'a new channel is announced to everyone');
});

test('a DM exists only for its two members', () => {
  const { rooms, ilham, irfan, cahyo, published } = setup();
  const dm = rooms.openDm(ilham, 'irfan');
  assert.strictEqual(rooms.openDm(irfan, 'ilham').id, dm.id, 'same room both ways');
  assert.deepStrictEqual([dm.kind, dm.with.username], ['dm', 'irfan']);
  assert.throws(() => rooms.openDm(ilham, 'ilham'), (e) => e.status === 400);
  assert.throws(() => rooms.openDm(ilham, 'lama'), (e) => e.status === 400, 'disabled account');
  rooms.post(ilham, dm.id, { body: 'rahasia' });
  assert.deepStrictEqual(published.filter((p) => p[0] === 'message').at(-1), ['message', dm.id, [1, 2]], 'only the members get it');
  for (const fn of [() => rooms.messages(cahyo, dm.id), () => rooms.post(cahyo, dm.id, { body: 'x' }), () => rooms.markRead(cahyo, dm.id)]) {
    assert.throws(fn, (e) => e.status === 404);
  }
  assert.ok(!rooms.list(cahyo).some((r) => r.id === dm.id));
  assert.strictEqual(rooms.list(irfan).find((r) => r.id === dm.id).with.username, 'ilham');
});

test('threads, mentions, unread and read positions', () => {
  const { rooms, ilham, irfan, cahyo } = setup();
  const umum = rooms.list(ilham)[0].id;
  assert.throws(() => rooms.post(ilham, umum, { body: '   ' }), /pesan kosong/);
  const m1 = rooms.post(ilham, umum, { body: 'Halo @irfan dan @Cahyo, juga @ilham dan @lama' });
  assert.deepStrictEqual(m1.mentions.sort(), ['cahyo', 'irfan'], 'not oneself, not disabled');
  const r1 = rooms.post(irfan, umum, { body: 'siap', parentId: m1.id });
  assert.throws(() => rooms.post(cahyo, umum, { body: 'x', parentId: r1.id }), /dibalas/, 'no replies to replies');
  rooms.post(cahyo, umum, { body: 'oke juga', parentId: m1.id });

  const top = rooms.messages(ilham, umum);
  assert.deepStrictEqual(top.messages.map((m) => [m.body.slice(0, 4), m.replies]), [['Halo', 2]], 'replies stay in the thread');
  const thread = rooms.messages(ilham, umum, { parentId: m1.id });
  assert.deepStrictEqual(thread.messages.map((m) => m.author.username), ['irfan', 'cahyo']);

  const count = (u) => { const r = rooms.list(u).find((x) => x.id === umum); return [r.unread, r.mentions]; };
  assert.deepStrictEqual(count(ilham), [2, 0], 'own messages never count');
  assert.deepStrictEqual(count(irfan), [1, 0], 'replying marks the room read up to the reply: only Cahyo\'s later reply is new');
  rooms.markRead(cahyo, umum);
  assert.deepStrictEqual(count(cahyo), [0, 0]);
  assert.deepStrictEqual(rooms.totals(ilham), { unread: 2, mentions: 0 });
});

test('only own messages are edited or deleted; deleted ones keep their place', () => {
  const { rooms, ilham, irfan, published } = setup();
  const umum = rooms.list(ilham)[0].id;
  const m = rooms.post(ilham, umum, { body: 'jadwal jam 3' });
  assert.throws(() => rooms.edit(irfan, m.id, 'hack'), (e) => e.status === 403);
  const e = rooms.edit(ilham, m.id, 'jadwal jam 4 @irfan');
  assert.deepStrictEqual([e.body, !!e.editedAt, e.mentions], ['jadwal jam 4 @irfan', true, ['irfan']]);
  assert.throws(() => rooms.remove(irfan, m.id), (x) => x.status === 403);
  const d = rooms.remove(ilham, m.id);
  assert.deepStrictEqual([d.deleted, d.body, d.attachments, d.mentions], [true, '', [], []]);
  assert.throws(() => rooms.edit(ilham, m.id, 'lagi'), (x) => x.status === 409);
  assert.deepStrictEqual(published.slice(-2).map((p) => p[0]), ['edit', 'delete']);
  assert.deepStrictEqual(rooms.list(irfan)[0].unread, 0, 'a deleted message is not unread');
});

// Reads an SSE stream into a list of events.
async function stream(srv, cookie) {
  const ac = new AbortController();
  const res = await fetch(srv.base + '/api/stream', { headers: { cookie }, signal: ac.signal });
  const events = [];
  const reader = res.body.getReader();
  let buf = '';
  let ended = false;
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += Buffer.from(value).toString();
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
          if (data) events.push(JSON.parse(data));
        }
      }
    } catch (e) { /* aborted */ }
    ended = true;
  })();
  return { res, events, close: () => ac.abort(), get ended() { return ended; } };
}
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

test('live stream: channel to all, DM to its members only, presence, ends at logout', async () => {
  const srv = await startServer([
    { username: 'ilham', password: 'ilham-password-1' }, { username: 'irfan', password: 'irfan-password-1' }, { username: 'cahyo', password: 'cahyo-password-1' }
  ]);
  const streams = [];
  try {
    assert.strictEqual((await srv.request('/api/stream')).status, 401);
    const a = (await srv.login('ilham', 'ilham-password-1')).cookie;
    const b = (await srv.login('irfan', 'irfan-password-1')).cookie;
    const c = (await srv.login('cahyo', 'cahyo-password-1')).cookie;
    const sa = await stream(srv, a); const sb = await stream(srv, b); const sc = await stream(srv, c);
    streams.push(sa, sb, sc);
    assert.strictEqual(sa.res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.ok(await until(() => sc.events.some((e) => e.type === 'presence' && e.online.length === 3)), 'everyone online');

    const list = (await srv.json(a, 'GET', '/api/rooms')).body;
    assert.deepStrictEqual(list.online, ['cahyo', 'ilham', 'irfan']);
    const umum = list.rooms.find((r) => r.name === 'umum').id;
    await srv.json(a, 'POST', `/api/rooms/${umum}/messages`, { body: 'halo semua' });
    assert.ok(await until(() => [sb, sc].every((s) => s.events.some((e) => e.type === 'message' && e.message.body === 'halo semua'))));

    const dm = (await srv.json(a, 'POST', '/api/rooms/dm', { username: 'irfan' })).body.room;
    const sent = await srv.json(a, 'POST', `/api/rooms/${dm.id}/messages`, { body: 'empat mata' });
    assert.strictEqual(sent.status, 201);
    assert.ok(await until(() => sb.events.some((e) => e.message && e.message.body === 'empat mata')));
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!sc.events.some((e) => e.roomId === dm.id), 'Cahyo never sees the DM');
    assert.strictEqual((await srv.json(c, 'GET', `/api/rooms/${dm.id}/messages`)).status, 404);

    assert.deepStrictEqual((await srv.json(b, 'GET', '/api/rooms/unread')).body, { unread: 2, mentions: 0 });
    await srv.json(b, 'POST', `/api/rooms/${dm.id}/read`, {});
    assert.deepStrictEqual((await srv.json(b, 'GET', '/api/rooms/unread')).body, { unread: 1, mentions: 0 });

    await srv.request('/logout', { method: 'POST', headers: { cookie: c } });
    sc.close();
    assert.ok(await until(() => sa.events.some((e) => e.type === 'presence' && e.online.join() === 'ilham,irfan')), 'Cahyo went offline');
  } finally {
    for (const s of streams) s.close();
    await srv.stop();
  }
});

// ── Stage 2: agents in the discussion, summaries ──
function setupAgents(reply = () => 'Jawaban agent') {
  const base = setup();
  const prompts = [];
  const gateway = { ask: async (o) => { prompts.push(o); return reply(o); } };
  const events = [];
  const rooms = createRooms({ db: base.db, gateway, agents: ['dave', 'nana'], now: () => Date.now(), publish: (e, ids) => events.push([e, ids]) });
  return { ...base, rooms, prompts, events };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('@agent answers in the thread with the conversation as context', async () => {
  const { rooms, ilham, irfan, prompts, events } = setupAgents();
  const umum = rooms.list(ilham)[0].id;
  rooms.post(irfan, umum, { body: 'Penjualan Surabaya naik 12%' });
  const q = rooms.post(ilham, umum, { body: '@dave @nana @siapa tolong rangkum angka di atas' });
  await settle();
  assert.deepStrictEqual(prompts.map((p) => p.agentId).sort(), ['dave', 'nana'], 'only real agents, each once');
  const p = prompts.find((x) => x.agentId === 'dave');
  assert.strictEqual(p.conversationId, `room-${umum}-${q.id}-dave`);
  assert.match(p.text, /channel #umum\] Ilham \(@ilham\) memanggil kamu \(@dave\)/);
  assert.match(p.text, /Irfan: Penjualan Surabaya naik 12%[\s\S]*Ilham: @dave @nana/, 'earlier messages are context');
  const thread = rooms.messages(ilham, umum, { parentId: q.id });
  assert.deepStrictEqual(thread.messages.map((m) => [m.agent, m.author, m.body, m.mentions]).sort(),
    [['dave', null, 'Jawaban agent', ['ilham']], ['nana', null, 'Jawaban agent', ['ilham']]], 'answers in the thread, telling the asker');
  const typing = events.filter(([e]) => e.type === 'typing' && e.agentId === 'dave').map(([e]) => [e.parentId, e.on]);
  assert.deepStrictEqual(typing, [[q.id, true], [q.id, false]]);
  assert.strictEqual(rooms.list(ilham)[0].mentions, 2, 'the asker gets an @ for each answer');
});

test('in a thread the agent reads the thread; a failing agent says so', async () => {
  const { rooms, ilham, irfan, prompts } = setupAgents((o) => { if (o.agentId === 'nana') throw new Error('Hermes error 500'); return 'ok'; });
  const umum = rooms.list(ilham)[0].id;
  const root = rooms.post(irfan, umum, { body: 'Budget event Desember?' });
  rooms.post(irfan, umum, { body: 'di luar utas' });
  rooms.post(ilham, umum, { body: 'Kira-kira 50 juta', parentId: root.id });
  const q = rooms.post(ilham, umum, { body: '@nana cukup tidak?', parentId: root.id });
  await settle();
  assert.match(prompts[0].text, /Budget event Desember\?[\s\S]*Kira-kira 50 juta[\s\S]*@nana cukup tidak\?/);
  assert.doesNotMatch(prompts[0].text, /di luar utas/);
  const last = rooms.messages(ilham, umum, { parentId: root.id }).messages.at(-1);
  assert.deepStrictEqual([last.agent, last.parentId, last.body], ['nana', root.id, '⚠️ Maaf, saya tidak bisa menjawab sekarang (Hermes error 500)']);
  assert.ok(q.id < last.id);
});

test('an agent in a DM only reaches its two members', async () => {
  const { rooms, ilham, cahyo, events } = setupAgents();
  const dm = rooms.openDm(ilham, 'cahyo');
  rooms.post(ilham, dm.id, { body: '@dave bantu jawab' });
  await settle();
  const sent = events.filter(([e]) => e.type === 'message' && e.message.agent === 'dave');
  assert.deepStrictEqual(sent.map(([, ids]) => ids), [[1, 3]]);
  assert.strictEqual(rooms.messages(cahyo, dm.id).messages[0].replies, 1);
});

test('Ringkas diskusi: Aurix summarizes a range; only the asker sees and shares it', async () => {
  const { rooms, ilham, irfan, prompts } = setupAgents(() => '*Topik utama*\n- target Q4');
  const umum = rooms.list(ilham)[0].id;
  assert.throws(() => rooms.summarize(ilham, umum, { days: 7 }), /tidak ada pesan/);
  const root = rooms.post(irfan, umum, { body: 'Target Q4 Surabaya 1,5 M' });
  rooms.post(ilham, umum, { body: 'Setuju', parentId: root.id });
  assert.throws(() => rooms.summarize(ilham, umum, { days: 3 }), (e) => e.status === 400);
  const job = rooms.summarize(ilham, umum, { days: 7 });
  assert.deepStrictEqual([job.status, job.count, job.label, job.agent], ['running', 2, '7 hari terakhir', 'aurix']);
  await settle();
  assert.strictEqual(prompts[0].agentId, 'aurix');
  assert.match(prompts[0].text, /Irfan: Target Q4 Surabaya 1,5 M\n  ↳ \[[^\]]+\] Ilham: Setuju/, 'replies under their parent');
  assert.deepStrictEqual([rooms.getSummary(ilham, job.id).status, rooms.getSummary(ilham, job.id).content], ['done', '*Topik utama*\n- target Q4']);
  assert.throws(() => rooms.getSummary(irfan, job.id), (e) => e.status === 404);
  const shared = rooms.shareSummary(ilham, job.id);
  assert.deepStrictEqual([shared.agent, shared.parentId], ['aurix', null]);
  assert.match(shared.body, /^\*\*Ringkasan 7 hari terakhir\*\* — diminta @ilham\n\n\*Topik utama\*/);
  assert.throws(() => rooms.shareSummary(ilham, job.id), (e) => e.status === 409);
});
