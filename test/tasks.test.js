// EPIC-010 Task Focus: team tasks, focus counts in WIB, activity history.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { createTasks, wibToday } = require('../lib/tasks');
const { startServer, tempDir } = require('./helpers');

const at = (s) => Date.parse(s + '+07:00');

function setup() {
  const db = openDb(path.join(tempDir(), 't.db'));
  const add = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, 'x', ?, ?, 0)");
  add.run(1, 'ilham', 'Ilham', 'admin', 0);
  add.run(2, 'irfan', 'Irfan', 'member', 0);
  add.run(3, 'cahyo', 'Cahyo', 'member', 0);
  add.run(4, 'lama', 'Akun Lama', 'member', 1);
  const clock = { t: at('2026-10-19T23:30:00') };
  return { db, clock, tasks: createTasks({ db, now: () => clock.t }), ilham: { id: 1, username: 'ilham', role: 'admin' }, irfan: { id: 2, username: 'irfan', role: 'member' }, cahyo: { id: 3, username: 'cahyo', role: 'member' } };
}

test('"today" is the WIB calendar day', () => {
  assert.strictEqual(wibToday(at('2026-10-19T23:30:00')), '2026-10-19');
  assert.strictEqual(wibToday(at('2026-10-20T00:10:00')), '2026-10-20');
});

test('tasks are validated; no assignee means my own task', () => {
  const { tasks, irfan } = setup();
  const bad = (body, re) => assert.throws(() => tasks.create(irfan, body), (e) => e.status === 400 && re.test(e.message), JSON.stringify(body));
  bad({}, /judul/);
  bad({ title: '   ' }, /judul/);
  bad({ title: 'x'.repeat(301) }, /maksimal 300/);
  bad({ title: 'A', assignee: 'siapa' }, /penanggung jawab/);
  bad({ title: 'A', assignee: 'lama' }, /penanggung jawab/, 'disabled account');
  bad({ title: 'A', dueDate: '2026-02-30' }, /tenggat/);
  bad({ title: 'A', dueDate: '20-10-2026' }, /tenggat/);
  bad({ title: 'A', priority: 'urgent' }, /prioritas/);
  bad({ title: 'A', status: 'blocked' }, /status/);

  const { task, activity } = tasks.create(irfan, { title: '  Siapkan laporan Q3 ' });
  assert.deepStrictEqual([task.title, task.assignee.username, task.status, task.priority, task.dueDate, task.createdBy.name],
    ['Siapkan laporan Q3', 'irfan', 'todo', 'normal', null, 'Irfan']);
  assert.deepStrictEqual(activity.map((a) => [a.kind, a.by, a.body]), [['created', 'Irfan', 'membuat tugas ini']]);
  assert.deepStrictEqual(tasks.people().map((p) => p.username), ['cahyo', 'ilham', 'irfan'], 'active people only');
});

test('every change is written as a readable history, done is stamped', () => {
  const { tasks, irfan, cahyo, clock } = setup();
  const { task } = tasks.create(irfan, { title: 'Kirim penawaran', assignee: 'irfan', dueDate: '2026-10-21' });
  clock.t += 60000;
  tasks.update(cahyo, task.id, { assignee: 'cahyo', dueDate: '2026-10-22', priority: 'high', title: 'Kirim penawaran PT Maju' });
  tasks.update(cahyo, task.id, { dueDate: '2026-10-22' });   // no change: no history
  tasks.update(cahyo, task.id, { status: 'doing' });
  tasks.comment(irfan, task.id, 'Draft ada di Drive');
  assert.throws(() => tasks.comment(irfan, task.id, '  '), /komentar kosong/);
  clock.t += 60000;
  let out = tasks.update(cahyo, task.id, { status: 'done' });
  assert.deepStrictEqual([out.task.status, out.task.doneBy.name, out.task.doneAt, out.task.comments], ['done', 'Cahyo', clock.t, 1]);
  assert.deepStrictEqual(out.activity.map((a) => `${a.by}: ${a.body}`), [
    'Irfan: membuat tugas ini',
    'Cahyo: mengubah judul menjadi "Kirim penawaran PT Maju"',
    'Cahyo: menugaskan ke Cahyo',
    'Cahyo: mengubah tenggat menjadi 22 Okt 2026',
    'Cahyo: mengubah prioritas menjadi Tinggi',
    'Cahyo: mengubah status menjadi Dikerjakan',
    'Irfan: Draft ada di Drive',
    'Cahyo: menandai selesai'
  ]);
  out = tasks.update(irfan, task.id, { status: 'todo', dueDate: null, assignee: null });
  assert.deepStrictEqual([out.task.doneAt, out.task.doneBy, out.task.dueDate, out.task.assignee], [null, null, null, null]);
  assert.deepStrictEqual(out.activity.slice(-3).map((a) => a.body), ['mengosongkan penanggung jawab', 'menghapus tenggat', 'mengubah status menjadi Belum']);
});

