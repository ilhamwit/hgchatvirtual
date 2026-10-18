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
media="$(mktemp -d)"; log="$(mktemp)"
# Run with an empty environment for auth/gateway so nothing real is reachable.
env -i PATH="$PATH" HOME="$media" CHAT_DEV=1 CHAT_PORT="$port" CHAT_MEDIA_DIR="$media" \
  node server.js >"$log" 2>&1 &
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

check() { # path expected-status must-contain
  local body code
  body="$(mktemp)"
  code=$(curl -sS -o "$body" -w '%{http_code}' "http://127.0.0.1:$port$1")
  if [ "$code" = "$2" ] && grep -q -- "$3" "$body"; then echo "  ok  GET $1 -> $code"
  else echo "  FAIL GET $1 -> $code (want $2 containing '$3')"; rm -f "$body"; exit 1; fi
  rm -f "$body"
}
check /login 200 '<html'
check / 200 '<html'
check /hg-chat-ai-agent.html 200 '<html'

status() { curl -sS --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$1"; }

echo "==> Every local asset referenced by the pages resolves"
refs=$(grep -ohE '(src|href)="/[^"]+"|/assets/[A-Za-z0-9/_.-]+' public/*.html public/*.js 2>/dev/null \
  | sed -E 's/^(src|href)="//; s/"$//' | sort -u)
for r in $refs; do
  code=$(status "$r")
  if [ "$code" = "200" ]; then echo "  ok  $r"; else echo "  FAIL $r -> $code"; exit 1; fi
done
type=$(curl -sS -o /dev/null -w '%{content_type}' "http://127.0.0.1:$port/assets/hg-logo.png")
[ "$type" = "image/png" ] && echo "  ok  png served as image/png" || { echo "  FAIL png content-type: $type"; exit 1; }

echo "==> Only public/ is reachable"
for p in /server.js /.git/config /.agentic/config.yml /docs/epics/README.md /../server.js /%2e%2e/server.js /assets/../../server.js; do
  code=$(status "$p")
  case "$code" in 403|404) echo "  ok  $p -> $code" ;; *) echo "  FAIL $p -> $code (must be 403/404)"; exit 1 ;; esac
done

echo "TEST PASS"
