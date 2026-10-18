#!/usr/bin/env bash
# Restart production Chat Center and prove the new code is running.
#
#   bash scripts/restart.sh
#
# Runs the gates first (a failing gate stops here, nothing restarted), then
# restarts the service, then checks that the process really changed, /healthz
# answers, and prints the database schema version.
#
# Since scripts/install-user-service.sh, chat-center is a user service and
# this needs no sudo. Before that switch it is a system service and the
# restart asks for the sudo password.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n==> %s\n' "$1"; }

step "Gates (qa + test + security)"
if ! npm run -s gates >/tmp/chat-center-gates.log 2>&1; then
  tail -20 /tmp/chat-center-gates.log
  echo "GATES FAILED — not restarting. Full log: /tmp/chat-center-gates.log"
  exit 1
fi
grep -E "PASS|ℹ pass|ℹ fail" /tmp/chat-center-gates.log | sed 's/^/    /'

if systemctl --user is-enabled -q chat-center 2>/dev/null; then
  SC=(systemctl --user); LOGS=(journalctl --user-unit=chat-center); HOW="user service, no sudo"
else
  SC=(systemctl); LOGS=(journalctl -u chat-center); HOW="system service — sudo may ask for your password"
fi

old=$("${SC[@]}" show chat-center -p MainPID --value)
step "Restart (old PID $old; $HOW)"
if [ "${SC[*]}" = "systemctl --user" ]; then systemctl --user restart chat-center; else sudo systemctl restart chat-center; fi

new=""
for _ in $(seq 1 50); do
  new=$("${SC[@]}" show chat-center -p MainPID --value)
  [ -n "$new" ] && [ "$new" != "0" ] && [ "$new" != "$old" ] && break
  sleep 0.2
done
if [ -z "$new" ] || [ "$new" = "0" ] || [ "$new" = "$old" ]; then
  echo "RESTART FAILED — PID is still '$new'. Last log lines:"
  "${LOGS[@]}" -n 15 --no-pager -o cat
  exit 1
fi
echo "    new PID $new"

step "Health check"
health=""
for _ in $(seq 1 30); do
  health=$(curl -s --max-time 5 http://127.0.0.1:8643/healthz || true)
  [ -n "$health" ] && break
  sleep 0.5
done
echo "    /healthz: ${health:-no answer}"
echo "    schema v$(sqlite3 -readonly data/chat-center.db 'PRAGMA user_version' 2>/dev/null || echo '?')"
"${LOGS[@]}" -n 1 --no-pager -o cat | sed 's/^/    /'

if [[ "$health" == *'"ok":true'* ]]; then
  printf '\nOK — chat-center restarted (PID %s → %s) and healthy.\n' "$old" "$new"
else
  printf '\nWARNING — restarted (PID %s → %s) but /healthz is not ok. See: %s -n 30\n' "$old" "$new" "${LOGS[*]}"
  exit 2
fi
