#!/usr/bin/env bash
# ETH War — server-side installer for ethwar.ondream.ai.
#
# Runs as root on the web server, from inside an unpacked release kit:
#   /root/ethwar-deploy/ethwar-<id>/install.sh <command>
#
# Commands
#   preflight   read-only checks (nginx, sockets, conflicts, disk, other sites)
#   baseline    record the pre-change state once (nginx tarball + fingerprints + site codes);
#               runs automatically before the first change and is never overwritten
#   deploy      install this kit as a new release, install the nginx site, switch `current`
#   cert        issue the Let's Encrypt certificate (DNS must point here), switch to HTTPS
#   rollback    point `current` back to the previous release (site stays online)
#   purge       full rollback to the baseline: remove the nginx site, prove nginx config is
#               byte-identical to the baseline, compare every other site, delete our files
#               and (unless KEEP_CERT=1) our certificate
#   status      show releases, config, certificate and HTTP checks
#   audit       read-only post-release check against the baseline: nginx files (only our config may
#               differ), every other site's HTTP/HTTPS codes + default certificate, listeners, containers
#
# Safety rules (shared server: other projects' sites live here)
#   * only touches /var/www/ethwar.ondream.ai, /var/www/ethwar-acme,
#     /etc/nginx/conf.d/zz-ethwar.ondream.ai.conf, certbot's ethwar.ondream.ai lineage,
#     and /root/ethwar-deploy (kits + baseline)
#   * only server blocks, no http-level directives; HTTPS listens on exactly the sockets the
#     other sites already use (checked in preflight), so no new socket is ever bound
#   * every nginx change: backup → nginx -t → reload → compare other sites' HTTP/HTTPS codes
#     and the default certificate before/after; any failure or difference restores automatically
set -euo pipefail

DOMAIN=ethwar.ondream.ai
SITE=/var/www/ethwar.ondream.ai
ACME=/var/www/ethwar-acme
CONF=/etc/nginx/conf.d/zz-ethwar.ondream.ai.conf
CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
DEPLOY_ROOT=${DEPLOY_ROOT:-/root/ethwar-deploy}
BASE="$DEPLOY_ROOT/baseline"
KIT="$(cd "$(dirname "$0")" && pwd)"
REL="$(basename "$KIT")"
REL="${REL#ethwar-}"
STATE="$SITE/.state"
# Public IP $DOMAIN must resolve to before `cert`. Server-specific, so deploy/package.sh writes it
# into the kit's site.env from the git-ignored private/deploy/site.env.
EXPECT_IP=$(sed -n 's/^EXPECT_IP=//p' "$KIT/site.env" 2>/dev/null | head -1)

log() { printf '[ethwar] %s\n' "$*"; }
warn() { printf '[ethwar] WARN: %s\n' "$*" >&2; }
die() {
  printf '[ethwar] ERROR: %s\n' "$*" >&2
  exit 1
}

reload_nginx() {
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
    systemctl reload nginx
  else
    nginx -s reload
  fi
  sleep 2 # reload is asynchronous; let the new workers take over before anyone checks
}

