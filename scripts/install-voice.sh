#!/usr/bin/env bash
# One-time: bring up the voice engine for Chat Center (EPIC-016) — its own
# LiveKit server + a voice worker whose brain is Hermes — and wire Chat Center
# to it. Safe to re-run (keys are kept).
#
#   bash scripts/install-voice.sh
#
# Afterwards (you, once):
#   1. Cloudflare Zero Trust → Tunnels → public hostname
#        voice.herrygunawan.com  →  http://localhost:7890
#   2. Router: forward to this server  TCP 7891, UDP 7892, UDP 62000–62300
#   3. bash scripts/restart.sh
# Undo: docker compose -f deploy/voice/docker-compose.yml down
set -euo pipefail
cd "$(dirname "$0")/.."
VOICE=deploy/voice
ENVF="$HOME/.config/chat-center.env"
step() { printf '\n==> %s\n' "$1"; }
rand() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }
getv() { { sed -n "s/^$1=//p" "$2" 2>/dev/null || true; } | tail -1; }

command -v docker >/dev/null || { echo "docker tidak ditemukan"; exit 1; }
[ -d "$HOME/aurix-kit/voices" ] || { echo "~/aurix-kit/voices tidak ada (dibutuhkan untuk suara)"; exit 1; }
docker image inspect ghcr.io/zakie0161/realtime-voice-assistant:latest >/dev/null 2>&1 || { echo "image Reddie belum ada di mesin ini"; exit 1; }

step "Keys"
KEY=$(getv LIVEKIT_API_KEY "$VOICE/.env"); SECRET=$(getv LIVEKIT_API_SECRET "$VOICE/.env"); VKEY=$(getv CHAT_CENTER_VOICE_KEY "$VOICE/.env")
[ -n "$KEY" ] || KEY="APIcc$(node -e "console.log(require('crypto').randomBytes(8).toString('hex').slice(0,10))")"
[ -n "$SECRET" ] || SECRET=$(rand 32)
[ -n "$VKEY" ] || VKEY="cc_voice_$(rand 24)"
HKEY=$(getv HERMES_API_KEY "$ENVF")
[ -n "$HKEY" ] || { echo "HERMES_API_KEY tidak ada di $ENVF"; exit 1; }
( umask 077
  sed -e "s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=$KEY|" -e "s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=$SECRET|" \
      -e "s|^HERMES_API_KEY=.*|HERMES_API_KEY=$HKEY|" -e "s|^CHAT_CENTER_VOICE_KEY=.*|CHAT_CENTER_VOICE_KEY=$VKEY|" "$VOICE/.env.example" > "$VOICE/.env"
  sed -e "s|__KEY__|$KEY|" -e "s|__SECRET__|$SECRET|" "$VOICE/livekit.yaml.example" > "$VOICE/livekit.yaml" )
echo "    $VOICE/.env, $VOICE/livekit.yaml (mode 600)"

step "Chat Center env ($ENVF)"
touch "$ENVF"
for kv in "CHAT_VOICE_LIVEKIT_URL=wss://voice.herrygunawan.com" "CHAT_VOICE_LIVEKIT_HTTP=http://127.0.0.1:7890" "CHAT_VOICE_LIVEKIT_KEY=$KEY" "CHAT_VOICE_LIVEKIT_SECRET=$SECRET" "CHAT_VOICE_WORKER_KEY=$VKEY"; do
  k=${kv%%=*}
  if grep -q "^$k=" "$ENVF"; then [ "$k" = CHAT_VOICE_LIVEKIT_URL ] || sed -i "s|^$k=.*|$kv|" "$ENVF"; else echo "$kv" >> "$ENVF"; fi
done
echo "    CHAT_VOICE_* ditulis (URL publik tetap bila sudah ada)"

step "Start LiveKit + voice worker (docker compose)"
docker compose -f "$VOICE/docker-compose.yml" up -d
sleep 3
docker compose -f "$VOICE/docker-compose.yml" ps --format 'table {{.Name}}\t{{.Status}}'
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7890/ || true)
echo "    LiveKit lokal: HTTP $code (200 = ok)"

cat <<MSG

OK — mesin suara berjalan. Sisanya (sekali, oleh Anda):
  1. Cloudflare Zero Trust → Tunnels → public hostname:
       voice.herrygunawan.com  →  http://localhost:7890
  2. Router: port forward ke server ini  TCP 7891 · UDP 7892 · UDP 62000–62300
  3. bash scripts/restart.sh
Lalu buka chat agent di web → tombol 🎙️. Log worker: docker logs -f chat-center-voice
MSG
