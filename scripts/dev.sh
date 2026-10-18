#!/usr/bin/env bash
# Local dev instance, side by side with production (chat-center.service on
# :8643, which serves this same folder). Dev gets its own port, media dir and
# database under data/dev/ (gitignored), and restarts on file changes.
#
#   npm run dev:users -- add me  # create a dev account (once)
#   npm run dev                  # no gateway (UI work)
#   npm run dev -- --gateway     # also talk to the real Hermes agents
set -euo pipefail
cd "$(dirname "$0")/.."

export CHAT_DEV=1
export CHAT_PORT="${CHAT_PORT:-8650}"
if [ "$CHAT_PORT" = "8643" ]; then
  echo "Port 8643 belongs to production (chat-center.service). Pick another CHAT_PORT." >&2
  exit 1
fi
export CHAT_MEDIA_DIR="${CHAT_MEDIA_DIR:-$PWD/data/dev/media}"
export CHAT_DB_PATH="${CHAT_DB_PATH:-$PWD/data/dev/chat-center.db}"
mkdir -p "$CHAT_MEDIA_DIR" "$(dirname "$CHAT_DB_PATH")"

# `npm run dev:users -- add me` manages accounts in the dev database.
if [ "${1:-}" = "users" ]; then
  shift
  exec node scripts/users.js "$@"
fi

if [ "${1:-}" = "--gateway" ]; then
  envfile="${CHAT_ENV_FILE:-$HOME/.config/chat-center.env}"
  # Read only the Hermes key, without echoing it. Dev chats create real
  # Hermes sessions, so the agents will remember them.
  HERMES_API_KEY="$(grep -m1 '^HERMES_API_KEY=' "$envfile" | cut -d= -f2-)" || true
  [ -n "${HERMES_API_KEY:-}" ] || { echo "No HERMES_API_KEY in $envfile" >&2; exit 1; }
  export HERMES_API_KEY
fi

echo "Dev: http://127.0.0.1:$CHAT_PORT  (data: data/dev/)"
exec node --watch server.js
