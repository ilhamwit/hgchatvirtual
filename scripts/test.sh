#!/usr/bin/env bash
# Test gate — unit tests (when they exist) + a boot smoke test.
# The smoke test starts server.js on a throwaway port with a temp media dir and
# no gateway, so it never touches the live chat-center.service on :8643.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Unit tests"
if [ -f package.json ] && node -e 'process.exit(require("./package.json").scripts?.test ? 0 : 1)'; then
  npm test
elif compgen -G "test/*.test.js" >/dev/null || compgen -G "test/*.test.mjs" >/dev/null; then
  node --test test/
else
  echo "  (no tests yet — EPIC-000 adds the first ones)"
fi

echo "==> Boot smoke"
port=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
media="$(mktemp -d)"; log="$(mktemp)"; jar="$media/cookies"
db="$media/smoke.db"
# A throwaway account in a throwaway database; the password never leaves this run.
pw="smoke-$(node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))')"
printf '%s\n' "$pw" | CHAT_DB_PATH="$db" node scripts/users.js add smoke >/dev/null
# Production mode with a fake gateway token, so nothing real is reachable.
env -i PATH="$PATH" HOME="$media" HERMES_API_KEY=smoke-not-a-key CHAT_DB_PATH="$db" \
  CHAT_PORT="$port" CHAT_MEDIA_DIR="$media" node server.js >"$log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; rm -rf "$media" "$log"' EXIT

up=0
for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/login" 2>/dev/null; then up=1; break; fi
  kill -0 $pid 2>/dev/null || break
  sleep 0.1
done
if [ "$up" -ne 1 ]; then echo "  FAIL server did not come up on :$port"; sed 's/^/       /' "$log"; exit 1; fi
echo "  ok  server listening on :$port"

code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")
[ "$code" = "302" ] && echo "  ok  GET / without login -> 302" || { echo "  FAIL GET / without login -> $code (want 302)"; exit 1; }
code=$(curl -sS -c "$jar" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  --data "{\"username\":\"smoke\",\"password\":\"$pw\"}" "http://127.0.0.1:$port/login")
[ "$code" = "200" ] && echo "  ok  POST /login -> 200" || { echo "  FAIL POST /login -> $code"; exit 1; }

check() { # path expected-status must-contain
  local body code
  body="$(mktemp)"
  code=$(curl -sS -b "$jar" -o "$body" -w '%{http_code}' "http://127.0.0.1:$port$1")
  if [ "$code" = "$2" ] && grep -q -- "$3" "$body"; then echo "  ok  GET $1 -> $code"
  else echo "  FAIL GET $1 -> $code (want $2 containing '$3')"; rm -f "$body"; exit 1; fi
  rm -f "$body"
}
check / 200 '<html'
check /hg-chat-ai-agent.html 200 '<html'
check /api/me 200 '"username":"smoke"'
check /api/agents 200 '"dave"'
check /api/conversations 200 '"conversations"'
check /v1/models 404 'Not found'

status() { curl -sS -b "$jar" --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$1"; }

echo "==> Every local asset referenced by the pages resolves"
refs=$(grep -ohE '(src|href)="/[^"]+"|/assets/[A-Za-z0-9/_.-]+' public/*.html public/*.js 2>/dev/null \
  | sed -E 's/^(src|href)="//; s/"$//' | sort -u)
for r in $refs; do
  code=$(status "$r")
  if [ "$code" = "200" ]; then echo "  ok  $r"; else echo "  FAIL $r -> $code"; exit 1; fi
done
type=$(curl -sS -b "$jar" -o /dev/null -w '%{content_type}' "http://127.0.0.1:$port/assets/hg-logo.png")
[ "$type" = "image/png" ] && echo "  ok  png served as image/png" || { echo "  FAIL png content-type: $type"; exit 1; }

echo "==> Only public/ is reachable"
for p in /server.js /.git/config /.agentic/config.yml /docs/epics/README.md /../server.js /%2e%2e/server.js /assets/../../server.js; do
  code=$(status "$p")
  case "$code" in 403|404) echo "  ok  $p -> $code" ;; *) echo "  FAIL $p -> $code (must be 403/404)"; exit 1 ;; esac
done

echo "TEST PASS"
