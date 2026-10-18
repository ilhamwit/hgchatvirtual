// EPIC-008 T-043/T-045: group archive indexing, group pages and summaries.
// Uses a temp archive, a fake bridge (/chat/:id) and a fake Hermes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createWaArchive, parseDay } = require('../lib/wa-archive');
const { startServer, startFakeGateway, tempDir } = require('./helpers');

const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';
const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const line = (o) => JSON.stringify({ senderId: o.sender + '@lid', senderNumber: '62811' + o.sender.length, senderName: o.sender, hasMedia: false, mediaType: null, fromMe: false, chatName: o.chatId, ...o }) + '\n';

function fakeBridge(names) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    const id = decodeURIComponent(req.url.replace('/chat/', ''));
    calls.push(id);
    const n = names[id];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(n ? { name: n[0], isGroup: true, participants: Array(n[1]).fill('x') } : { name: id.replace(/@.*/, ''), isGroup: true, participants: [] }));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, calls, close: () => srv.close() })));
}

test('dates are parsed in local time and impossible dates are rejected', () => {
  assert.strictEqual(parseDay('2026-10-18'), new Date(2026, 9, 18).getTime());
  assert.strictEqual(parseDay('2026-02-31'), null);
  assert.strictEqual(parseDay('18-10-2026'), null);
});

