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
