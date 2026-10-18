#!/usr/bin/env bash
# Local, dependency-free counters for an enabled loop. The durable historical
# record is docs/LOOP-RUN-LOG.md; this TSV ledger makes the per-item retry cap
# and daily token budget mechanically checkable between runs.
set -euo pipefail

usage() {
  printf 'Usage: %s preflight <item-id> | record <run-id> <item-id> <tokens> <outcome> | attempts <item-id>\n' "$0"
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || { cd "$(dirname "$0")/.." && pwd; })"
cd "$ROOT"
[ -f scripts/_agentic_lib.sh ] || { printf 'scripts/_agentic_lib.sh is required.\n' >&2; exit 2; }
# shellcheck source=_agentic_lib.sh
. scripts/_agentic_lib.sh

ledger="$(manifest_get loop.ledger)"
ledger="${ledger:-.agentic/loop-ledger.tsv}"
run_log="$(manifest_get loop.run_log)"
run_log="${run_log:-docs/LOOP-RUN-LOG.md}"
kill_switch="$(manifest_get loop.kill_switch)"
max_attempts="$(manifest_get loop.max_attempts_per_item)"
max_attempts="${max_attempts:-3}"
daily_budget="$(manifest_get loop.token_budget_per_day)"
daily_budget="${daily_budget:-0}"
today="$(date -u +%F)"

attempt_count() {
  local item_id="$1"
  [ -f "$ledger" ] || { printf '0'; return; }
  awk -F '\t' -v day="$today" -v item="$item_id" '$1 ~ "^" day && $3 == item { count++ } END { print count + 0 }' "$ledger"
}

today_tokens() {
  [ -f "$run_log" ] || { printf '0'; return; }
  { grep "$today" "$run_log" 2>/dev/null || true; } | sed -nE 's/.*"tokens_estimate"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' | awk '{ total += $1 } END { print total + 0 }'
}

command="${1:-}"
case "$command" in
  preflight)
    item_id="${2:-}"
    [ -n "$item_id" ] || { usage >&2; exit 2; }
    [ "$(manifest_get loop.enabled)" = true ] || { printf 'DISABLED\n'; exit 0; }
    if [ -n "$kill_switch" ] && [ -e "$kill_switch" ]; then printf 'PAUSED kill-switch=%s\n' "$kill_switch"; exit 3; fi
    attempts="$(attempt_count "$item_id")"
    [ "$attempts" -lt "$max_attempts" ] || { printf 'BLOCKED attempts=%s limit=%s item=%s\n' "$attempts" "$max_attempts" "$item_id"; exit 4; }
    used="$(today_tokens)"
    [ "$used" -lt "$daily_budget" ] || { printf 'BUDGET-EXHAUSTED used=%s cap=%s\n' "$used" "$daily_budget"; exit 5; }
    threshold=$((daily_budget * 80 / 100))
    if [ "$used" -ge "$threshold" ]; then printf 'REPORT-ONLY used=%s cap=%s attempts=%s\n' "$used" "$daily_budget" "$attempts"; else printf 'READY used=%s cap=%s attempts=%s\n' "$used" "$daily_budget" "$attempts"; fi
    ;;
  record)
    run_id="${2:-}"
    item_id="${3:-}"
    tokens="${4:-}"
    outcome="${5:-}"
    [ -n "$run_id" ] && [ -n "$item_id" ] && [[ "$tokens" =~ ^[0-9]+$ ]] && [ -n "$outcome" ] || { usage >&2; exit 2; }
    mkdir -p "$(dirname "$ledger")"
    printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$run_id" "$item_id" "$tokens" "$outcome" >> "$ledger"
    printf 'RECORDED %s\n' "$ledger"
    ;;
  attempts)
    item_id="${2:-}"
    [ -n "$item_id" ] || { usage >&2; exit 2; }
    attempt_count "$item_id"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
