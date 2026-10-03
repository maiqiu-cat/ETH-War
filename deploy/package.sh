#!/usr/bin/env bash
# Build a release kit for ethwar.ondream.ai.
#
#   deploy/package.sh            # requires a clean git tree
#   ALLOW_DIRTY=1 deploy/package.sh
#
# Output (git-ignored): deploy/out/ethwar-<YYYYMMDD-HHMM>-<sha>.tar.gz (+ .sha256)
# Kit layout: ethwar-<id>/{site/, nginx/, install.sh, site.env, release.json, MANIFEST.sha256}
# Server-specific values come from the git-ignored private/deploy/ (templates: deploy/examples/).
set -euo pipefail
cd "$(dirname "$0")/.."

conf=private/deploy/site.env
listen=private/deploy/https-listen.conf
[ -f "$conf" ] && [ -f "$listen" ] || {
  echo "missing $conf or $listen; create them from deploy/examples/" >&2
  exit 1
}
expect_ip=$(. "$conf" && printf '%s' "${EXPECT_IP:-}")
[ -n "$expect_ip" ] || {
  echo "EXPECT_IP not set in $conf" >&2
  exit 1
}

dirty=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$dirty" != "0" ] && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  echo "working tree is dirty ($dirty files); commit first or set ALLOW_DIRTY=1" >&2
  exit 1
fi

commit=$(git rev-parse HEAD)
id="$(date -u +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
kit="deploy/out/ethwar-$id"
[ ! -e "$kit" ] || {
  echo "$kit already exists" >&2
  exit 1
}

pnpm build
mkdir -p "$kit"
cp -R dist "$kit/site"
deploy/render-nginx.sh "$listen" "$kit/nginx"
cp deploy/server/install.sh "$kit/install.sh"
chmod 755 "$kit/install.sh"
printf 'EXPECT_IP=%s\n' "$expect_ip" >"$kit/site.env"
cat >"$kit/release.json" <<JSON
{
  "id": "$id",
  "commit": "$commit",
  "dirty": $([ "$dirty" = "0" ] && echo false || echo true),
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "domain": "ethwar.ondream.ai"
}
JSON
(cd "$kit" && find . -type f ! -name MANIFEST.sha256 | LC_ALL=C sort | sed 's|^\./||' | xargs shasum -a 256 >MANIFEST.sha256)

# COPYFILE_DISABLE keeps macOS AppleDouble (._*) files out of the archive.
# --uid/--gid: archive members owned by root instead of the macOS user (uid 501, gid 20).
COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root -czf "deploy/out/ethwar-$id.tar.gz" -C deploy/out "ethwar-$id"
(cd deploy/out && shasum -a 256 "ethwar-$id.tar.gz" >"ethwar-$id.tar.gz.sha256")
echo "kit:     $kit"
echo "archive: deploy/out/ethwar-$id.tar.gz ($(du -h "deploy/out/ethwar-$id.tar.gz" | cut -f1))"
cat "deploy/out/ethwar-$id.tar.gz.sha256"
