// EPIC-016 Voice mode: LiveKit tokens, voice sessions, transcript turns.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { mintToken, parseVoices } = require('../lib/voice');
const { startServer } = require('./helpers');

const decode = (t) => { const [h, b, s] = t.split('.'); return { head: JSON.parse(Buffer.from(h, 'base64url')), body: JSON.parse(Buffer.from(b, 'base64url')), sig: s, signed: h + '.' + b }; };

test('a LiveKit token is a signed HS256 JWT with the room grant and the agent dispatch', () => {
  const now = Date.parse('2026-10-20T10:00:00+07:00');
  const t = mintToken({ key: 'APIabc', secret: 's3cret', identity: 'irfan-1234', name: 'Irfan', room: 'cc-x', metadata: { agent: 'dave', conversationId: 'x' }, now });
  const { head, body, sig, signed } = decode(t);
  assert.deepStrictEqual(head, { alg: 'HS256', typ: 'JWT' });
  assert.strictEqual(sig, crypto.createHmac('sha256', 's3cret').update(signed).digest('base64url'));
  assert.deepStrictEqual([body.iss, body.sub, body.name, body.exp - body.iat], ['APIabc', 'irfan-1234', 'Irfan', 3600]);
  assert.deepStrictEqual(body.video, { roomJoin: true, room: 'cc-x', canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false });
  assert.deepStrictEqual(body.roomConfig.agents, [{ agentName: 'hg-voice', metadata: JSON.stringify({ agent: 'dave', conversationId: 'x' }) }]);
  assert.strictEqual(parseVoices('dave:reporter, nana:female_news').dave, 'reporter');
  assert.strictEqual(parseVoices('').jaden, 'female_assistant');
});

test('voice off: status says so and sessions are refused', async () => {
  const srv = await startServer([{ username: 'irfan', password: 'irfan-password-1' }]);
  try {
    const { cookie } = await srv.login('irfan', 'irfan-password-1');
    assert.deepStrictEqual((await srv.json(cookie, 'GET', '/api/voice/status')).body, { enabled: false, url: null, livekit: null });
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/voice/session', { agentId: 'dave' })).status, 503);
    assert.strictEqual((await srv.request('/api/v1/voice/turns', { method: 'POST', body: '{}' })).status, 401, 'no worker key configured');
  } finally { await srv.stop(); }
});

test('voice on: a call opens a conversation; the worker writes the transcript into it', async () => {
  const srv = await startServer([{ username: 'irfan', password: 'irfan-password-1' }, { username: 'cahyo', password: 'cahyo-password-1' }],
    { CHAT_VOICE_LIVEKIT_URL: 'wss://voice.example', CHAT_VOICE_LIVEKIT_KEY: 'APIabc', CHAT_VOICE_LIVEKIT_SECRET: 's3cret', CHAT_VOICE_WORKER_KEY: 'cc_voice_test', CHAT_VOICE_PROFILES: 'nana:female_news' });
  try {
    assert.strictEqual((await srv.request('/api/voice/session', { method: 'POST', body: '{}' })).status, 401);
    const { cookie } = await srv.login('irfan', 'irfan-password-1');
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/voice/session', { agentId: 'main' })).status, 400);
    const s = await srv.json(cookie, 'POST', '/api/voice/session', { agentId: 'nana' });
    assert.strictEqual(s.status, 201);
    assert.deepStrictEqual([s.body.url, s.body.agent, s.body.voiceProfile, s.body.room], ['wss://voice.example', 'nana', 'female_news', 'cc-' + s.body.conversationId]);
    const { body } = decode(s.body.token);
    assert.strictEqual(body.video.room, s.body.room);
    const meta = JSON.parse(body.metadata);
    assert.deepStrictEqual([meta.agent, meta.conversationId, meta.hermesSession, meta.user, meta.voiceProfile], ['nana', s.body.conversationId, 'hgchat-' + s.body.conversationId, 'irfan', 'female_news']);
    const c = (await srv.json(cookie, 'GET', '/api/conversations/' + s.body.conversationId)).body.conversation;
    assert.match(c.title, /^🎙️ Panggilan suara · /);
    assert.strictEqual(c.agentId, 'nana');

    const turn = (auth, b) => srv.request('/api/v1/voice/turns', { method: 'POST', headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    assert.strictEqual((await turn('wrong', { conversationId: s.body.conversationId, role: 'user', text: 'x' })).status, 401);
    assert.strictEqual((await turn('cc_voice_test', { conversationId: s.body.conversationId, role: 'tool', text: 'x' })).status, 400);
    assert.strictEqual((await turn('cc_voice_test', { conversationId: crypto.randomUUID(), role: 'user', text: 'x' })).status, 404);
    assert.strictEqual((await turn('cc_voice_test', { conversationId: s.body.conversationId, role: 'user', text: 'Halo Nana, anggaran bulan ini berapa?' })).status, 200);
    assert.strictEqual((await turn('cc_voice_test', { conversationId: s.body.conversationId, role: 'assistant', text: 'Halo Irfan! Anggaran bulan ini 50 juta.' })).status, 200);
    const msgs = (await srv.json(cookie, 'GET', `/api/conversations/${s.body.conversationId}/messages`)).body.messages;
    assert.deepStrictEqual(msgs.map((m) => [m.role, m.content]), [['user', 'Halo Nana, anggaran bulan ini berapa?'], ['assistant', 'Halo Irfan! Anggaran bulan ini 50 juta.']]);
    const other = (await srv.login('cahyo', 'cahyo-password-1')).cookie;
    assert.strictEqual((await srv.json(other, 'GET', '/api/conversations/' + s.body.conversationId)).status, 404, 'the call is private to its owner');
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/voice/status')).body.enabled, true);
  } finally { await srv.stop(); }
});