test('indexing is incremental, waits for complete lines, skips junk, survives rotation', () => {
  const dir = tempDir();
  const file = path.join(dir, 'archive.jsonl');
  const db = openDb(':memory:');
  const wa = createWaArchive({ hermesStateDb: '/nonexistent', sessionDir: '/nonexistent', db, gateway: null, archivePath: file, bridgeUrl: 'http://127.0.0.1:9' });
  assert.strictEqual(wa.sync(), 0, 'no file yet');
  const a = line({ chatId: G1, ts: at(2026, 10, 18, 9), sender: 'Ana', body: 'pagi' });
  const b = line({ chatId: G1, ts: at(2026, 10, 18, 10), sender: 'Budi', body: 'halo' });
  const c = line({ chatId: G2, ts: at(2026, 10, 18, 11), sender: 'Cici', body: 'rapat jam 3' });
  fs.writeFileSync(file, a + 'not json\n' + line({ chatId: '628111@s.whatsapp.net', ts: 1, sender: 'X', body: 'dm' }) + b + c.slice(0, 20));
  assert.strictEqual(wa.sync(), 2, 'two group lines; junk, a DM and a half-written line skipped');
  fs.appendFileSync(file, c.slice(20));
  assert.strictEqual(wa.sync(), 1, 'the finished line is picked up');
  assert.strictEqual(wa.sync(), 0);
  // Rotation: a new file (new inode) holding old and new lines.
  fs.unlinkSync(file);
  fs.writeFileSync(file, a + b + c + line({ chatId: G2, ts: at(2026, 10, 18, 12), sender: 'Cici', body: 'oke' }));
  assert.strictEqual(wa.sync(), 1, 'only the new message; no duplicates');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM wa_messages').get().n, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('groups get names from the bridge (cached), newest first, with last message', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'archive.jsonl');
  fs.writeFileSync(file,
    line({ chatId: G1, ts: at(2026, 10, 18, 9), sender: 'Ana', body: 'pagi' }) +
    line({ chatId: G2, ts: at(2026, 10, 18, 11), sender: 'Cici', body: '', hasMedia: true, mediaType: 'image' }));
  const bridge = await fakeBridge({ [G2]: ['Tim Inti', 5] });
  const db = openDb(':memory:');
  const wa = createWaArchive({ hermesStateDb: '/nonexistent', sessionDir: '/nonexistent', db, gateway: null, archivePath: file, bridgeUrl: bridge.url });
  try {
    const g = await wa.groups();
    assert.deepStrictEqual(g.map((x) => [x.id, x.name, x.participants, x.messageCount]), [[G2, 'Tim Inti', 5, 1], [G1, null, null, 1]]);
    assert.deepStrictEqual(g[0].last, { sender: 'Cici', text: '[foto]', fromMe: false });
    const before = bridge.calls.length;
    await wa.groups();
    assert.strictEqual(bridge.calls.length - before, 1, 'named group cached; the unnamed one is asked again');
  } finally {
    bridge.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('messages page newest-first with hasMore, shown oldest-first', () => {
  const dir = tempDir();
  const file = path.join(dir, 'archive.jsonl');
  let all = '';
  for (let i = 0; i < 250; i++) all += line({ chatId: G1, ts: at(2026, 10, 1) + i * 60000, sender: 'Ana', body: 'pesan ' + i });
  fs.writeFileSync(file, all);
  const wa = createWaArchive({ hermesStateDb: '/nonexistent', sessionDir: '/nonexistent', db: openDb(':memory:'), gateway: null, archivePath: file, bridgeUrl: 'http://127.0.0.1:9' });
  const p1 = wa.messages(G1, { limit: 100 });
  assert.strictEqual(p1.messages.length, 100);
  assert.ok(p1.hasMore);
  assert.strictEqual(p1.messages.at(-1).body, 'pesan 249');
  const p3 = wa.messages(G1, { limit: 100, before: wa.messages(G1, { limit: 100, before: p1.messages[0].id }).messages[0].id });
  assert.strictEqual(p3.messages.length, 50);
  assert.strictEqual(p3.hasMore, false);
  assert.strictEqual(p3.messages[0].body, 'pesan 0');
  assert.strictEqual(wa.messages('120363999@g.us'), null, 'unknown group');
  assert.throws(() => wa.messages('628111@s.whatsapp.net'), /bukan id grup/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('long ranges are summarized in parts, then combined, always by Aurix; tools and sending are forbidden', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'archive.jsonl');
  let all = '';
  for (let i = 0; i < 30; i++) all += line({ chatId: G1, ts: at(2026, 10, 18, 8) + i * 60000, sender: i % 2 ? 'Ana' : 'Budi', body: 'diskusi anggaran bagian ' + i });
  fs.writeFileSync(file, all);
  const calls = [];
  const gateway = { ask: async (a) => { calls.push(a); return a.conversationId.endsWith('-0') ? '## Ringkasan\nFinal' : 'catatan ' + calls.length; } };
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (1, 'ilham', 'Ilham', 'x', 0)").run();
  const wa = createWaArchive({ hermesStateDb: '/nonexistent', sessionDir: '/nonexistent', db, gateway, archivePath: file, bridgeUrl: 'http://127.0.0.1:9', chunkChars: 400 });
  // A browser-supplied agent is ignored: the summary agent is server config.
  const s = wa.createSummary({ id: 1 }, { chatId: G1, from: '2026-10-18', to: '2026-10-18', agentId: 'joel' });
  assert.strictEqual(s.status, 'running');
  assert.strictEqual(s.messageCount, 30);
  await new Promise((r) => setTimeout(r, 50));
  const done = wa.getSummary(s.id);
  assert.strictEqual(done.status, 'done');
  assert.strictEqual(done.content, '## Ringkasan\nFinal');
  assert.strictEqual(done.by, 'ilham');
  const parts = calls.length - 1;
  assert.ok(parts > 1, 'more than one part');
  assert.ok(calls.every((c) => c.agentId === 'aurix'), 'Aurix writes every part');
  assert.strictEqual(done.agentId, 'aurix');
  assert.deepStrictEqual(calls.map((c) => c.conversationId), [...Array(parts)].map((_, i) => `wasum-${s.id}-${i + 1}`).concat(`wasum-${s.id}-0`));
  assert.match(calls.at(-1).text, /Gabungkan menjadi satu ringkasan[\s\S]*### Catatan bagian 1/);
  for (const c of calls) assert.match(c.text, /[Jj]angan memakai tool/);
  assert.match(calls[0].text, /\[2026-10-18 08:00\] Budi: diskusi anggaran bagian 0/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a summary cut off by a restart is marked failed on the next start', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO wa_summaries (chat_id, from_ts, to_ts, agent_id, status, created_at) VALUES (?, 0, 1, 'dave', 'running', 0)").run(G1);
  createWaArchive({ hermesStateDb: '/nonexistent', sessionDir: '/nonexistent', db, gateway: null, archivePath: '/nonexistent', bridgeUrl: 'http://127.0.0.1:9' });
  const r = db.prepare('SELECT status, error FROM wa_summaries').get();
  assert.strictEqual(r.status, 'error');
  assert.match(r.error, /restart/);
});

// ── through the HTTP API ──

test('API: groups and read-only messages for any logged-in user; summaries via Hermes', async () => {
  let mode = {};
  const gw = await startFakeGateway(() => mode);
  const home = tempDir();
  const archive = path.join(home, 'archive.jsonl');
  fs.writeFileSync(archive,
    line({ chatId: G1, ts: at(2026, 10, 17, 9), sender: 'Ana', body: 'kemarin' }) +
    line({ chatId: G1, ts: at(2026, 10, 18, 9), sender: 'Budi', body: 'hari ini' }));
  const srv = await startServer([{ username: 'cahyo', password: 'cahyo-password-1' }], { CHAT_WA_ARCHIVE: archive, CHAT_HERMES_URL: gw.url });
  try {
    assert.strictEqual((await srv.request('/api/wa/groups')).status, 401);
    const { cookie } = await srv.login('cahyo', 'cahyo-password-1');
    const groups = (await srv.json(cookie, 'GET', '/api/wa/groups')).body.groups;
    assert.deepStrictEqual(groups.map((g) => [g.id, g.messageCount]), [[G1, 2]]);
    const msgs = await srv.json(cookie, 'GET', `/api/wa/groups/${encodeURIComponent(G1)}/messages`);
    assert.deepStrictEqual(msgs.body.messages.map((m) => [m.sender, m.body]), [['Ana', 'kemarin'], ['Budi', 'hari ini']]);
    assert.strictEqual((await srv.json(cookie, 'GET', `/api/wa/groups/${encodeURIComponent('120363999@g.us')}/messages`)).status, 404);
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/wa/groups/bad/messages')).status, 400);

    // Validation.
    const bad = async (body, re) => {
      const r = await srv.json(cookie, 'POST', '/api/wa/summaries', { chatId: G1, from: '2026-10-17', to: '2026-10-18', agentId: 'dave', ...body });
      assert.strictEqual(r.status, 400, JSON.stringify(body));
      assert.match(r.body.error, re);
    };
    await bad({ from: '2026-13-01' }, /YYYY-MM-DD/);
    await bad({ from: '2026-10-19' }, /sebelum tanggal awal/);
    await bad({ from: '2026-01-01' }, /maksimal 92 hari/);
    await bad({ from: '2026-10-10', to: '2026-10-12' }, /tidak ada pesan/);

    // One day only: just "hari ini" goes to Hermes — always as Aurix, whatever the browser asks.
    mode = { delayMs: 300, json: { choices: [{ message: { role: 'assistant', content: '## Ringkasan\nBudi menyapa.' } }] } };
    const created = await srv.json(cookie, 'POST', '/api/wa/summaries', { chatId: G1, from: '2026-10-18', to: '2026-10-18', agentId: 'nana' });
    assert.strictEqual(created.status, 202);
    assert.strictEqual(created.body.summary.messageCount, 1);
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/wa/summaries', { chatId: G1, from: '2026-10-18', to: '2026-10-18', agentId: 'dave' })).status, 409, 'one at a time per group');
    let s;
    for (let i = 0; i < 40; i++) {
      s = (await srv.json(cookie, 'GET', `/api/wa/summaries/${created.body.summary.id}`)).body.summary;
      if (s.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.strictEqual(s.status, 'done');
    assert.strictEqual(s.content, '## Ringkasan\nBudi menyapa.');
    const call = gw.calls.at(-1);
    assert.strictEqual(call.path, '/p/aurix/v1/chat/completions');
    assert.strictEqual(call.headers['x-hermes-session-id'], `hgchat-wasum-${s.id}-0`);
    assert.match(call.body.messages[0].content, /Budi: hari ini/);
    assert.doesNotMatch(call.body.messages[0].content, /kemarin/);
    const list = (await srv.json(cookie, 'GET', `/api/wa/summaries?chatId=${encodeURIComponent(G1)}`)).body.summaries;
    assert.deepStrictEqual(list.map((x) => [x.from, x.to, x.agentId, x.by, x.status]), [['2026-10-18', '2026-10-18', 'aurix', 'cahyo', 'done']]);
  } finally {
    await srv.stop();
    await gw.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ── bot replies (from Hermes' state.db) and "@<lid>" mentions ──

function fakeHermes(dir, rows) {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(dir, 'state.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT, chat_type TEXT, chat_id TEXT);
           CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, finish_reason TEXT, timestamp REAL);`);
  db.prepare("INSERT OR IGNORE INTO sessions VALUES ('sg', 'whatsapp', 'group', ?), ('sd', 'whatsapp', 'dm', '628111@s.whatsapp.net')").run(G1);
  for (const r of rows) db.prepare('INSERT INTO messages (session_id, role, content, finish_reason, timestamp) VALUES (?, ?, ?, ?, ?)').run(...r);
  db.close();
  return file;
}

function fakeSession(dir) {
  const s = path.join(dir, 'session');
  fs.mkdirSync(s, { recursive: true });
  fs.writeFileSync(path.join(s, 'creds.json'), JSON.stringify({ me: { id: '628999000111:8@s.whatsapp.net', name: 'Rederp', lid: '110935482048547:8@lid' } }));
  fs.writeFileSync(path.join(s, 'lid-mapping-20714795057374_reverse.json'), JSON.stringify('628122000'));
  return s;
}

test("the bot's group replies come from Hermes' sessions, incrementally, and only final ones", () => {
  const dir = tempDir();
  const t = at(2026, 10, 18, 9) / 1000;
  const stateDb = fakeHermes(dir, [
    ['sg', 'user', 'tanya', null, t],
    ['sg', 'assistant', 'sebentar, saya cek', 'tool_calls', t + 1],
    ['sg', 'assistant', 'Jawaban bot', 'stop', t + 2],
    ['sg', 'assistant', '   ', 'stop', t + 3],
    ['sd', 'assistant', 'balasan DM', 'stop', t + 4]
  ]);
  const archivePath = path.join(dir, 'archive.jsonl');
  fs.writeFileSync(archivePath, line({ chatId: G1, ts: at(2026, 10, 18, 8, 59), sender: 'Ana', body: 'halo bot' }));
  const db = openDb(':memory:');
  const wa = createWaArchive({ db, gateway: null, archivePath, bridgeUrl: 'http://127.0.0.1:9', hermesStateDb: stateDb, sessionDir: fakeSession(dir) });
  assert.strictEqual(wa.sync(), 2, 'one member message + one final bot reply');
  const page = wa.messages(G1).messages;
  assert.deepStrictEqual(page.map((m) => [m.sender, m.body, m.fromMe]), [['Ana', 'halo bot', false], ['Rederp', 'Jawaban bot', true]]);
  fakeHermes(dir, [['sg', 'assistant', 'Balasan kedua', 'stop', t + 60]]);
  assert.strictEqual(wa.sync(), 1);
  assert.strictEqual(wa.sync(), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('"@<lid>" mentions show names: the bot, mapped members, unknown left as is', () => {
  const dir = tempDir();
  const archivePath = path.join(dir, 'archive.jsonl');
  fs.writeFileSync(archivePath,
    line({ chatId: G1, ts: at(2026, 10, 18, 9), sender: 'Cahyo Febrianto', senderNumber: '628122000', body: 'hai semua' }) +
    line({ chatId: G1, ts: at(2026, 10, 18, 10), sender: 'Ana', body: '@110935482048547 tolong cek, cc @20714795057374 dan @99999999999' }));
  const db = openDb(':memory:');
  const wa = createWaArchive({ db, gateway: null, archivePath, bridgeUrl: 'http://127.0.0.1:9', hermesStateDb: '/nonexistent', sessionDir: fakeSession(dir) });
  const page = wa.messages(G1).messages;
  assert.strictEqual(page[1].body, '@Rederp tolong cek, cc @Cahyo Febrianto dan @99999999999');
  fs.rmSync(dir, { recursive: true, force: true });
});
