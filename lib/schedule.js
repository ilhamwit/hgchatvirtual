// Agent schedules — Hermes cron, read only (EPIC-009 T-046).
//
// Hermes keeps, per profile (default = ~/.hermes, others under profiles/<p>):
//   cron/jobs.json        job definitions + state (next/last run, last error)
//   cron/executions.db    one row per run attempt
//   cron/output/<job>/    the result of each run, as <YYYY-MM-DD_HH-MM-SS>.md
// These are Hermes' files: this module only reads them. Changes go through
// the `hermes cron …` CLI (later tasks), never by writing these files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const JOB_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const PROFILE_RE = /^[a-z0-9_-]{1,64}$/;
const OUTPUT_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/;
const MAX_OUTPUT = 200 * 1024;
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });
const pad = (n) => String(n).padStart(2, '0');

// Schedule -> plain Indonesian. Falls back to Hermes' own display text.
function humanSchedule(s) {
  if (!s || typeof s !== 'object') return '—';
  if (s.kind === 'interval' && Number.isFinite(s.minutes)) {
    const m = s.minutes;
    if (m % 1440 === 0) return m === 1440 ? 'Setiap hari' : `Setiap ${m / 1440} hari`;
    if (m % 60 === 0) return m === 60 ? 'Setiap jam' : `Setiap ${m / 60} jam`;
    return `Setiap ${m} menit`;
  }
  if (s.kind === 'once' && s.run_at) {
    const d = new Date(s.run_at);
    if (!isNaN(d)) return `Sekali, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  }
  if (s.kind === 'cron' && s.expr) {
    // Common shapes only: "M H * * *" and "M H * * D[,D]". Anything else is
    // shown as the expression itself.
    const f = String(s.expr).trim().split(/\s+/);
    if (f.length === 5 && /^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) && f[2] === '*' && f[3] === '*') {
      const at = `${pad(f[1])}.${pad(f[0])}`;
      if (f[4] === '*') return `Setiap hari ${at}`;
      if (f[4] === '1-5') return `Setiap hari kerja ${at}`;
      if (/^[0-6](,[0-6])*$/.test(f[4])) return `Setiap ${f[4].split(',').map((d) => DAYS[+d]).join(', ')} ${at}`;
    }
    return `Cron: ${s.expr}`;
  }
  return s.display || s.kind || '—';
}

function createSchedule({
  db,
  hermesHome = process.env.CHAT_HERMES_HOME || path.join(os.homedir(), '.hermes')
} = {}) {
  function cronDir(profile) {
    return profile === 'default' ? path.join(hermesHome, 'cron') : path.join(hermesHome, 'profiles', profile, 'cron');
  }

  function profiles() {
    const out = ['default'];
    try {
      for (const p of fs.readdirSync(path.join(hermesHome, 'profiles'))) {
        if (PROFILE_RE.test(p) && fs.existsSync(path.join(hermesHome, 'profiles', p, 'cron'))) out.push(p);
      }
    } catch (e) { /* no profiles */ }
    return out;
  }

  function readJobs(profile) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(cronDir(profile), 'jobs.json'), 'utf8'));
      const jobs = Array.isArray(j) ? j : (j.jobs || {});
      return Array.isArray(jobs) ? jobs : Object.values(jobs);
    } catch (e) {
      return [];
    }
  }

  // "whatsapp:<group>@g.us" -> the group's name from the WhatsApp pages.
  function deliverLabel(deliver) {
    if (!deliver) return null;
    const [platform, ...rest] = String(deliver).split(':');
    const target = rest.join(':');
    let name = null;
    if (platform === 'whatsapp' && target.endsWith('@g.us') && db) {
      try { name = (db.prepare('SELECT name FROM wa_groups WHERE chat_id = ?').get(target) || {}).name || null; } catch (e) { /* table missing */ }
    }
    const app = { whatsapp: 'WhatsApp', telegram: 'Telegram', local: 'Lokal', origin: 'Asal permintaan' }[platform] || platform;
    return { platform, target, label: name ? `${app} · ${name}` : (target ? `${app} · ${target}` : app) };
  }

  function toJob(profile, j) {
    const paused = j.state === 'paused' || !!j.paused_at || j.enabled === false;
    const failing = (j.failure_streak || 0) > 0 || j.last_status === 'error' || j.last_status === 'failed';
    return {
      id: String(j.id), profile, name: j.name || String(j.id),
      schedule: humanSchedule(j.schedule), scheduleRaw: j.schedule_display || (j.schedule && j.schedule.display) || null,
      status: paused ? 'paused' : failing ? 'error' : 'active',
      state: j.state || null, pausedReason: j.paused_reason || null,
      nextRunAt: paused ? null : j.next_run_at || null,
      lastRunAt: j.last_run_at || null, lastStatus: j.last_status || null,
      lastError: j.last_error || j.last_delivery_error || null, failureStreak: j.failure_streak || 0,
      runsCompleted: (j.repeat && j.repeat.completed) || 0, runsLimit: (j.repeat && j.repeat.times) || null,
      deliver: deliverLabel(j.deliver),
      prompt: typeof j.prompt === 'string' ? j.prompt : null,
      script: j.script || null, noAgent: !!j.no_agent,
      skills: Array.isArray(j.skills) ? j.skills : [],
      createdAt: j.created_at || null
    };
  }

  function list() {
    const jobs = [];
    for (const p of profiles()) for (const j of readJobs(p)) if (j && j.id) jobs.push(toJob(p, j));
    const rank = { error: 0, active: 1, paused: 2 };
    return jobs.sort((a, b) => rank[a.status] - rank[b.status] || String(a.nextRunAt || '~').localeCompare(String(b.nextRunAt || '~')));
  }

  function find(profile, id) {
    if (!PROFILE_RE.test(String(profile)) || !JOB_ID_RE.test(String(id))) throw badRequest('jadwal tidak dikenal');
    if (!profiles().includes(profile)) return null;
    const j = readJobs(profile).find((x) => x && String(x.id) === id);
    return j ? toJob(profile, j) : null;
  }

  function runs(profile, id, limit = 20) {
    const file = path.join(cronDir(profile), 'executions.db');
    if (!fs.existsSync(file)) return [];
    let src;
    try {
      src = new DatabaseSync(file, { readOnly: true });
      src.exec('PRAGMA busy_timeout = 3000');
      return src.prepare(`SELECT id, status, source, started_at, finished_at, error, delivery_outcome
                            FROM executions WHERE job_id = ? ORDER BY COALESCE(started_at, claimed_at) DESC LIMIT ?`)
        .all(id, limit)
        .map((r) => ({ id: r.id, status: r.status, source: r.source, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error || null, delivery: r.delivery_outcome || null }));
    } catch (e) {
      return [];
    } finally {
      if (src) src.close();
    }
  }

  // Result files of a job, newest first; the newest one's text is included.
  function outputs(profile, id) {
    const dir = path.join(cronDir(profile), 'output', id);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => OUTPUT_RE.test(n)).sort().reverse(); } catch (e) { return { files: [], latest: null }; }
    let latest = null;
    if (names.length) {
      const file = path.join(dir, names[0]);
      const buf = fs.readFileSync(file);
      const text = buf.subarray(0, MAX_OUTPUT).toString('utf8');
      // Hermes writes the prompt and script output first, then "## Response".
      const at = text.search(/^## Response[ \t]*$/m);
      const response = at < 0 ? null : text.slice(at).replace(/^## Response[ \t]*\r?\n/, '').trim();
      latest = { name: names[0], text, response, truncated: buf.length > MAX_OUTPUT };
    }
    return { files: names.slice(0, 50), latest };
  }

  function detail(profile, id) {
    const job = find(profile, id);
    if (!job) return null;
    return { job, runs: runs(profile, id), output: outputs(profile, id) };
  }

  return { list, detail, profiles };
}

module.exports = { createSchedule, humanSchedule };
