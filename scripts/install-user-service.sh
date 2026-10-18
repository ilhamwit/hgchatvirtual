#!/usr/bin/env bash
# One-time switch: run chat-center as a user service of this account instead
# of a system service, so `scripts/restart.sh` never needs sudo again.
#
#   bash scripts/install-user-service.sh
#
# Asks for the sudo password once, only to stop and disable the old system
# service. Same folder, env file and port, so Cloudflare needs no change.
# Undo:
#   systemctl --user disable --now chat-center
#   sudo systemctl enable --now chat-center
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n==> %s\n' "$1"; }
UNIT_DIR="$HOME/.config/systemd/user"

if [ "$(id -u)" = 0 ]; then echo "Run this as $(stat -c %U .), not as root."; exit 1; fi
if ! loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null | grep -qx yes; then
  echo "Linger is off for $(id -un): the service would stop at logout."
  echo "Turn it on first:  sudo loginctl enable-linger $(id -un)"
  exit 1
fi
if systemctl --user is-active -q chat-center 2>/dev/null; then
  echo "chat-center already runs as a user service. Nothing to do; use scripts/restart.sh."
  exit 0
fi

step "Gates (qa + test + security)"
if ! npm run -s gates >/tmp/chat-center-gates.log 2>&1; then
  tail -20 /tmp/chat-center-gates.log
  echo "GATES FAILED — nothing changed. Full log: /tmp/chat-center-gates.log"
  exit 1
fi
grep -E "PASS|ℹ pass|ℹ fail" /tmp/chat-center-gates.log | sed 's/^/    /'

step "Install the user unit"
mkdir -p "$UNIT_DIR"
install -m 644 deploy/systemd/chat-center.service "$UNIT_DIR/chat-center.service"
systemctl --user daemon-reload
echo "    $UNIT_DIR/chat-center.service"

step "Stop the system service (sudo, this one time)"
old=$(systemctl show chat-center -p MainPID --value 2>/dev/null || echo 0)
sudo systemctl disable --now chat-center
echo "    system service stopped (was PID ${old:-0})"

step "Start the user service"
if ! systemctl --user enable --now chat-center; then
  echo "User service failed to start — putting the system service back."
  sudo systemctl enable --now chat-center
  exit 1
fi

port=$(sed -n 's/^CHAT_PORT=//p' "$HOME/.config/chat-center.env" | tail -1)
health=""
for _ in $(seq 1 30); do
  health=$(curl -s --max-time 5 "http://127.0.0.1:${port:-8643}/healthz" || true)
  [ -n "$health" ] && break
  sleep 0.5
done
new=$(systemctl --user show chat-center -p MainPID --value)
echo "    PID $new · /healthz: ${health:-no answer}"
echo "    schema v$(sqlite3 -readonly data/chat-center.db 'PRAGMA user_version' 2>/dev/null || echo '?')"

if [[ "$health" != *'"ok":true'* ]]; then
  echo "User service is not healthy — putting the system service back."
  journalctl --user-unit=chat-center -n 15 --no-pager -o cat
  systemctl --user disable --now chat-center || true
  sudo systemctl enable --now chat-center
  exit 1
fi
printf '\nOK — chat-center now runs as a user service. From now on:\n    bash scripts/restart.sh   (no sudo)\n'
