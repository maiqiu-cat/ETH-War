#!/usr/bin/env bash
# Gate for the PUBLIC GitHub repo: refuses when the commits about to be pushed, or the HEAD tree,
# carry server or local-environment details. Run it before every push (pnpm check:public); the
# pre-push hook in scripts/git-hooks/ runs it again on exactly what is being pushed.
#
#   scripts/check-public.sh               # commits in origin/main..HEAD, plus the HEAD tree
#   scripts/check-public.sh --all         # every commit reachable from HEAD, plus the HEAD tree
#   scripts/check-public.sh <rev-range>   # e.g. <remote-sha>..<local-sha> (used by pre-push)
#
# The sensitive strings themselves never enter the repo: they live in the git-ignored
# private/deploy/forbidden-patterns.txt (extended regex, case-insensitive, one per line; override
# the path with PUBLIC_CHECK_PATTERNS). Without that file the check fails closed.
# Also flagged: IPv4 addresses other than 127/8, 0.0.0.0, 1.1.1.1 and the RFC 5737 documentation
# ranges; e-mail addresses other than noreply ones (in content and in commit identities); text
# strings inside added binary files (/Users/ paths, patterns); any tracked path under private/.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

list=${PUBLIC_CHECK_PATTERNS:-private/deploy/forbidden-patterns.txt}
[ -f "$list" ] || {
  echo "check-public: $list is missing — cannot prove the push is clean (fail closed)" >&2
  exit 1
}
case "${1:-}" in
  --all) range=HEAD ;;
  "") if git rev-parse -q --verify refs/remotes/origin/main >/dev/null; then range=origin/main..HEAD; else range=HEAD; fi ;;
  *) range=$1 ;;
esac

pats=$(mktemp)
trap 'rm -f "$pats"' EXIT
grep -v -e '^#' -e '^[[:space:]]*$' "$list" >"$pats"
[ -s "$pats" ] || {
  echo "check-public: $list has no patterns (fail closed)" >&2
  exit 1
}

IP_OK='^(127\.[0-9.]+|0\.0\.0\.0|1\.1\.1\.1|192\.0\.2\.[0-9]+|198\.51\.100\.[0-9]+|203\.0\.113\.[0-9]+)$'
EMAIL='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
EMAIL_OK='^(noreply@(anthropic\.com|openai\.com|github\.com)|[0-9]+\+[A-Za-z0-9-]+@users\.noreply\.github\.com)$'
EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904
fail=0

flag() { # flag <where> <offending text>
  [ -n "$2" ] || return 0
  echo "check-public: $1" >&2
  printf '%s\n' "$2" | cut -c1-200 | head -20 | sed 's/^/    /' >&2
  fail=1
}
# Offending lines of a text: forbidden patterns, non-documentation IPv4s, non-noreply e-mails.
scan_text() {
  grep -i -E -f "$pats" || true
  printf '%s\n' "$1" | grep -o -E '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' |
    grep -v -E "$IP_OK" | sort -u | sed 's/^/ip address: /' || true
  printf '%s\n' "$1" | grep -o -E "$EMAIL" | grep -v -E "$EMAIL_OK" | sort -u | sed 's/^/e-mail: /' || true
}

# 1. Every commit in the range: message, added lines, added binaries, author/committer identity.
n=0
for c in $(git rev-list "$range"); do
  n=$((n + 1))
  short=$(git rev-parse --short "$c")
  parent=$(git rev-parse -q --verify "$c^" || echo $EMPTY_TREE)
  msg=$(git log -1 --format=%B "$c")
  flag "commit $short message" "$(printf '%s\n' "$msg" | scan_text "$msg")"
  added=$(git diff -U0 --no-color --no-ext-diff "$parent" "$c" | sed -n '/^+++ /d; s/^+//p')
  flag "commit $short changes" "$(printf '%s\n' "$added" | scan_text "$added")"
  for f in $(git diff --numstat "$parent" "$c" | awk -F'\t' '$1 == "-" {print $3}'); do
    s=$(git cat-file -p "$c:$f" 2>/dev/null | strings -n 6 || true)
    flag "commit $short binary $f" "$(printf '%s\n' "$s" | grep -i -E -e '/Users/' -f "$pats" || true)"
  done
  ids=$(git log -1 --format='%ae%n%ce' "$c" | grep -v -E "$EMAIL_OK" || true)
  flag "commit $short identity (use a noreply e-mail)" "$ids"
  tz=$(git log -1 --format='%ad%n%cd' --date=raw "$c" | awk '{print $2}' | grep -v -x '+0000' || true)
  flag "commit $short dates carry a local timezone (commit with TZ=UTC; fix with --date and GIT_COMMITTER_DATE)" "$tz"
done

# 2. The HEAD tree as a whole (catches anything that predates the range).
flag "HEAD tree" "$(git grep -I -n -i -E -f "$pats" HEAD -- . || true)"
tree_ips=$(git grep -I -h -o -E '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' HEAD -- . | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' | grep -v -E "$IP_OK" | sort -u || true)
flag "HEAD tree ip addresses" "$tree_ips"
tree_mails=$(git grep -I -h -o -E "$EMAIL" HEAD -- . | grep -v -E "$EMAIL_OK" | sort -u || true)
flag "HEAD tree e-mail addresses" "$tree_mails"
flag "HEAD tree tracks private/" "$(git ls-tree -r --name-only HEAD | grep '^private/' || true)"
git show HEAD:.gitignore | grep -q -x '/private/' || flag ".gitignore" "/private/ is not ignored"

if [ "$fail" = 0 ]; then
  echo "check-public: OK ($n commits in $range, HEAD tree $(git rev-parse --short HEAD))"
else
  echo "check-public: FAILED — do not push; move the details to private/ (docs/handoff/runbook.md)" >&2
  exit 1
fi
