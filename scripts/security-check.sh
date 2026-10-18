#!/usr/bin/env bash
# Security gate — committed secrets, env files, client-side secrets, dep audit.
# Never prints a secret value: matches are reported by file and variable name.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0; warns=0
FAIL() { echo "  FAIL $*"; fail=1; }
WARN() { echo "  warn $*"; warns=$((warns+1)); }

files() { # tracked + untracked-but-not-ignored, minus binaries we never scan
  git ls-files -co --exclude-standard 2>/dev/null | grep -vE '\.(png|jpe?g|gif|webp|ico|pdf)$' || true
}

echo "==> Env files"
if files | grep -E '(^|/)\.env($|\.)' | grep -vq '\.env\.example$'; then
  FAIL "an .env file is tracked or unignored: $(files | grep -E '(^|/)\.env' | grep -v '\.env\.example' | tr '\n' ' ')"
else echo "  ok  no .env files in the repo"; fi

echo "==> Real secrets from ~/.config/chat-center.env"
envfile="${CHAT_ENV_FILE:-$HOME/.config/chat-center.env}"
if [ -r "$envfile" ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_]+$ ]] || continue
    [ "${#v}" -ge 8 ] || continue          # skip ports and short values
    hits=$(files | while IFS= read -r f; do [ -f "$f" ] && grep -qF -- "$v" "$f" && echo "$f"; done || true)
    [ -n "$hits" ] && FAIL "value of $k appears in: $(echo $hits)"
  done < "$envfile"
  [ "$fail" -eq 0 ] && echo "  ok  no env value found in repo files"
else
  WARN "$envfile not readable — skipped exact-value scan"
fi

echo "==> Secret patterns"
pat='(-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|Bearer [A-Za-z0-9._-]{24,}|OPENCLAW_TOKEN = '"'"'[A-Za-z0-9._-]{16,}'"'"')'
hits=$(files | while IFS= read -r f; do [ -f "$f" ] && grep -lE -- "$pat" "$f"; done | grep -v '^scripts/security-check.sh$' || true)
if [ -n "$hits" ]; then FAIL "secret-like pattern in: $(echo $hits)"; else echo "  ok  no secret-like patterns"; fi

echo "==> Known risks (tracked by epics)"
grep -q "Access-Control-Allow-Origin', '\*'" server.js 2>/dev/null && WARN "server.js sends CORS * (EPIC-001 T-011)"
grep -qE "CORRECT_PIN = '[0-9]+'" hg-chat-ai-agent.html 2>/dev/null && WARN "client-side PIN in hg-chat-ai-agent.html (EPIC-001 T-011)"
grep -q "req.url.startsWith('/v1/')" server.js 2>/dev/null && WARN "open /v1/* gateway proxy (EPIC-002 T-016)"

echo "==> Dependency audit"
if [ -f package-lock.json ]; then
  npm audit --audit-level=high || FAIL "npm audit found high/critical issues"
else echo "  ok  no dependencies (no package-lock.json)"; fi

if [ "$fail" -ne 0 ]; then echo "SECURITY FAIL"; exit 1; fi
echo "SECURITY PASS ($warns warning(s))"
