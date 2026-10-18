// EPIC-009 T-046: agent schedules read from a fake Hermes home (jobs.json,
// executions.db, output/). Hermes' files must never change.
process.env.TZ = 'Asia/Jakarta';   // "Sekali, …" is shown in the server's local time
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../lib/db');
const { createSchedule, humanSchedule } = require('../lib/schedule');
const { startServer, tempDir } = require('./helpers');

const GROUP = '120363000000000009@g.us';

// A Hermes home with jobs in two profiles, a run history and two outputs.
function fakeHermes() {
  const home = tempDir();
  const cron = path.join(home, 'cron');
  fs.mkdirSync(path.join(cron, 'output', 'aaa111bbb222'), { recursive: true });
  fs.writeFileSync(path.join(cron, 'jobs.json'), JSON.stringify({
    jobs: [
      { id: 'aaa111bbb222', name: 'wa-group-summary', schedule: { kind: 'interval', minutes: 360, display: 'every 360m' }, schedule_display: 'every 360m',
        enabled: true, state: 'scheduled', next_run_at: '2026-10-19T03:23:36.066948+07:00', last_run_at: '2026-10-18T21:23:36.066948+07:00',
        last_status: 'ok', failure_streak: 0, repeat: { times: null, completed: 1 }, deliver: 'whatsapp:' + GROUP,
        prompt: 'Ringkas pesan grup.', script: 'wa_group_digest.py', skills: [] },
      { id: 'ccc333ddd444', name: 'laporan-mingguan', schedule: { kind: 'cron', expr: '0 9 * * 1' }, enabled: true, state: 'paused',
        paused_at: '2026-10-18T10:00:00+07:00', paused_reason: 'libur', next_run_at: '2026-10-20T09:00:00+07:00', repeat: { completed: 0 }, deliver: 'local' }
    ],
    updated_at: '2026-10-18T21:23:36+07:00'
  }));
  const ex = new DatabaseSync(path.join(cron, 'executions.db'));
  ex.exec(`CREATE TABLE executions (id TEXT PRIMARY KEY, job_id TEXT, source TEXT, status TEXT, claimed_at TEXT,
             started_at TEXT, finished_at TEXT, error TEXT, delivery_outcome TEXT)`);
  const ins = ex.prepare('INSERT INTO executions VALUES (?,?,?,?,?,?,?,?,?)');
  ins.run('r1', 'aaa111bbb222', 'scheduled', 'failed', null, '2026-10-18T15:23:32+07:00', '2026-10-18T15:23:40+07:00', 'model timeout', null);
  ins.run('r2', 'aaa111bbb222', 'scheduled', 'completed', null, '2026-10-18T21:23:32+07:00', '2026-10-18T21:23:36+07:00', null, 'delivered');
  ins.run('r3', 'other', 'scheduled', 'completed', null, '2026-10-18T22:00:00+07:00', null, null, null);
  ex.close();
  const out = path.join(cron, 'output', 'aaa111bbb222');
  fs.writeFileSync(path.join(out, '2026-10-18_15-23-35.md'), '# old\n## Response\n\nlama');
  fs.writeFileSync(path.join(out, '2026-10-18_21-23-35.md'), '# Cron Job: wa-group-summary\n\n## Prompt\n\nrahasia prompt\n\n## Response\n\n**Ana** bertanya soal kalender.\n');
  fs.writeFileSync(path.join(out, 'notes.txt'), 'not an output');

  const dave = path.join(home, 'profiles', 'dave', 'cron');
  fs.mkdirSync(dave, { recursive: true });
  fs.writeFileSync(path.join(dave, 'jobs.json'), JSON.stringify({ jobs: [
    { id: 'eee555fff666', name: 'cek-invoice', schedule: { kind: 'cron', expr: '30 7 * * 1-5' }, enabled: true, state: 'scheduled',
      next_run_at: '2026-10-20T07:30:00+07:00', last_status: 'error', last_error: 'API down', failure_streak: 2, deliver: 'telegram:123' }
  ] }));
  fs.mkdirSync(path.join(home, 'profiles', 'nana', 'cron'), { recursive: true });   // cron folder, no jobs
  fs.mkdirSync(path.join(home, 'profiles', 'joel'), { recursive: true });           // no cron folder
  return home;
}

