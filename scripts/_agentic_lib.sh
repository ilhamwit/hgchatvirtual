#!/usr/bin/env bash
# Shared, dependency-free helpers for the generic gate scripts. Reads scalar/list
# keys from .agentic/config.yml via grep/sed (no yq required) and provides
# auto-detect fallbacks. Each helper returns: manifest value → else auto-detect →
# else a sane default. Source this from qa.sh / test.sh / security-check.sh / deploy-dev.sh.
#
# Intentionally NOT a full YAML parser: it handles the flat `key: value` and
# simple nested (two-space) shape the kit's manifest uses. Good enough for the
# handful of keys the gates read; richer config belongs in code, not bash.

# Resolve the manifest path (repo-root .agentic/config.yml). Empty if absent.
AGENTIC_MANIFEST="${AGENTIC_MANIFEST:-}"
_agentic_find_manifest() {
  [ -n "$AGENTIC_MANIFEST" ] && { printf '%s' "$AGENTIC_MANIFEST"; return; }
  local dir; dir="$(pwd)"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/.agentic/config.yml" ]; then printf '%s' "$dir/.agentic/config.yml"; return; fi
    dir="$(dirname "$dir")"
  done
  printf '%s' ""
}

# manifest_get <dotted.key> — read a scalar. Supports one nesting level
# (e.g. "branches.integration", "deploy.health_url", "memory.namespace").
# Strips surrounding quotes and inline comments. Empty string if not found.
manifest_get() {
  local key="$1" file; file="$(_agentic_find_manifest)"
  [ -z "$file" ] && { printf '%s' ""; return; }
  local parent child
  if printf '%s' "$key" | grep -q '\.'; then
    parent="${key%%.*}"; child="${key#*.}"
    # Find the parent block, then the child within its indented region.
    awk -v p="$parent" -v c="$child" '
      $0 ~ "^"p":" {inblk=1; next}
      inblk && /^[^[:space:]]/ {inblk=0}
      inblk && $0 ~ "^[[:space:]]+"c":" {sub("^[[:space:]]+"c":[[:space:]]*",""); print; exit}
    ' "$file" | _agentic_clean
  else
    grep -E "^${key}:" "$file" 2>/dev/null | head -n1 | sed -E "s/^${key}:[[:space:]]*//" | _agentic_clean
  fi
}

# Strip inline comments (only when the value isn't quoted), surrounding quotes,
# and trailing whitespace.
_agentic_clean() {
  sed -E 's/[[:space:]]+#.*$//; s/^["'"'"']//; s/["'"'"']$//; s/[[:space:]]+$//'
}

# manifest_list <key> — read a list, emitting one item per line. Handles both an
# inline flow array "[a, b, c]" AND a multiline flow array (what `prettier` rewrites
# long inline arrays to: the key line ends with ":" and the "[ ... ]" spans the
# following lines). Empty output if not found / empty list.
manifest_list() {
  local key="$1" raw; raw="$(manifest_get "$key")"
  if [ -z "$raw" ]; then
    # Value may be a multiline flow array starting on the line(s) after "key:".
    local file leaf; file="$(_agentic_find_manifest)"; leaf="${key##*.}"
    [ -z "$file" ] && return
    raw="$(awk -v k="$leaf" '
      $0 ~ "(^|[[:space:]])" k ":[[:space:]]*$" {grab=1; next}
      grab { buf = buf " " $0; if ($0 ~ /\]/) {print buf; exit} }
    ' "$file" 2>/dev/null)"
  fi
  [ -z "$raw" ] && return
  raw="${raw#*[}"; raw="${raw%%]*}"          # keep only what's between the brackets
  printf '%s' "$raw" | tr ',' '\n' | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$'
}

# detect_pm — package manager: manifest → lockfile → packageManager field → npm.
detect_pm() {
  local v; v="$(manifest_get package_manager)"; [ -n "$v" ] && { printf '%s' "$v"; return; }
  if [ -f pnpm-lock.yaml ]; then printf 'pnpm'; return; fi
  if [ -f yarn.lock ]; then printf 'yarn'; return; fi
  if [ -f bun.lockb ] || [ -f bun.lock ]; then printf 'bun'; return; fi
  if [ -f package-lock.json ]; then printf 'npm'; return; fi
  if [ -f package.json ] && grep -q '"packageManager"' package.json 2>/dev/null; then
    grep '"packageManager"' package.json | sed -E 's/.*"packageManager":[[:space:]]*"([a-z]+)@.*/\1/'; return
  fi
  printf 'npm'
}

# detect_monorepo_tool — manifest → marker files → none.
detect_monorepo_tool() {
  local v; v="$(manifest_get monorepo.tool)"; [ -n "$v" ] && { printf '%s' "$v"; return; }
  if [ -f turbo.json ]; then printf 'turbo'; return; fi
  if [ -f nx.json ]; then printf 'nx'; return; fi
  if [ -f lerna.json ]; then printf 'lerna'; return; fi
  printf 'none'
}

# detect_integration_branch — manifest → remote HEAD → current branch → main.
detect_integration_branch() {
  local v; v="$(manifest_get branches.integration)"; [ -n "$v" ] && { printf '%s' "$v"; return; }
  v="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  [ -n "$v" ] && { printf '%s' "$v"; return; }
  v="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ -n "$v" ] && [ "$v" != "HEAD" ] && { printf '%s' "$v"; return; }
  printf 'main'
}

# detect_primary_branch — manifest → main.
detect_primary_branch() {
  local v; v="$(manifest_get branches.primary)"; [ -n "$v" ] && { printf '%s' "$v"; return; }
  printf 'main'
}

# pm_exec <pm> — the runner prefix for a package manager (npm uses `npm run`).
pm_run_prefix() {
  case "$1" in
    pnpm) printf 'pnpm';;
    yarn) printf 'yarn';;
    bun)  printf 'bun run';;
    *)    printf 'npm run';;
  esac
}
