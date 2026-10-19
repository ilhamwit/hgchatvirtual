#!/usr/bin/env bash
# Worker logic checks, run inside the voice container (it has livekit-agents).
#   bash deploy/voice/checks/run.sh      (from the Chat Center folder)
set -euo pipefail
cd "$(dirname "$0")/.."
# Only the worker and the checks (never .env / livekit.yaml with keys).
docker exec chat-center-voice sh -c 'rm -rf /tmp/voicecheck && mkdir -p /tmp/voicecheck'
docker cp app.py chat-center-voice:/tmp/voicecheck/app.py
docker cp checks chat-center-voice:/tmp/voicecheck/checks
for c in check_voice check_tts; do
  docker exec -w /app chat-center-voice timeout 120 python3 "/tmp/voicecheck/checks/$c.py" 2>&1 | grep -v -i -E 'warn|deprecat'
done
