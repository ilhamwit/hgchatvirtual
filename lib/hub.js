// Live updates for the browser (EPIC-012): one Server-Sent Events stream per
// open tab at /api/stream. publish(event, userIds) sends to those users (null
// = everyone). The hub also knows who is online. Every heartbeat re-checks
// the session, so logging out or an expired session ends the stream.
function createHub({ heartbeatMs = 25000 } = {}) {
  const clients = new Set();     // { res, userId, username, stillValid }
  let lastOnline = '';

  const online = () => [...new Set([...clients].map((c) => c.username))].sort();
  function write(c, event) {
    try { c.res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) { drop(c); }
  }
  function drop(c) {
    if (!clients.delete(c)) return;
    try { c.res.end(); } catch (e) { /* already gone */ }
    presence();
  }
  function presence() {
    const now = online();
    const key = now.join(',');
    if (key === lastOnline) return;
    lastOnline = key;
    for (const c of clients) write(c, { type: 'presence', online: now });
  }

  function attach(req, res, user, stillValid = () => true) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    const c = { res, userId: user.id, username: user.username, stillValid };
    clients.add(c);
    req.on('close', () => drop(c));
    write(c, { type: 'hello', online: online() });
    presence();
  }

  function publish(event, userIds = null) {
    for (const c of clients) if (!userIds || userIds.includes(c.userId)) write(c, event);
  }

  const timer = setInterval(() => {
    for (const c of [...clients]) {
      if (!c.stillValid()) { drop(c); continue; }
      try { c.res.write(': ping\n\n'); } catch (e) { drop(c); }
    }
  }, heartbeatMs);
  timer.unref();

  function close() {
    clearInterval(timer);
    for (const c of [...clients]) { clients.delete(c); try { c.res.end(); } catch (e) { /* gone */ } }
  }

  return { attach, publish, online, close, get size() { return clients.size; } };
}

module.exports = { createHub };
