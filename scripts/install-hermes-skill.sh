#!/usr/bin/env bash
# One-time: give the WhatsApp agent (Hermes default profile, bot "Aurix") the
# Chat Center skill and its API key (EPIC-013).
#
#   bash scripts/install-hermes-skill.sh
#
# Make the key first: agents.herrygunawan.com → Profil & notifikasi →
# Integrasi API → "Buat API key" (izin: buat acara + lihat jadwal). The key is
# checked against Chat Center, then stored in ~/.config/chat-center-agent.key
# (mode 600). No restart of Hermes is needed for a new skill; if the agent
# does not pick it up, restart it with: systemctl --user restart hermes-gateway
# Undo: rm -r ~/.hermes/skills/productivity/chat-center ~/.config/chat-center-agent.key
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${HERMES_HOME:-$HOME/.hermes}/skills/productivity/chat-center"
KEYFILE="$HOME/.config/chat-center-agent.key"
PORT=$(sed -n 's/^CHAT_PORT=//p' "$HOME/.config/chat-center.env" 2>/dev/null | tail -1)
URL="http://127.0.0.1:${PORT:-8643}"

read -rsp "Tempel API key Chat Center (cc_…): " KEY; echo
if [[ ! "$KEY" =~ ^cc_[A-Za-z0-9_-]{20,}$ ]]; then echo "Itu bukan API key Chat Center."; exit 1; fi
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$URL/api/v1/events?days=1")
if [ "$code" != 200 ]; then echo "Key ditolak Chat Center (HTTP $code). Pastikan izinnya mencakup 'lihat jadwal'."; exit 1; fi

mkdir -p "$(dirname "$KEYFILE")"
( umask 077; printf '%s\n' "$KEY" > "$KEYFILE" )
chmod 600 "$KEYFILE"
mkdir -p "$DEST"
cp -r deploy/hermes/skills/chat-center/. "$DEST/"
chmod +x "$DEST/scripts/chat_center.py"

echo "OK — skill terpasang di $DEST"
echo "     key tersimpan di $KEYFILE (hanya bisa dibaca akun ini)"
echo "Uji: python3 $DEST/scripts/chat_center.py list --days 7"
