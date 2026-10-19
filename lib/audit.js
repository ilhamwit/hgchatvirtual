// Security audit trail (EPIC-005 T-030): who logged in, who failed, and every
// account change made with scripts/users.js. Never stores passwords, tokens
// or message content.
const KEEP_DAYS = 180;

const EVENTS = new Set([
  'login_ok', 'login_failed', 'login_throttled', 'logout',
  'user_added', 'user_disabled', 'user_enabled', 'password_reset', 'sessions_revoked',
  'wa_pair_started', 'wa_pair_scanned', 'wa_pair_cancelled', 'wa_pair_failed',
  'wa_number_changed', 'wa_apply_failed',
  'event_sent', 'event_cancelled',
  'profile_wa_verified', 'profile_wa_removed',
  'api_key_created', 'api_key_revoked', 'api_event_created', 'api_denied'
]);

function record(db, { event, username = null, ip = null, detail = null, at = Date.now() }) {
  if (!EVENTS.has(event)) throw new Error('unknown audit event: ' + event);
  db.prepare('INSERT INTO audit_log (at, event, username, ip, detail) VALUES (?, ?, ?, ?, ?)')
    .run(at, event, username === null ? null : String(username).slice(0, 64), ip, detail === null ? null : String(detail).slice(0, 200));
}

function recent(db, limit = 50) {
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
}

function purge(db, keepDays = KEEP_DAYS, now = Date.now()) {
  return db.prepare('DELETE FROM audit_log WHERE at < ?').run(now - keepDays * 24 * 60 * 60 * 1000).changes;
}

module.exports = { record, recent, purge, EVENTS, KEEP_DAYS };
