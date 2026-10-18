#!/usr/bin/env bash
# Loop readiness gate. It validates the native Agentic Workflow Kit loop
# contract without network access or side effects. Exit 0 means the configured
# level is ready; disabled loops also exit 0 because no automation is active.
set -u -o pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || { cd "$(dirname "$0")/.." && pwd; })"
cd "$ROOT" || exit 2

if [ ! -f scripts/_agentic_lib.sh ]; then
  printf '[FAIL] scripts/_agentic_lib.sh is required for manifest parsing\n' >&2
  exit 2
fi
# shellcheck source=_agentic_lib.sh
. scripts/_agentic_lib.sh

PASS_N=0
WARN_N=0
FAIL_N=0
pass() { printf '[PASS] %s\n' "$1"; PASS_N=$((PASS_N + 1)); }
warn() { printf '[WARN] %s\n' "$1"; WARN_N=$((WARN_N + 1)); }
fail() { printf '[FAIL] %s\n' "$1" >&2; FAIL_N=$((FAIL_N + 1)); }
value() { manifest_get "loop.$1"; }
require_file() {
  local label="$1" path="$2"
  if [ -n "$path" ] && [ -f "$path" ]; then pass "$label: $path"; else fail "$label missing: ${path:-unset}"; fi
}
require_positive_int() {
  local label="$1" raw="$2"
  if [[ "$raw" =~ ^[1-9][0-9]*$ ]]; then pass "$label: $raw"; else fail "$label must be a positive integer (got ${raw:-unset})"; fi
}

if [ ! -f .agentic/config.yml ]; then
  fail '.agentic/config.yml is missing'
  exit 1
fi

enabled="$(value enabled)"
case "$enabled" in
  false|False|FALSE|0|'')
    pass 'loop is disabled; no automation is active'
    exit 0
    ;;
  true|True|TRUE|1) pass 'loop is enabled' ;;
  *) fail "loop.enabled must be true or false (got $enabled)" ;;
esac

pattern="$(value pattern)"
level="$(value level)"
mode="$(value mode)"
cadence="$(value cadence)"
state_file="$(value state_file)"
run_log="$(value run_log)"
ledger="$(value ledger)"
constraints_file="$(value constraints_file)"
kill_switch="$(value kill_switch)"
attempts="$(value max_attempts_per_item)"
runs_per_day="$(value max_runs_per_day)"
token_budget="$(value token_budget_per_day)"
subagents="$(value max_subagents_per_run)"
worktree_required="$(value worktree_required)"
verifier_required="$(value verifier_required)"
human_gate="$(value human_gate)"

case "$pattern" in
  daily-triage|issue-triage|ci-sweeper|dependency-sweeper|changelog-drafter|post-merge-cleanup|pr-babysitter) pass "known pattern: $pattern" ;;
  *) fail "unknown loop.pattern: ${pattern:-unset}" ;;
esac
case "$cadence" in
  ''|manual) warn 'cadence is manual; a scheduler has not been approved' ;;
  *) pass "cadence documented: $cadence" ;;
esac

require_file 'constraints' "$constraints_file"
require_file 'state file' "$state_file"
require_file 'run log' "$run_log"
if [ -n "$ledger" ]; then pass "local ledger path: $ledger"; else fail 'loop.ledger is unset'; fi
require_positive_int 'max_attempts_per_item' "$attempts"
require_positive_int 'max_runs_per_day' "$runs_per_day"
require_positive_int 'token_budget_per_day' "$token_budget"

if [ "$attempts" -gt 3 ] 2>/dev/null; then fail 'max_attempts_per_item must not exceed 3'; fi
if [ "$human_gate" = required ]; then pass 'human gate is required'; else fail 'human_gate must be required'; fi
if [ -n "$kill_switch" ] && [ -e "$kill_switch" ]; then fail "kill switch is active: $kill_switch"; else pass "kill switch path is clear: ${kill_switch:-unset}"; fi
if [ -x scripts/loop-ledger.sh ]; then pass 'ledger helper is executable'; else fail 'scripts/loop-ledger.sh must be executable'; fi

case "$level:$mode" in
  L1:report-only)
    pass 'L1 report-only policy is valid'
    if [ "$subagents" = 0 ]; then pass 'L1 has no sub-agent spawns'; else fail 'L1 must set max_subagents_per_run: 0'; fi
    ;;
  L2:assisted)
    pass 'L2 assisted policy is valid'
    if [ "$worktree_required" = true ]; then pass 'L2 requires isolated worktrees'; else fail 'L2 must set worktree_required: true'; fi
    if [ "$verifier_required" = true ]; then pass 'L2 requires a separate verifier'; else fail 'L2 must set verifier_required: true'; fi
    if [ -x scripts/loop-worktree.sh ]; then pass 'worktree helper is executable'; else fail 'scripts/loop-worktree.sh must be executable for L2'; fi
    ;;
  L3:*) fail 'L3 unattended mutation is not certified by this kit';;
  *) fail "invalid level/mode pair: ${level:-unset}/${mode:-unset}" ;;
esac

printf '\n%d PASS · %d WARN · %d FAIL\n' "$PASS_N" "$WARN_N" "$FAIL_N"
[ "$FAIL_N" -eq 0 ]