# "<file> <name>" for every server_name in the live config (handles one-line server blocks).
server_names() {
  nginx -T 2>/dev/null | awk '
    /^# configuration file /{ f=$4; sub(/:$/,"",f); next }
    { line=$0; sub(/#.*/,"",line)
      while (match(line, /server_name[ \t]+[^;]+;/)) {
        s=substr(line, RSTART, RLENGTH); line=substr(line, RSTART+RLENGTH)
        sub(/^server_name[ \t]+/,"",s); sub(/;$/,"",s)
        n=split(s, a, /[ \t]+/); for (i=1;i<=n;i++) if (a[i]!="") print f, a[i]
      } }'
}

# Host names of every other site nginx serves (exact names only).
other_hosts() {
  server_names | awk -v conf="$CONF" '$1 != conf {print $2}' |
    grep -E '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' | grep -v -x "$DOMAIN" | sort -u | head -40 || true
}

# "host http-code https-code" for each other site via loopback, plus the certificate nginx
# presents without SNI (the implicit :443 default) — none of these may change.
snapshot_sites() {
  local h c80 c443
  for h in $(other_hosts); do
    c80=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -H "Host: $h" http://127.0.0.1/ || true)
    c443=$(curl -sk -o /dev/null -m 8 -w '%{http_code}' --resolve "$h:443:127.0.0.1" "https://$h/" || true)
    printf '%s %s %s\n' "$h" "$c80" "$c443"
  done
  printf 'default-cert %s\n' "$(echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | tr -d ' ')"
}

nginx_fingerprint() { nginx -T 2>/dev/null | sha256sum | cut -d' ' -f1; }

nginx_file_hashes() {
  find /etc/nginx -type f | LC_ALL=C sort | xargs sha256sum 2>/dev/null
}

listeners() { ss -ltnH 2>/dev/null | awk '{print $4}' | LC_ALL=C sort -u; }

# Every :443 listen in our HTTPS template must name an explicit address that nginx already owns.
# A bare/wildcard `listen 443` passes `nginx -t` but fails at reload when another process holds a
# specific-IP :443 (as on production), leaving nginx on the old config and a poisoned file in conf.d.
check_https_sockets() {
  local tmpl="$KIT/nginx/ethwar.https.conf" want n=0
  [ -f "$tmpl" ] || return 0
  for want in $(awk '/^[ \t]*listen[ \t]/ {a=$2; sub(/;$/,"",a); if (a ~ /(^|:)443$/) print a}' "$tmpl"); do
    case "$want" in
      443 | \*:443 | 0.0.0.0:443 | \[::\]:443) die "template has wildcard 'listen $want' — must use the explicit sockets other sites use; refusing" ;;
    esac
    ss -ltnpH 2>/dev/null | awk -v w="$want" '$4==w' | grep -q nginx ||
      die "template listens on $want but nginx does not currently own that socket — refusing"
    n=$((n + 1))
  done
  [ "$n" -gt 0 ] || die "HTTPS template has no :443 listen"
  log "HTTPS sockets in template are already bound by nginx: $(awk '/^[ \t]*listen[ \t]/ {a=$2; sub(/;$/,"",a); if (a ~ /:443$/) printf "%s ", a}' "$tmpl")"
}

# Prove nginx is actually running the config we just installed (a failed reload keeps the old one).
config_active() {
  local tmpl="$1" tok body subj
  tok="probe-$RANDOM$RANDOM"
  echo "$tok" >"$ACME/.well-known/acme-challenge/$tok"
  body=$(curl -s -m 8 -H "Host: $DOMAIN" "http://127.0.0.1/.well-known/acme-challenge/$tok" || true)
  rm -f "$ACME/.well-known/acme-challenge/$tok"
  [ "$body" = "$tok" ] || return 1
  if [ "$tmpl" = "$KIT/nginx/ethwar.https.conf" ]; then
    subj=$(echo | openssl s_client -servername "$DOMAIN" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject 2>/dev/null)
    case "$subj" in *"$DOMAIN"*) ;; *) return 1 ;; esac
  fi
  return 0
}

preflight() {
  [ "$(id -u)" = 0 ] || die "run as root"
  command -v nginx >/dev/null || die "nginx not found"
  command -v curl >/dev/null || die "curl not found"
  command -v openssl >/dev/null || die "openssl not found"
  log "nginx: $(nginx -v 2>&1)"
  nginx -t 2>/dev/null || die "current nginx config already fails 'nginx -t' — not touching anything"
  nginx -T 2>/dev/null | grep -q 'include[[:space:]]\+/etc/nginx/conf.d/\*\.conf' || die "nginx.conf does not include conf.d/*.conf"
  local conflict
  conflict=$(server_names | awk -v conf="$CONF" -v d="$DOMAIN" '$1 != conf && $2 == d {print $1}' | sort -u)
  [ -z "$conflict" ] || die "$DOMAIN already configured in: $conflict"
  check_https_sockets
  log "explicit default_server lines:"
  nginx -T 2>/dev/null | grep -n 'default_server' | grep -v '#' | sed 's/^/  /' || log "  (none)"
  local avail
  avail=$(df -Pm /var/www 2>/dev/null | awk 'NR==2{print $4}')
  log "free space on /var/www: ${avail:-?} MB"
  [ "${avail:-0}" -gt 200 ] || die "less than 200 MB free on /var/www"
  if [ -f "$KIT/MANIFEST.sha256" ]; then
    (cd "$KIT" && sha256sum -c --quiet MANIFEST.sha256) || die "kit integrity check failed"
    log "kit integrity: OK ($(wc -l <"$KIT/MANIFEST.sha256") files)"
  fi
  command -v certbot >/dev/null && log "certbot: $(certbot --version 2>&1)" || warn "certbot not installed (needed for 'cert')"
  [ -f "$CERT" ] && log "certificate present: $(openssl x509 -enddate -noout -in "$CERT")" || log "certificate: not yet issued"
  log "nginx fingerprint: $(nginx_fingerprint)"
  local sites
  sites=$(snapshot_sites)
  log "other sites (host http https) + default cert:"
  printf '%s\n' "$sites" | sed 's/^/  /'
  log "preflight OK (nothing was changed)"
}

