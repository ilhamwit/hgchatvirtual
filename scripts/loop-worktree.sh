#!/usr/bin/env bash
# Create or remove an isolated local worktree for an L2 loop attempt. This tool
# never pushes or opens a PR. `remove` refuses modified worktrees unless the
# caller explicitly supplies --force.
set -euo pipefail

usage() {
  printf 'Usage: %s create <run-id> [base-ref] | list | remove <path> [--force] | prune\n' "$0"
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || { printf 'Run inside a git repository.\n' >&2; exit 2; }
cd "$ROOT"

repo_name="$(basename "$ROOT")"
WORKTREE_ROOT="${AGENTIC_LOOP_WORKTREE_ROOT:-$(dirname "$ROOT")/${repo_name}-loop-worktrees}"
command="${1:-}"

case "$command" in
  create)
    run_id="${2:-}"
    base_ref="${3:-}"
    [[ "$run_id" =~ ^[A-Za-z0-9._-]+$ ]] || { printf 'run-id must contain only A-Z, a-z, 0-9, ., _, or -\n' >&2; exit 2; }
    if [ -z "$base_ref" ]; then
      base_ref="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
      base_ref="${base_ref:-$(git rev-parse --abbrev-ref HEAD)}"
    fi
    path="$WORKTREE_ROOT/$run_id"
    branch="agentic-loop/$run_id"
    [ ! -e "$path" ] || { printf 'Worktree path already exists: %s\n' "$path" >&2; exit 1; }
    git show-ref --verify --quiet "refs/heads/$branch" && { printf 'Worktree branch already exists: %s\n' "$branch" >&2; exit 1; }
    mkdir -p "$WORKTREE_ROOT"
    git worktree add -b "$branch" "$path" "$base_ref" >&2
    printf '%s\n' "$path"
    ;;
  list)
    git worktree list
    ;;
  remove)
    path="${2:-}"
    force="${3:-}"
    [ -n "$path" ] || { usage >&2; exit 2; }
    case "$path" in "$WORKTREE_ROOT"/*) ;; *) printf 'Refusing to remove a path outside %s\n' "$WORKTREE_ROOT" >&2; exit 2;; esac
    if [ "$force" = --force ]; then git worktree remove --force "$path"; else git worktree remove "$path"; fi
    ;;
  prune)
    git worktree prune
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
