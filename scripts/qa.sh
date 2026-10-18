#!/usr/bin/env bash
# QA gate — static checks. No build step exists, so "lint" means: every JS file
# and every inline <script> in the HTML pages must parse, and config JSON must
# be valid. Exit non-zero on the first class of failure.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "==> JS syntax"
while IFS= read -r f; do
  if node --check "$f" 2>"$tmp/err"; then echo "  ok  $f"; else echo "  FAIL $f"; sed 's/^/       /' "$tmp/err"; fail=1; fi
done < <(find . -name '*.js' -not -path './node_modules/*' -not -path './.git/*' | sort)

echo "==> Inline <script> blocks in HTML"
while IFS= read -r f; do
  n=$(node -e '
    const fs = require("fs");
    const [file, dir] = process.argv.slice(1);
    const html = fs.readFileSync(file, "utf8");
    const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, i = 0;
    while ((m = re.exec(html))) {
      if (/type\s*=\s*["\x27](?!text\/javascript|module)/i.test(m[1])) continue;
      fs.writeFileSync(`${dir}/inline-${i++}.js`, m[2]);
    }
    console.log(i);
  ' "$f" "$tmp")
  for s in "$tmp"/inline-*.js; do
    [ -e "$s" ] || continue
    if ! node --check "$s" 2>"$tmp/err"; then echo "  FAIL $f ($(basename "$s"))"; sed 's/^/       /' "$tmp/err"; fail=1; fi
    rm -f "$s"
  done
  echo "  ok  $f ($n inline script(s))"
done < <(find . -maxdepth 2 -name '*.html' -not -path './node_modules/*' | sort)

echo "==> JSON config"
for f in .claude/settings.json package.json; do
  [ -f "$f" ] || continue
  if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f"; then echo "  ok  $f"; else echo "  FAIL $f"; fail=1; fi
done

[ "$fail" -eq 0 ] && echo "QA PASS" || { echo "QA FAIL"; exit 1; }
