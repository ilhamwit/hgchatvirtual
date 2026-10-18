// EPIC-002/007 end to end: server-side history, one Hermes session per
// conversation, ownership, and no gateway proxy — against a fake Hermes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startServer, startFakeGateway, tempDir } = require('./helpers');

const ILHAM = { username: 'ilham', displayName: 'Ilham', password: 'ilham-password-1', role: 'admin' };
const IRFAN = { username: 'irfan', displayName: 'Irfan', password: 'irfan-password-1' };

let gw, srv, media, a, b;          // a = Ilham's cookie, b = Irfan's
let mode = { status: 200 };        // what the fake gateway does next

test.before(async () => {
  gw = await startFakeGateway(() => mode);
  media = tempDir();
  srv = await startServer([ILHAM, IRFAN], { CHAT_HERMES_URL: gw.url, CHAT_MEDIA_DIR: media });
  a = (await srv.login('ilham', ILHAM.password, { 'CF-Connecting-IP': '203.0.113.1' })).cookie;
  b = (await srv.login('irfan', IRFAN.password, { 'CF-Connecting-IP': '203.0.113.2' })).cookie;
});
test.after(async () => {
  await srv.stop();
  await gw.close();
  fs.rmSync(media, { recursive: true, force: true });
});
test.beforeEach(() => { mode = { status: 200 }; });

const newConv = async (cookie, agentId = 'dave') => (await srv.json(cookie, 'POST', '/api/conversations', { agentId })).body.conversation;
const send = (cookie, id, text, extra = {}) => srv.json(cookie, 'POST', `/api/conversations/${id}/messages`, { text, ...extra });

test('agents list and conversation creation', async () => {
  const r = await srv.json(a, 'GET', '/api/agents');
  assert.deepStrictEqual(r.body.agents, ['dave', 'jaden', 'joel', 'dylan', 'nana']);
  assert.strictEqual((await srv.json(a, 'POST', '/api/conversations', { agentId: 'main' })).status, 400, 'unknown agent');
  const c = await newConv(a, 'joel');
  assert.match(c.id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(c.agentId, 'joel');
});

test('a turn stores both messages and reaches Hermes correctly', async () => {
  const c = await newConv(a);
  const before = gw.calls.length;
  const r = await send(a, c.id, 'Halo Dave');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.message.role, 'user');
  assert.strictEqual(r.body.reply.role, 'assistant');

  const call = gw.calls[before];
  assert.strictEqual(call.path, '/p/dave/v1/chat/completions', 'the agent is a Hermes profile');
  assert.strictEqual(call.body.model, 'dave');
  assert.strictEqual(call.headers['x-hermes-session-id'], 'hgchat-' + c.id, 'one Hermes session per conversation');
  assert.strictEqual(call.body.messages.length, 1, 'Hermes holds the transcript; only the new message is sent');
  assert.strictEqual(call.body.user, undefined);
  assert.strictEqual(call.headers.authorization, 'Bearer test-key');
  assert.strictEqual(call.headers.cookie, undefined, 'the session cookie never reaches Hermes');
  assert.match(call.body.messages[0].content, /^\[Dari: Ilham \(@ilham\) via HG Chat\]\n\nHalo Dave$/, 'sender attribution');

  const list = await srv.json(a, 'GET', `/api/conversations/${c.id}/messages`);
  assert.deepStrictEqual(list.body.messages.map((m) => [m.role, m.content]), [['user', 'Halo Dave'], ['assistant', r.body.reply.content]]);
  const conv = (await srv.json(a, 'GET', `/api/conversations/${c.id}`)).body.conversation;
  assert.strictEqual(conv.title, 'Halo Dave', 'first message names the conversation');
});

