#!/usr/bin/env bash
# Render the nginx templates into <out-dir>: ethwar.http.conf as is, ethwar.https.conf with the
# `# @HTTPS_LISTEN@` line replaced by the server's HTTPS listen lines from <listen-snippet>.
#
#   deploy/render-nginx.sh private/deploy/https-listen.conf deploy/out/ethwar-<id>/nginx
#
# The listen lines name the server's own addresses, so the real snippet lives in the git-ignored
# private/deploy/; deploy/examples/https-listen.conf is the template (and the rehearsal's sandbox).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
snippet=${1:?usage: render-nginx.sh <listen-snippet> <out-dir>}
out=${2:?usage: render-nginx.sh <listen-snippet> <out-dir>}
grep -qE '^[[:space:]]*listen[[:space:]]' "$snippet" || {
  echo "$snippet: missing or has no listen lines (template: deploy/examples/https-listen.conf)" >&2
  exit 1
}
mkdir -p "$out"
cp "$here/nginx/ethwar.http.conf" "$out/ethwar.http.conf"
awk -v snip="$snippet" '
  /^[ \t]*# @HTTPS_LISTEN@/ { while ((getline l < snip) > 0) print l; n++; next }
  { print }
  END { if (n != 1) { print "expected exactly one @HTTPS_LISTEN@ line, found " n > "/dev/stderr"; exit 1 } }
' "$here/nginx/ethwar.https.conf" >"$out/ethwar.https.conf"