# Record the pre-change state once. Never overwritten: it is what `purge` restores to.
baseline() {
  if [ -f "$BASE/nginx-T.sha256" ]; then
    log "baseline already recorded at $BASE ($(cat "$BASE/recorded_at"))"
    return 0
  fi
  [ ! -e "$CONF" ] || die "our nginx config already exists — cannot record a clean baseline"
  install -d -m 700 "$BASE"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$BASE/recorded_at"
  tar -czf "$BASE/etc-nginx.tgz" -C / etc/nginx
  nginx_fingerprint >"$BASE/nginx-T.sha256"
  nginx -T 2>/dev/null >"$BASE/nginx-T.txt"
  nginx_file_hashes >"$BASE/nginx-files.sha256"
  snapshot_sites >"$BASE/sites.txt"
  listeners >"$BASE/listeners.txt"
  (docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | sed -E 's/ Up .*/ Up/' | LC_ALL=C sort) >"$BASE/docker.txt" || true
  chmod 600 "$BASE"/*
  log "baseline recorded in $BASE (nginx fingerprint $(cat "$BASE/nginx-T.sha256"))"
}

# Install the right nginx template (http before the cert exists, https after), with automatic restore.
write_nginx() {
  local tmpl="$KIT/nginx/ethwar.http.conf"
  [ -f "$CERT" ] && tmpl="$KIT/nginx/ethwar.https.conf"
  [ -f "$tmpl" ] || die "missing template $tmpl"
  [ "$tmpl" = "$KIT/nginx/ethwar.https.conf" ] && check_https_sockets
  install -d -m 700 "$STATE"
  # Content-only release: our file already equals this template. Do not reload the shared nginx
  # (a reload would also apply anyone else's pending edits) — only prove our config is live.
  if [ -e "$CONF" ] && cmp -s "$tmpl" "$CONF"; then
    config_active "$tmpl" ||
      die "$CONF matches the template but nginx is not serving it — not reloading the shared nginx blindly; investigate (nginx -t, error.log)"
    log "nginx config unchanged ($(basename "$tmpl") already active) — no reload, other sites untouched"
    return 0
  fi
  local before backup=""
  before=$(snapshot_sites)
  if [ -e "$CONF" ]; then
    backup="$STATE/nginx-$(date -u +%Y%m%dT%H%M%SZ).conf"
    cp -p "$CONF" "$backup"
  fi
  install -m 644 "$tmpl" "$CONF.new"
  mv -f "$CONF.new" "$CONF"
  restore() {
    warn "restoring previous nginx state"
    if [ -n "$backup" ]; then cp -p "$backup" "$CONF"; else rm -f "$CONF"; fi
    nginx -t && reload_nginx
  }
  if ! nginx -t; then
    restore
    die "nginx -t failed with the new config (restored)"
  fi
  reload_nginx
  if ! config_active "$tmpl"; then
    tail -n 5 /var/log/nginx/error.log 2>/dev/null | sed 's/^/  error.log: /' >&2 || true
    restore
    die "nginx did not apply the new config (reload failed?) — restored"
  fi
  local after
  after=$(snapshot_sites)
  if [ "$before" != "$after" ]; then
    printf 'before:\n%s\nafter:\n%s\n' "$before" "$after" >&2
    restore
    die "other sites changed their responses after reload (restored)"
  fi
  log "nginx config installed: $(basename "$tmpl") → $CONF (other sites unchanged)"
}

verify() {
  local want got opts=(-H "Host: $DOMAIN") url="http://127.0.0.1" scheme=http
  if [ -f "$CERT" ] && grep -q 'listen .*443' "$CONF" 2>/dev/null; then
    scheme=https
    opts=(--resolve "$DOMAIN:443:127.0.0.1")
    url="https://$DOMAIN"
  fi
  want=$(sha256sum "$SITE/current/index.html" | cut -d' ' -f1)
  got=$(curl -fsS -m 10 "${opts[@]}" "$url/" | sha256sum | cut -d' ' -f1) || {
    warn "GET / failed"
    return 1
  }
  [ "$want" = "$got" ] || {
    warn "served index.html does not match release ($got != $want)"
    return 1
  }
  local asset
  asset=$(grep -o '/assets/[^"]*\.js' "$SITE/current/index.html" | head -1 || true)
  if [ -n "$asset" ]; then
    curl -fsS -m 10 -o /dev/null -D - "${opts[@]}" "$url$asset" | grep -qi 'cache-control: public, max-age=31536000, immutable' || {
      warn "asset $asset missing or without immutable caching"
      return 1
    }
  fi
  local audio
  audio=$(cd "$SITE/current" && find assets -maxdepth 1 -name '*.m4a' 2>/dev/null | LC_ALL=C sort | head -1 || true)
  if [ -n "$audio" ]; then
    want=$(sha256sum "$SITE/current/$audio" | cut -d' ' -f1)
    got=$(curl -fsS -m 20 "${opts[@]}" "$url/$audio" | sha256sum | cut -d' ' -f1) || {
      warn "GET /$audio failed"
      return 1
    }
    [ "$want" = "$got" ] || {
      warn "served /$audio does not match the release"
      return 1
    }
  fi
  log "verify OK over $scheme: index.html matches release $(readlink "$SITE/current"), assets cached immutable${audio:+, audio asset served intact}"
}

deploy() {
  preflight
  baseline
  [ -d "$KIT/site" ] && [ -f "$KIT/site/index.html" ] || die "kit has no site/index.html"
  install -d -m 755 "$SITE" "$SITE/releases" "$ACME" "$ACME/.well-known" "$ACME/.well-known/acme-challenge"
  [ ! -e "$SITE/releases/$REL" ] || die "release $REL already exists — build a new kit instead of overwriting"
  cp -a "$KIT/site" "$SITE/releases/$REL"
  chown -R root:root "$SITE/releases/$REL" # kits built on macOS carry uid 501 / gid 20
  find "$SITE/releases/$REL" -type d -exec chmod 755 {} +
  find "$SITE/releases/$REL" -type f -exec chmod 644 {} +
  install -d -m 700 "$STATE"
  local prev
  prev=$(readlink "$SITE/current" 2>/dev/null || true)
  # nginx first: if the config is rejected nothing user-visible has changed yet.
  write_nginx
  ln -sfn "releases/$REL" "$SITE/current.tmp"
  mv -Tf "$SITE/current.tmp" "$SITE/current"
  log "current → releases/$REL (previous: ${prev:-none})"
  if ! verify; then
    if [ -n "$prev" ]; then
      ln -sfn "$prev" "$SITE/current.tmp"
      mv -Tf "$SITE/current.tmp" "$SITE/current"
      die "verification failed — current switched back to $prev"
    fi
    die "verification failed on the first release — run 'purge' to return to the baseline"
  fi
  printf '%s\n' "$prev" >"$STATE/PREVIOUS"
  log "deployed $REL — http://$DOMAIN/ (https after 'cert')"
}

cert() {
  [ "$(id -u)" = 0 ] || die "run as root"
  command -v certbot >/dev/null || die "certbot not installed"
  [ -e "$CONF" ] || die "run 'deploy' first (the HTTP config serves the ACME challenge)"
  if [ ! -f "$CERT" ]; then
    local resolved
    [ -n "$EXPECT_IP" ] || die "kit has no EXPECT_IP in site.env — rebuild it with deploy/package.sh"
    resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
    [ "$resolved" = "$EXPECT_IP" ] || die "$DOMAIN resolves to '${resolved:-nothing}', expected $EXPECT_IP — fix the DNS A record / wait for DNS"
    # Self-test the challenge path through nginx before asking Let's Encrypt.
    local tok="selftest-$RANDOM$RANDOM" body
    echo "$tok" >"$ACME/.well-known/acme-challenge/$tok"
    body=$(curl -fsS -m 8 -H "Host: $DOMAIN" "http://127.0.0.1/.well-known/acme-challenge/$tok" || true)
    rm -f "$ACME/.well-known/acme-challenge/$tok"
    [ "$body" = "$tok" ] || die "ACME challenge path not served by nginx"
    certbot certonly --webroot -w "$ACME" -d "$DOMAIN" --non-interactive --keep-until-expiring \
      ${CERTBOT_EMAIL:+--email "$CERTBOT_EMAIL" --agree-tos}
  else
    log "certificate already present"
  fi
  write_nginx
  verify || die "HTTPS verification failed — run 'purge' (or reinstall the HTTP config by removing the cert) and investigate"
  log "HTTPS live: https://$DOMAIN/ ($(openssl x509 -enddate -noout -in "$CERT"))"
}

rollback() {
  local prev cur
  prev=$(cat "$STATE/PREVIOUS" 2>/dev/null || true)
  [ -n "$prev" ] && [ -d "$SITE/$prev" ] || die "no previous release recorded"
  cur=$(readlink "$SITE/current")
  ln -sfn "$prev" "$SITE/current.tmp"
  mv -Tf "$SITE/current.tmp" "$SITE/current"
  echo "$cur" >"$STATE/PREVIOUS"
  log "current → $prev (was $cur)"
  verify || die "verification failed after rollback"
}

# Full rollback to the recorded baseline, with proof.
purge() {
  [ "$(id -u)" = 0 ] || die "run as root"
  [ -f "$BASE/nginx-T.sha256" ] || die "no baseline at $BASE — refusing (cannot prove the result)"
  if [ -e "$CONF" ]; then
    cp -p "$CONF" "$BASE/zz-ethwar.removed-$(date -u +%Y%m%dT%H%M%SZ).conf"
    rm -f "$CONF"
    nginx -t || die "nginx -t failed after removing our config (it was backed up in $BASE)"
    reload_nginx
    log "nginx site removed and nginx reloaded"
  else
    log "nginx site not installed"
  fi
  local fp ok=1
  fp=$(nginx_fingerprint)
  if [ "$fp" = "$(cat "$BASE/nginx-T.sha256")" ]; then
    log "nginx config is byte-identical to the baseline ($fp)"
  else
    ok=0
    warn "nginx config differs from the baseline — files changed since $(cat "$BASE/recorded_at"):"
    diff <(cut -c1-200 "$BASE/nginx-files.sha256") <(nginx_file_hashes | cut -c1-200) | grep '^[<>]' | sed 's/^/  /' >&2 || true
    warn "if those changes are not ours, they belong to someone else — do NOT restore $BASE/etc-nginx.tgz blindly"
  fi
  local now
  now=$(snapshot_sites)
  if [ "$now" = "$(cat "$BASE/sites.txt")" ]; then
    log "all other sites answer exactly as in the baseline"
  else
    ok=0
    warn "site responses differ from the baseline:"
    diff "$BASE/sites.txt" <(printf '%s\n' "$now") | grep '^[<>]' | sed 's/^/  /' >&2 || true
  fi
  if [ "$(listeners)" != "$(cat "$BASE/listeners.txt")" ]; then
    warn "listening sockets differ from the baseline (may be unrelated services):"
    diff "$BASE/listeners.txt" <(listeners) | grep '^[<>]' | sed 's/^/  /' >&2 || true
  fi
  rm -rf -- "$SITE" "$ACME"
  log "removed $SITE and $ACME"
  if [ -d "/etc/letsencrypt/live/$DOMAIN" ] && [ "${KEEP_CERT:-0}" != "1" ]; then
    certbot delete --cert-name "$DOMAIN" --non-interactive && log "certificate lineage $DOMAIN deleted"
  fi
  [ "$ok" = 1 ] && log "PURGE VERIFIED: server is back to the baseline recorded $(cat "$BASE/recorded_at")" ||
    die "purge finished but the server is NOT identical to the baseline (see warnings)"
  log "kits and baseline kept in $DEPLOY_ROOT (remove with: rm -rf $DEPLOY_ROOT)"
}

# Read-only: compare the live server with the pre-change baseline (post-release acceptance).
audit() {
  [ "$(id -u)" = 0 ] || die "run as root"
  [ -f "$BASE/nginx-T.sha256" ] || die "no baseline at $BASE"
  local ok=1 d now
  log "baseline recorded $(cat "$BASE/recorded_at")"
  if nginx -t 2>/dev/null; then log "nginx -t: OK"; else
    warn "nginx -t FAILS"
    ok=0
  fi
  d=$(diff <(cut -c1-200 "$BASE/nginx-files.sha256") <(nginx_file_hashes | cut -c1-200) | grep '^[<>]' | grep -v -F "$CONF" || true)
  if [ -z "$d" ]; then
    log "nginx files: identical to the baseline except $CONF"
  else
    ok=0
    warn "nginx files changed since the baseline (other than ours):"
    printf '%s\n' "$d" | sed 's/^/  /' >&2
  fi
  now=$(snapshot_sites)
  if [ "$now" = "$(cat "$BASE/sites.txt")" ]; then
    log "other sites + default certificate: identical to the baseline ($(grep -c . "$BASE/sites.txt") lines)"
  else
    ok=0
    warn "site responses differ from the baseline:"
    diff "$BASE/sites.txt" <(printf '%s\n' "$now") | grep '^[<>]' | sed 's/^/  /' >&2 || true
  fi
  if [ "$(listeners)" = "$(cat "$BASE/listeners.txt")" ]; then log "listening sockets: identical"; else
    warn "listening sockets differ (may be unrelated services):"
    diff "$BASE/listeners.txt" <(listeners) | grep '^[<>]' | sed 's/^/  /' >&2 || true
  fi
  local dk
  dk=$( (docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | sed -E 's/ Up .*/ Up/' | LC_ALL=C sort) || true)
  if [ "$dk" = "$(cat "$BASE/docker.txt")" ]; then log "containers: identical (names + Up)"; else
    warn "containers differ (may be unrelated releases):"
    diff "$BASE/docker.txt" <(printf '%s\n' "$dk") | grep '^[<>]' | sed 's/^/  /' >&2 || true
  fi
  status
  [ "$ok" = 1 ] && log "AUDIT OK: only ethwar.ondream.ai differs from the baseline" ||
    die "AUDIT FOUND DIFFERENCES (see warnings; they may belong to other projects — check before acting)"
}

status() {
  log "current:  $(readlink "$SITE/current" 2>/dev/null || echo none)"
  log "previous: $(cat "$STATE/PREVIOUS" 2>/dev/null || echo none)"
  log "releases: $(ls "$SITE/releases" 2>/dev/null | tr '\n' ' ')"
  log "config:   $([ -e "$CONF" ] && echo "$CONF" || echo 'not installed')"
  log "baseline: $([ -f "$BASE/recorded_at" ] && cat "$BASE/recorded_at" || echo none)"
  [ -f "$CERT" ] && log "cert:     $(openssl x509 -enddate -noout -in "$CERT")" || log "cert:     none"
  log "http:     $(curl -s -o /dev/null -m 8 -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/)"
  [ -f "$CERT" ] && log "https:    $(curl -s -o /dev/null -m 8 -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/")"
  return 0
}

case "${1:-}" in
  preflight) preflight ;;
  baseline) baseline ;;
  deploy) deploy ;;
  cert) cert ;;
  rollback) rollback ;;
  purge) purge ;;
  audit) audit ;;
  status) status ;;
  *)
    sed -n '2,30p' "$0"
    exit 2
    ;;
esac