test('two users on the same agent get separate Hermes sessions', async () => {
  const ca = await newConv(a, 'nana');
  const cb = await newConv(b, 'nana');
  const before = gw.calls.length;
  await send(a, ca.id, 'dari ilham');
  await send(b, cb.id, 'dari irfan');
  const [u1, u2] = gw.calls.slice(before).map((c) => c.headers['x-hermes-session-id']);
  assert.notStrictEqual(u1, u2);
  assert.match(gw.calls.at(-1).body.messages[0].content, /^\[Dari: Irfan \(@irfan\)/);
});

test('history is the same from another login (another device)', async () => {
  const c = await newConv(a, 'dylan');
  await send(a, c.id, 'ingat ini');
  const other = (await srv.login('ilham', ILHAM.password, { 'CF-Connecting-IP': '203.0.113.3' })).cookie;
  assert.notStrictEqual(other, a);
  const list = await srv.json(other, 'GET', `/api/conversations/${c.id}/messages`);
  assert.strictEqual(list.body.messages[0].content, 'ingat ini');
  const convs = (await srv.json(other, 'GET', '/api/conversations?agent=dylan')).body.conversations;
  assert.ok(convs.some((x) => x.id === c.id && x.lastMessage.role === 'assistant'));
});

test("another user's conversation is a 404 for every route", async () => {
  const c = await newConv(a, 'jaden');
  await send(a, c.id, 'rahasia');
  for (const [method, p, body] of [
    ['GET', `/api/conversations/${c.id}`], ['GET', `/api/conversations/${c.id}/messages`],
    ['PATCH', `/api/conversations/${c.id}`, { title: 'x' }], ['POST', `/api/conversations/${c.id}/messages`, { text: 'hi' }],
    ['POST', `/api/conversations/${c.id}/retry`], ['POST', `/api/conversations/${c.id}/stop`]
  ]) {
    assert.strictEqual((await srv.json(b, method, p, body)).status, 404, `${method} ${p}`);
  }
  const mine = (await srv.json(b, 'GET', '/api/conversations')).body.conversations;
  assert.ok(!mine.some((x) => x.id === c.id), 'list shows only own conversations');
});

test('gateway down: the question is kept, the error is stored, retry recovers', async () => {
  const c = await newConv(a);
  mode = { status: 500, json: { error: { message: 'boom' } } };
  const r = await send(a, c.id, 'tolong');
  assert.strictEqual(r.body.reply.role, 'error');
  assert.match(r.body.reply.content, /Hermes error 500 — boom/);

  mode = { status: 200 };
  const retry = await srv.json(a, 'POST', `/api/conversations/${c.id}/retry`);
  assert.strictEqual(retry.body.reply.role, 'assistant');
  const roles = (await srv.json(a, 'GET', `/api/conversations/${c.id}/messages`)).body.messages.map((m) => m.role);
  assert.deepStrictEqual(roles, ['user', 'error', 'assistant'], 'retry does not store the question twice');
  assert.strictEqual((await srv.json(a, 'POST', `/api/conversations/${c.id}/retry`)).status, 400, 'nothing left to retry');
});

test('stop cancels the running turn upstream and stores "Dihentikan."', async () => {
  const c = await newConv(a);
  mode = { delayMs: 3000 };
  const abortedBefore = gw.aborted;
  const sending = send(a, c.id, 'lama sekali');
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual((await srv.json(a, 'GET', `/api/conversations/${c.id}`)).body.conversation.pending, true);
  assert.strictEqual((await send(a, c.id, 'lagi')).status, 409, 'one turn at a time per conversation');
  assert.deepStrictEqual((await srv.json(a, 'POST', `/api/conversations/${c.id}/stop`)).body, { stopped: true });
  const r = await sending;
  assert.strictEqual(r.body.reply.role, 'error');
  assert.strictEqual(r.body.reply.content, 'Dihentikan.');
  await new Promise((r2) => setTimeout(r2, 100));
  assert.strictEqual(gw.aborted, abortedBefore + 1, 'the gateway request was cancelled');
  assert.strictEqual((await srv.json(a, 'GET', `/api/conversations/${c.id}`)).body.conversation.pending, false);
});

test('a reply still lands in history when the browser disconnects', async () => {
  const c = await newConv(a);
  mode = { delayMs: 500 };
  const ctrl = new AbortController();
  const req = fetch(`${srv.base}/api/conversations/${c.id}/messages`, {
    method: 'POST', signal: ctrl.signal,
    headers: { cookie: a, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'tutup tab' })
  }).catch(() => null);
  await new Promise((r) => setTimeout(r, 100));
  ctrl.abort();
  await req;
  await new Promise((r) => setTimeout(r, 800));
  const roles = (await srv.json(a, 'GET', `/api/conversations/${c.id}/messages`)).body.messages.map((m) => m.role);
  assert.deepStrictEqual(roles, ['user', 'assistant']);
});

test('the gateway proxy is gone', async () => {
  for (const p of ['/v1/models', '/v1/chat/completions', '/v1/responses']) {
    assert.strictEqual((await srv.request(p, { headers: { cookie: a } })).status, 404, p);
    assert.strictEqual((await srv.request(p, { method: 'POST', headers: { cookie: a, 'x-openclaw-model': 'x' }, body: '{}' })).status, 404, p);
  }
});

test('attachments must be real uploads in the media dir', async () => {
  const c = await newConv(a);
  const name = 'laporan---' + crypto.randomUUID() + '.pdf';
  fs.writeFileSync(path.join(media, name), 'x');
  const ok = await send(a, c.id, 'cek ini', { attachments: [{ name: 'laporan.pdf', size: 1, path: path.join(media, name) }] });
  assert.strictEqual(ok.status, 200);
  assert.match(gw.calls.at(-1).body.messages[0].content, new RegExp(`\\[Lampiran: laporan\\.pdf -> ${path.join(media, name).replace(/[.]/g, '\\.')}\\]`));
  for (const p of ['/etc/passwd', path.join(media, 'nope---' + crypto.randomUUID() + '.pdf'), path.join(media, '..', name)]) {
    const r = await send(a, c.id, 'x', { attachments: [{ name: 'x', path: p }] });
    assert.strictEqual(r.status, 400, p);
  }
});

