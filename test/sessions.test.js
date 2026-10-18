// EPIC-011: sessions per agent (delete, archive/unarchive on send) and
// attachment previews served only to the owner, never as a page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startServer, startFakeGateway, tempDir } = require('./helpers');

const ILHAM = { username: 'ilham', displayName: 'Ilham', password: 'ilham-password-1', role: 'admin' };
const IRFAN = { username: 'irfan', displayName: 'Irfan', password: 'irfan-password-1' };

let gw, srv, media, a, b;
let mode = { status: 200 };

test.before(async () => {
  gw = await startFakeGateway(() => mode);
  media = tempDir();
  srv = await startServer([ILHAM, IRFAN], { CHAT_HERMES_URL: gw.url, CHAT_MEDIA_DIR: media });
  a = (await srv.login('ilham', ILHAM.password)).cookie;
  b = (await srv.login('irfan', IRFAN.password)).cookie;
});
test.after(async () => {
  await srv.stop();
  await gw.close();
  fs.rmSync(media, { recursive: true, force: true });
});
test.beforeEach(() => { mode = { status: 200 }; });

const newConv = async (cookie, agentId = 'dave') => (await srv.json(cookie, 'POST', '/api/conversations', { agentId })).body.conversation;
const send = (cookie, id, text, extra = {}) => srv.json(cookie, 'POST', `/api/conversations/${id}/messages`, { text, ...extra });
const upload = (name, content) => {
  const file = name.replace(/\.(\w+)$/, '').replace(/[^A-Za-z0-9._-]+/g, '-') + '---' + crypto.randomUUID() + path.extname(name);
  fs.writeFileSync(path.join(media, file), content);
  return { name, size: Buffer.byteLength(content), path: path.join(media, file), file };
};

test('many sessions per agent, listed per agent', async () => {
  const d1 = await newConv(a, 'dylan');
  const d2 = await newConv(a, 'dylan');
  await newConv(a, 'nana');
  await send(a, d1.id, 'sesi satu');
  await send(a, d2.id, 'sesi dua');
  const list = (await srv.json(a, 'GET', '/api/conversations?agent=dylan')).body.conversations;
  assert.deepStrictEqual(list.map((c) => c.title), ['sesi dua', 'sesi satu'], 'newest first, only Dylan');
});

test('delete a session: its messages go, others cannot, not while answering', async () => {
  const c = await newConv(a, 'joel');
  await send(a, c.id, 'hapus aku');
  assert.strictEqual((await srv.json(b, 'DELETE', `/api/conversations/${c.id}`)).status, 404, "someone else's session");
  assert.strictEqual((await srv.json(a, 'DELETE', `/api/conversations/${c.id}`)).status, 200);
  assert.strictEqual((await srv.json(a, 'GET', `/api/conversations/${c.id}/messages`)).status, 404);
  assert.strictEqual((await srv.json(a, 'DELETE', `/api/conversations/${c.id}`)).status, 404);

  const busy = await newConv(a, 'joel');
  mode = { status: 200, delayMs: 600 };
  const turn = send(a, busy.id, 'lama');
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual((await srv.json(a, 'DELETE', `/api/conversations/${busy.id}`)).status, 409);
  await turn;
  assert.strictEqual((await srv.json(a, 'DELETE', `/api/conversations/${busy.id}`)).status, 200);
});

test('writing in an archived session brings it back', async () => {
  const c = await newConv(a, 'nana');
  await send(a, c.id, 'pertama');
  await srv.json(a, 'PATCH', `/api/conversations/${c.id}`, { archived: true, title: 'Anggaran' });
  let all = (await srv.json(a, 'GET', '/api/conversations?agent=nana&archived=1')).body.conversations;
  assert.deepStrictEqual(all.filter((x) => x.id === c.id).map((x) => [x.title, x.archived]), [['Anggaran', true]]);
  assert.ok(!(await srv.json(a, 'GET', '/api/conversations?agent=nana')).body.conversations.some((x) => x.id === c.id), 'hidden from the normal list');
  await send(a, c.id, 'lanjut');
  all = (await srv.json(a, 'GET', '/api/conversations?agent=nana')).body.conversations;
  assert.deepStrictEqual(all.filter((x) => x.id === c.id).map((x) => x.archived), [false]);
});

test('attachments are previewed only by their owner, with safe types', async () => {
  const c = await newConv(a);
  const png = upload('foto.png', '\x89PNG fake');
  const pdf = upload('laporan Q3.pdf', '%PDF-1.4 fake');
  const xml = upload('data.xml', '<html><script>alert(1)</script></html>');
  const docx = upload('surat.docx', 'PK fake');
  const r = await send(a, c.id, 'cek', { attachments: [png, pdf, xml, docx].map(({ name, size, path: p }) => ({ name, size, path: p })) });
  assert.strictEqual(r.status, 200);
  const get = (cookie, file, q = '') => srv.request(`/api/files/${encodeURIComponent(file)}${q}`, { headers: { cookie } });

  let res = await get(a, png.file);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('content-disposition'), /^inline; filename="foto\.png"/);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.strictEqual(await res.text(), '\x89PNG fake');

  res = await get(a, pdf.file);
  assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''laporan%20Q3\.pdf/);
  assert.doesNotMatch(res.headers.get('content-security-policy'), /sandbox/, 'the PDF viewer needs it off');
  await res.arrayBuffer();

  res = await get(a, xml.file);
  assert.strictEqual(res.headers.get('content-type'), 'text/plain; charset=utf-8', 'markup is shown as text, never rendered');
  await res.arrayBuffer();

  res = await get(a, docx.file);
  assert.strictEqual(res.headers.get('content-type'), 'application/octet-stream');
  assert.match(res.headers.get('content-disposition'), /^attachment;/, 'no preview type: download only');
  await res.arrayBuffer();

  res = await get(a, png.file, '?download=1');
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
  await res.arrayBuffer();

  assert.strictEqual((await get(b, png.file)).status, 404, "another user's file");
  assert.strictEqual((await srv.request(`/api/files/${png.file}`)).status, 401, 'login required');
  const stray = upload('lain.png', 'x');   // in the media dir but in no message
  assert.strictEqual((await get(a, stray.file)).status, 404);
  for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'passwd', '%E0%A4%A']) {
    assert.strictEqual((await srv.request('/api/files/' + bad, { headers: { cookie: a } })).status, 404, bad);
  }

  // Deleting the session ends the preview.
  await srv.json(a, 'DELETE', `/api/conversations/${c.id}`);
  assert.strictEqual((await get(a, png.file)).status, 404);
});
