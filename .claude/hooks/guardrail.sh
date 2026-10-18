#!/usr/bin/env bash
# =============================================================================
# guardrail.sh — PreToolUse guardrail for Bash (generic port)
# -----------------------------------------------------------------------------
# What: reads the Bash tool-call JSON on stdin and BLOCKS dangerous commands
#       (exit 2 = block + feed the reason back to the model). Generic port of
#       the WealthMe guardrail: the only project-specific bit — the override env
#       var name — is now read from the manifest (`guardrail.override_env`,
#       default AGENTIC_OVERRIDE) so the same hook works in every repo.
# Why:  enforces the kit's hard guardrails (no force-push, no production deploy,
#       no destructive DB, no rm -rf of important dirs, no CI deploy-target edits)
#       at the tool boundary, before the command ever runs.
#
# Escape hatch: prefix the command with `<OVERRIDE_ENV>=1` for an explicit,
# reviewed exception (e.g. `AGENTIC_OVERRIDE=1 git push --force`).
#
# Contract: this hook is allowed to BLOCK (exit 2) — that is its job. It still
#   degrades safely: if it cannot read the manifest it falls back to the default
#   override name; if there is no command it exits 0.
#
# MANUAL: there is no manual equivalent — this is a safety gate. To bypass once,
#   prefix the command with the override var (default `AGENTIC_OVERRIDE=1`).
# =============================================================================
set -euo pipefail
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# --- Resolve the override env var name from the manifest (default fallback) ---
# Kept dependency-free: a tiny inline reader so the guardrail never needs the
# shared lib to be present. Defaults to AGENTIC_OVERRIDE when absent.
OVERRIDE_ENV="AGENTIC_OVERRIDE"
_find_manifest() {
  local dir; dir="$(pwd)"
  while [ "$dir" != "/" ]; do
    [ -f "$dir/.agentic/config.yml" ] && { printf '%s' "$dir/.agentic/config.yml"; return; }
    dir="$(dirname "$dir")"
  done
}
MANIFEST="$(_find_manifest || true)"
if [ -n "${MANIFEST:-}" ]; then
  _ov="$(awk '
    /^guardrail:/ {inblk=1; next}
    inblk && /^[^[:space:]]/ {inblk=0}
    inblk && /^[[:space:]]+override_env:/ {sub("^[[:space:]]+override_env:[[:space:]]*",""); print; exit}
  ' "$MANIFEST" 2>/dev/null | sed -E 's/[[:space:]]+#.*$//; s/^["'"'"']//; s/["'"'"']$//; s/[[:space:]]+$//')"
  [ -n "$_ov" ] && OVERRIDE_ENV="$_ov"
fi

# Bypass for an explicit, reviewed action: prefix with <OVERRIDE_ENV>=1.
case "$cmd" in *"${OVERRIDE_ENV}=1"*) exit 0;; esac

block() {
  echo "GUARDRAIL BLOCKED: $1" >&2
  echo "If intentional and reviewed, re-run prefixed with ${OVERRIDE_ENV}=1" >&2
  exit 2
}

# force push
printf '%s' "$cmd" | grep -Eiq 'git[[:space:]]+push[[:space:]].*(--force([^-]|$)|-f([[:space:]]|$)|--force-with-lease)' && block "force push is not allowed"
# production deploy
printf '%s' "$cmd" | grep -Eiq '(--prod\b|--production\b|deploy[-_]?prod|NODE_ENV=production[[:space:]]+.*(deploy|publish))' && block "production deploy is not allowed (DEV only)"
# destructive database (DROP / TRUNCATE / prisma migrate reset)
printf '%s' "$cmd" | grep -Eiq '(DROP[[:space:]]+(DATABASE|SCHEMA|TABLE)|TRUNCATE[[:space:]]+TABLE|prisma[[:space:]]+migrate[[:space:]]+reset[[:space:]]+--force)' && block "destructive database command"
# DELETE without a WHERE clause (matches `DELETE FROM <t>` not followed by WHERE)
printf '%s' "$cmd" | grep -Eiq 'DELETE[[:space:]]+FROM[[:space:]]+[^;]*' \
  && ! printf '%s' "$cmd" | grep -Eiq 'DELETE[[:space:]]+FROM[[:space:]]+[^;]*[[:space:]]+WHERE[[:space:]]' \
  && block "DELETE without a WHERE clause"
# recursive force-remove of dangerous paths
printf '%s' "$cmd" | grep -Eiq 'rm[[:space:]]+-[a-zA-Z]*[rf][a-zA-Z]*[[:space:]]+(/|~|\$HOME|\.\.|\*)([[:space:]]|$)' && block "recursive force-remove of a dangerous path"
# CI/CD deploy-target edits
printf '%s' "$cmd" | grep -Eiq '(sed|tee|>).*\.github/workflows/.*deploy' && block "modifying CI/CD deploy target requires review"

exit 0