test('rename and archive', async () => {
  const c = await newConv(a, 'joel');
  await send(a, c.id, 'judul awal');
  const renamed = await srv.json(a, 'PATCH', `/api/conversations/${c.id}`, { title: 'Rencana Q4' });
  assert.strictEqual(renamed.body.conversation.title, 'Rencana Q4');
  await srv.json(a, 'PATCH', `/api/conversations/${c.id}`, { archived: true });
  const visible = (await srv.json(a, 'GET', '/api/conversations')).body.conversations;
  assert.ok(!visible.some((x) => x.id === c.id), 'archived conversations are hidden by default');
  const all = (await srv.json(a, 'GET', '/api/conversations?archived=1')).body.conversations;
  assert.ok(all.some((x) => x.id === c.id && x.archived), 'and kept, not deleted');
});

test('browser-history import creates one conversation per agent and is idempotent', async () => {
  const history = {
    dave: [{ role: 'u', text: 'lama 1', ts: 1000 }, { role: 'a', text: 'jawab 1', ts: 2000, att: [{ name: 'a.pdf', size: 5, path: '/x' }] }],
    jaden: [{ role: 'u', text: 'lama 2', ts: 3000 }],
    main: [{ role: 'u', text: 'agent tidak dikenal', ts: 1 }],
    joel: []
  };
  const first = await srv.json(b, 'POST', '/api/import', { history });
  assert.deepStrictEqual(first.body, { imported: 2, skipped: 0, messages: 3 });
  const again = await srv.json(b, 'POST', '/api/import', { history });
  assert.deepStrictEqual(again.body, { imported: 0, skipped: 2, messages: 0 });
  const convs = (await srv.json(b, 'GET', '/api/conversations')).body.conversations.filter((c) => c.title === 'Riwayat lama (browser)');
  assert.strictEqual(convs.length, 2);
  const dave = convs.find((c) => c.agentId === 'dave');
  const msgs = (await srv.json(b, 'GET', `/api/conversations/${dave.id}/messages`)).body.messages;
  assert.deepStrictEqual(msgs.map((m) => [m.role, m.content, m.createdAt]), [['user', 'lama 1', 1000], ['assistant', 'jawab 1', 2000]]);
  assert.deepStrictEqual(msgs[1].attachments, [{ name: 'a.pdf', size: 5 }], 'old attachment paths are not imported');
});

test('input limits', async () => {
  const c = await newConv(a);
  assert.strictEqual((await send(a, c.id, '   ')).status, 400, 'empty');
  assert.strictEqual((await send(a, c.id, 'x'.repeat(20001))).status, 400, 'too long');
  assert.strictEqual((await srv.json(a, 'PUT', `/api/conversations/${c.id}`)).status, 405, 'DELETE exists since EPIC-011; PUT does not');
  assert.strictEqual((await srv.json(a, 'GET', '/api/nope')).status, 404);
});

test('Hermes finish_reason cancelled or error is stored as an error, not a reply', async () => {
  const c = await newConv(a, 'jaden');
  mode = { json: { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'cancelled' }] } };
  let r = await send(a, c.id, 'satu');
  assert.strictEqual(r.body.reply.role, 'error');
  assert.strictEqual(r.body.reply.content, 'Dibatalkan oleh Hermes.');
  mode = { json: { choices: [{ message: { role: 'assistant', content: 'tool crashed' }, finish_reason: 'error' }] } };
  r = await srv.json(a, 'POST', `/api/conversations/${c.id}/retry`);
  assert.strictEqual(r.body.reply.role, 'error');
  assert.match(r.body.reply.content, /Hermes gagal menjalankan giliran ini: tool crashed/);
  mode = { status: 401, json: { error: { message: 'invalid API key' } } };
  r = await srv.json(a, 'POST', `/api/conversations/${c.id}/retry`);
  assert.match(r.body.reply.content, /^Hermes error 401 — invalid API key$/);
});

test('Hermes unreachable is a stored, retryable error', async () => {
  const off = await startServer([{ username: 'solo', password: 'solo-password-1' }]);
  const cookie = (await off.login('solo', 'solo-password-1')).cookie;
  const c = (await off.json(cookie, 'POST', '/api/conversations', { agentId: 'dave' })).body.conversation;
  const r = await off.json(cookie, 'POST', `/api/conversations/${c.id}/messages`, { text: 'halo' });
  await off.stop();
  assert.strictEqual(r.body.reply.role, 'error');
  assert.match(r.body.reply.content, /^Hermes tidak bisa dihubungi \(.+\)\.$/);
});