// Hash of every file under dir, to prove nothing was written.
function snapshot(dir) {
  const out = {};
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : (out[p] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')); } };
  walk(dir);
  return out;
}

test('schedules are described in plain Indonesian', () => {
  const cases = [
    [{ kind: 'interval', minutes: 360 }, 'Setiap 6 jam'],
    [{ kind: 'interval', minutes: 60 }, 'Setiap jam'],
    [{ kind: 'interval', minutes: 45 }, 'Setiap 45 menit'],
    [{ kind: 'interval', minutes: 1440 }, 'Setiap hari'],
    [{ kind: 'interval', minutes: 4320 }, 'Setiap 3 hari'],
    [{ kind: 'cron', expr: '0 9 * * *' }, 'Setiap hari 09.00'],
    [{ kind: 'cron', expr: '30 7 * * 1-5' }, 'Setiap hari kerja 07.30'],
    [{ kind: 'cron', expr: '0 17 * * 1,5' }, 'Setiap Senin, Jumat 17.00'],
    [{ kind: 'cron', expr: '*/15 * * * *' }, 'Cron: */15 * * * *'],
    [{ kind: 'once', run_at: '2026-10-20T09:05:00+07:00' }, 'Sekali, 20/10/2026 09.05'],
    [{ kind: 'weird', display: 'tiap purnama' }, 'tiap purnama'],
    [null, '—']
  ];
  for (const [s, want] of cases) assert.strictEqual(humanSchedule(s), want, JSON.stringify(s));
});

test('jobs from every profile are listed, failing first, without touching Hermes files', () => {
  const home = fakeHermes();
  const db = openDb(path.join(tempDir(), 't.db'));
  db.prepare('INSERT INTO wa_groups (chat_id, name, participants, checked_at) VALUES (?,?,?,?)').run(GROUP, 'HG Bot Testing', 3, Date.now());
  const before = snapshot(home);
  const s = createSchedule({ db, hermesHome: home });

  assert.deepStrictEqual(s.profiles(), ['default', 'dave', 'nana']);
  const jobs = s.list();
  assert.deepStrictEqual(jobs.map((j) => [j.profile, j.name, j.status]),
    [['dave', 'cek-invoice', 'error'], ['default', 'wa-group-summary', 'active'], ['default', 'laporan-mingguan', 'paused']]);
  const [inv, wa, weekly] = jobs;
  assert.strictEqual(inv.schedule, 'Setiap hari kerja 07.30');
  assert.strictEqual(inv.lastError, 'API down');
  assert.strictEqual(inv.failureStreak, 2);
  assert.strictEqual(inv.deliver.label, 'Telegram · 123');
  assert.strictEqual(wa.schedule, 'Setiap 6 jam');
  assert.strictEqual(wa.scheduleRaw, 'every 360m');
  assert.strictEqual(wa.deliver.label, 'WhatsApp · HG Bot Testing');
  assert.strictEqual(wa.nextRunAt, '2026-10-19T03:23:36.066948+07:00');
  assert.strictEqual(wa.lastStatus, 'ok');
  assert.strictEqual(wa.runsCompleted, 1);
  assert.strictEqual(wa.script, 'wa_group_digest.py');
  assert.strictEqual(weekly.schedule, 'Setiap Senin 09.00');
  assert.strictEqual(weekly.pausedReason, 'libur');
  assert.strictEqual(weekly.nextRunAt, null, 'a paused job has no next run');
  assert.strictEqual(weekly.deliver.label, 'Lokal');

  const d = s.detail('default', 'aaa111bbb222');
  assert.deepStrictEqual(d.runs.map((r) => [r.id, r.status, r.delivery, r.error]),
    [['r2', 'completed', 'delivered', null], ['r1', 'failed', null, 'model timeout']], 'own runs only, newest first');
  assert.deepStrictEqual(d.output.files, ['2026-10-18_21-23-35.md', '2026-10-18_15-23-35.md']);
  assert.strictEqual(d.output.latest.response, '**Ana** bertanya soal kalender.');
  assert.match(d.output.latest.text, /rahasia prompt/);
  const none = s.detail('default', 'ccc333ddd444');
  assert.deepStrictEqual([none.runs, none.output], [[], { files: [], latest: null }]);
  assert.deepStrictEqual(s.detail('dave', 'eee555fff666').runs, [], 'profile without executions.db');

  assert.strictEqual(s.detail('default', 'eee555fff666'), null, 'job of another profile');
  assert.strictEqual(s.detail('joel', 'aaa111bbb222'), null, 'profile without cron');
  for (const [p, id] of [['../dave', 'eee555fff666'], ['default', '../../etc'], ['default', 'a/b'], ['Default', 'aaa111bbb222']]) {
    assert.throws(() => s.detail(p, id), (e) => e.status === 400, `${p} ${id}`);
  }
  assert.deepStrictEqual(snapshot(home), before, 'Hermes files unchanged');
  db.close();
});

test('missing or broken Hermes files give an empty list, not an error', () => {
  const home = tempDir();
  assert.deepStrictEqual(createSchedule({ hermesHome: path.join(home, 'nope') }).list(), []);
  fs.mkdirSync(path.join(home, 'cron'));
  fs.writeFileSync(path.join(home, 'cron', 'jobs.json'), '{ not json');
  assert.deepStrictEqual(createSchedule({ hermesHome: home }).list(), []);
});

test('schedule API needs a login and serves list and detail', async () => {
  const home = fakeHermes();
  const srv = await startServer([{ username: 'irfan', password: 'irfan-password-1' }], { CHAT_HERMES_HOME: home });
  try {
    assert.strictEqual((await srv.request('/api/schedule/jobs')).status, 401);
    assert.strictEqual((await srv.request('/api/schedule/jobs/default/aaa111bbb222')).status, 401);
    const { cookie } = await srv.login('irfan', 'irfan-password-1');
    const list = await srv.json(cookie, 'GET', '/api/schedule/jobs');
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.body.jobs.map((j) => j.id), ['eee555fff666', 'aaa111bbb222', 'ccc333ddd444']);
    const d = await srv.json(cookie, 'GET', '/api/schedule/jobs/default/aaa111bbb222');
    assert.strictEqual(d.status, 200);
    assert.strictEqual(d.body.job.name, 'wa-group-summary');
    assert.strictEqual(d.body.runs.length, 2);
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/schedule/jobs/default/ffffffffffff')).status, 404);
    assert.strictEqual((await srv.json(cookie, 'GET', '/api/schedule/jobs/default/' + encodeURIComponent('../x'))).status, 400);
    assert.strictEqual((await srv.json(cookie, 'POST', '/api/schedule/jobs')).status, 405, 'read only');
  } finally {
    await srv.stop();
  }
});