test('my focus counts and lists: late and today in WIB, finished work fades out', () => {
  const { tasks, irfan, cahyo, clock } = setup();
  const mk = (who, title, dueDate, extra = {}) => tasks.create(who, { title, dueDate, ...extra }).task;
  mk(irfan, 'Terlambat', '2026-10-18');
  mk(irfan, 'Hari ini', '2026-10-19', { priority: 'low' });
  mk(irfan, 'Hari ini penting', '2026-10-19', { priority: 'high' });
  mk(irfan, 'Besok', '2026-10-20');
  mk(irfan, 'Tanpa tenggat', null);
  const done = mk(irfan, 'Sudah', '2026-10-18');
  tasks.update(irfan, done.id, { status: 'done' });
  mk(cahyo, 'Punya Cahyo', '2026-10-18');
  mk(irfan, 'Untuk Cahyo', '2026-10-19', { assignee: 'cahyo' });

  assert.deepStrictEqual(tasks.summary(irfan), { today: '2026-10-19', overdue: 1, dueToday: 2 });
  assert.deepStrictEqual(tasks.summary(cahyo), { today: '2026-10-19', overdue: 1, dueToday: 1 });
  assert.deepStrictEqual(tasks.list(irfan, { mine: true }).map((t) => t.title),
    ['Terlambat', 'Sudah', 'Hari ini penting', 'Hari ini', 'Besok', 'Tanpa tenggat'], 'by due date, then priority; no-date last');
  assert.deepStrictEqual(tasks.list(irfan, { assignee: 'cahyo' }).map((t) => t.title), ['Punya Cahyo', 'Untuk Cahyo']);
  assert.strictEqual(tasks.list(irfan).length, 8, 'the whole team sees every task');
  assert.throws(() => tasks.list(irfan, { assignee: 'siapa' }), (e) => e.status === 400);

  // Midnight WIB: yesterday's "today" tasks become late.
  clock.t = at('2026-10-20T00:05:00');
  assert.deepStrictEqual(tasks.summary(irfan), { today: '2026-10-20', overdue: 3, dueToday: 1 });
  // Two weeks on, finished tasks leave the lists.
  clock.t = at('2026-11-03T00:00:00');
  assert.ok(!tasks.list(irfan, { mine: true }).some((t) => t.title === 'Sudah'));
});

test('only the creator or an admin deletes a task', () => {
  const { tasks, irfan, cahyo, ilham } = setup();
  const a = tasks.create(irfan, { title: 'A' }).task;
  const b = tasks.create(irfan, { title: 'B' }).task;
  assert.throws(() => tasks.remove(cahyo, a.id), (e) => e.status === 403);
  tasks.remove(irfan, a.id);
  tasks.remove(ilham, b.id);
  assert.throws(() => tasks.get(a.id), (e) => e.status === 404);
  assert.throws(() => tasks.get(b.id), (e) => e.status === 404);
});

test('tasks API: login, create, focus summary, edit, comment, delete', async () => {
  const srv = await startServer([{ username: 'cahyo', password: 'cahyo-password-1' }, { username: 'irfan', password: 'irfan-password-1' }]);
  try {
    assert.strictEqual((await srv.request('/api/tasks')).status, 401);
    assert.strictEqual((await srv.request('/api/tasks/summary')).status, 401);
    const { cookie } = await srv.login('cahyo', 'cahyo-password-1');
    const irfan = (await srv.login('irfan', 'irfan-password-1')).cookie;
    assert.deepStrictEqual((await srv.json(cookie, 'GET', '/api/tasks/people')).body.people.map((p) => p.username), ['cahyo', 'irfan']);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    const made = await srv.json(cookie, 'POST', '/api/tasks', { title: 'Rekap absensi', dueDate: today });
    assert.strictEqual(made.status, 201);
    const id = made.body.task.id;
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/tasks', { title: '' })).status, 400);
    const sum = (await srv.json(cookie, 'GET', '/api/tasks/summary')).body;
    assert.deepStrictEqual([sum.today, sum.dueToday, sum.overdue], [today, 1, 0]);
    assert.deepStrictEqual((await srv.json(irfan, 'GET', '/api/tasks')).body.tasks.map((t) => t.id), [id], 'visible to the team');
    assert.strictEqual((await srv.json(irfan, 'GET', '/api/tasks?mine=1')).body.tasks.length, 0);
    const ed = await srv.json(irfan, 'PATCH', '/api/tasks/' + id, { status: 'doing' });
    assert.strictEqual(ed.body.task.status, 'doing');
    const c = await srv.json(irfan, 'POST', `/api/tasks/${id}/comments`, { body: 'Saya bantu' });
    assert.strictEqual(c.status, 201);
    assert.strictEqual(c.body.activity.at(-1).body, 'Saya bantu');
    assert.strictEqual((await srv.json(irfan, 'DELETE', '/api/tasks/' + id)).status, 403);
    assert.strictEqual((await srv.json(cookie, 'DELETE', '/api/tasks/' + id)).status, 200);
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/tasks/' + id)).status, 404);
  } finally {
    await srv.stop();
  }
});
