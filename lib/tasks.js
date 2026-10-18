// Task Focus — team tasks (EPIC-010).
//
// Every logged-in user sees and may change every task (owner's decision,
// 2026-10-19); only the creator or an admin may delete one. Every change is
// written to task_activity as a sentence a person can read ("mengubah tenggat
// menjadi 22 Okt"), next to the comments. Due dates are calendar days in WIB.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WIB_MS = 7 * 3600 * 1000;
const PRIORITY = { low: 'Rendah', normal: 'Normal', high: 'Tinggi' };
const STATUS = { todo: 'Belum', doing: 'Dikerjakan', done: 'Selesai' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DONE_KEEP_DAYS = 14;   // the board shows recently finished work only

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const badRequest = (msg) => httpError(400, msg);

const wibToday = (ms) => new Date(ms + WIB_MS).toISOString().slice(0, 10);
function validDate(s) {
  if (!DATE_RE.test(String(s))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const fmtDate = (s) => (s ? `${Number(s.slice(8))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : null);

function createTasks({ db, now = () => Date.now() }) {
  const people = () => db.prepare('SELECT id, username, display_name FROM users WHERE disabled = 0 ORDER BY display_name')
    .all().map((u) => ({ id: u.id, username: u.username, name: u.display_name }));
  const person = (id) => {
    if (!id) return null;
    const u = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(id);
    return u ? { id: u.id, username: u.username, name: u.display_name } : null;
  };
  const row = (id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  function requireTask(id) {
    const t = row(id);
    if (!t) throw httpError(404, 'tugas tidak ditemukan');
    return t;
  }

  function text(v, max, label) {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw badRequest(`${label} harus berupa teks`);
    const t = v.trim();
    if (t.length > max) throw badRequest(`${label} maksimal ${max} karakter`);
    return t || null;
  }

  // Form body -> column values (only the fields present).
  function validate(body, creating) {
    if (!body || typeof body !== 'object') throw badRequest('data tugas tidak valid');
    const out = {};
    const has = (k) => body[k] !== undefined;
    if (creating || has('title')) {
      out.title = text(body.title, 300, 'judul');
      if (!out.title) throw badRequest('judul tugas wajib diisi');
    }
    if (has('notes')) out.notes = text(body.notes, 4000, 'catatan');
    if (has('assignee')) {
      if (body.assignee === null || body.assignee === '') out.assignee_id = null;
      else {
        const u = db.prepare('SELECT id FROM users WHERE username = ? AND disabled = 0').get(String(body.assignee));
        if (!u) throw badRequest('penanggung jawab tidak dikenal');
        out.assignee_id = u.id;
      }
    }
    if (has('dueDate')) {
      if (body.dueDate === null || body.dueDate === '') out.due_date = null;
      else if (!validDate(body.dueDate)) throw badRequest('tenggat harus tanggal yang valid');
      else out.due_date = body.dueDate;
    }
    if (has('priority')) {
      if (!PRIORITY[body.priority]) throw badRequest('prioritas tidak dikenal');
      out.priority = body.priority;
    }
    if (has('status')) {
      if (!STATUS[body.status]) throw badRequest('status tidak dikenal');
      out.status = body.status;
    }
    return out;
  }

  function toTask(t) {
    if (!t) return null;
    const comments = db.prepare("SELECT COUNT(*) AS n FROM task_activity WHERE task_id = ? AND kind = 'comment'").get(t.id).n;
    return {
      id: t.id, title: t.title, notes: t.notes, assignee: person(t.assignee_id), dueDate: t.due_date,
      priority: t.priority, status: t.status, createdBy: person(t.created_by), doneBy: person(t.done_by),
      createdAt: t.created_at, updatedAt: t.updated_at, doneAt: t.done_at, comments
    };
  }

  function activity(taskId) {
    return db.prepare(`SELECT a.*, u.display_name FROM task_activity a LEFT JOIN users u ON u.id = a.user_id
                        WHERE a.task_id = ? ORDER BY a.at, a.id`).all(taskId)
      .map((a) => ({ id: a.id, kind: a.kind, by: a.display_name || 'Pengguna terhapus', body: a.body, at: a.at }));
  }
  const log = (taskId, userId, kind, body, at) =>
    db.prepare('INSERT INTO task_activity (task_id, user_id, kind, body, at) VALUES (?, ?, ?, ?, ?)').run(taskId, userId, kind, body, at);

  function get(id) {
    const t = requireTask(id);
    return { task: toTask(t), activity: activity(t.id) };
  }

  // Open tasks plus what was finished recently. `mine` = assigned to the user.
  function list(user, { mine = false, assignee } = {}) {
    const since = now() - DONE_KEEP_DAYS * 86400000;
    const where = ["(t.status != 'done' OR t.done_at >= ?)"];
    const args = [since];
    if (mine) { where.push('t.assignee_id = ?'); args.push(user.id); }
    else if (assignee === '-') where.push('t.assignee_id IS NULL');
    else if (assignee) {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(String(assignee));
      if (!u) throw badRequest('orang tidak dikenal');
      where.push('t.assignee_id = ?'); args.push(u.id);
    }
    return db.prepare(`SELECT t.* FROM tasks t WHERE ${where.join(' AND ')}
                        ORDER BY t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id`)
      .all(...args).map(toTask);
  }

  // For the sidebar badge: my open tasks that are late or due today (WIB).
  function summary(user) {
    const today = wibToday(now());
    const q = (sql) => db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status != 'done' AND ${sql}`).get(user.id, today).n;
    return { today, overdue: q('due_date < ?'), dueToday: q('due_date = ?') };
  }

  function create(user, body) {
    const v = validate(body, true);
    const t = now();
    // No assignee chosen: it is the creator's own task.
    const assignee = v.assignee_id !== undefined ? v.assignee_id : user.id;
    const status = v.status || 'todo';
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO tasks
      (title, notes, assignee_id, due_date, priority, status, created_by, done_by, created_at, updated_at, done_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      v.title, v.notes || null, assignee, v.due_date || null, v.priority || 'normal', status, user.id,
      status === 'done' ? user.id : null, t, t, status === 'done' ? t : null);
    log(Number(id), user.id, 'created', 'membuat tugas ini', t);
    return get(Number(id));
  }

  function describe(col, val) {
    switch (col) {
      case 'title': return `mengubah judul menjadi "${val}"`;
      case 'notes': return val ? 'mengubah catatan' : 'menghapus catatan';
      case 'assignee_id': { const p = person(val); return p ? `menugaskan ke ${p.name}` : 'mengosongkan penanggung jawab'; }
      case 'due_date': return val ? `mengubah tenggat menjadi ${fmtDate(val)}` : 'menghapus tenggat';
      case 'priority': return `mengubah prioritas menjadi ${PRIORITY[val]}`;
      case 'status': return val === 'done' ? 'menandai selesai' : `mengubah status menjadi ${STATUS[val]}`;
      default: return 'mengubah tugas';
    }
  }

  function update(user, id, body) {
    const cur = requireTask(id);
    const v = validate(body, false);
    const cols = Object.keys(v).filter((c) => v[c] !== cur[c]);
    if (!cols.length) return get(cur.id);
    const t = now();
    const set = cols.map((c) => c + ' = ?');
    const args = cols.map((c) => v[c]);
    if (cols.includes('status')) {
      set.push('done_at = ?', 'done_by = ?');
      args.push(v.status === 'done' ? t : null, v.status === 'done' ? user.id : null);
    }
    db.prepare(`UPDATE tasks SET ${set.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, t, cur.id);
    for (const c of cols) log(cur.id, user.id, 'changed', describe(c, v[c]), t);
    return get(cur.id);
  }

  function comment(user, id, body) {
    const cur = requireTask(id);
    const c = text(body, 2000, 'komentar');
    if (!c) throw badRequest('komentar kosong');
    log(cur.id, user.id, 'comment', c, now());
    return get(cur.id);
  }

  function remove(user, id) {
    const cur = requireTask(id);
    if (cur.created_by !== user.id && user.role !== 'admin') throw httpError(403, 'hanya pembuat tugas atau admin yang bisa menghapus');
    db.prepare('DELETE FROM tasks WHERE id = ?').run(cur.id);
    return { ok: true };
  }

  return { people, list, summary, get, create, update, comment, remove };
}

module.exports = { createTasks, wibToday };
