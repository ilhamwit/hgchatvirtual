#!/usr/bin/env bash
# Installs and starts the daily backup timer as a systemd *user* unit, then
# runs one backup right away so a failure shows up now, not at 03:15.
# Undo: systemctl --user disable --now chat-center-backup.timer
set -euo pipefail
cd "$(dirname "$0")/.."
dest="$HOME/.config/systemd/user"
mkdir -p "$dest"
cp deploy/systemd/chat-center-backup.service deploy/systemd/chat-center-backup.timer "$dest/"
systemctl --user daemon-reload
systemctl --user enable --now chat-center-backup.timer
systemctl --user start chat-center-backup.service
systemctl --user status chat-center-backup.service --no-pager -n 3 | tail -3
systemctl --user list-timers chat-center-backup.timer --no-pager
