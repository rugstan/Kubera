#!/usr/bin/env bash
# Installs, activates and rolls back Corin releases on the VPS. Run as root.
#
#   corin-release install <tarball> <release-id>   unpack, switch, restart, health check
#   corin-release rollback                         go back to the previous release
#   corin-release status                           show the live release and the service
#
# A release is the Next.js standalone build (server.js, .next/static, public).
# Releases live in /srv/corin/releases/<id>; /srv/corin/current points at the
# live one. A release that does not answer within 90 seconds is rolled back
# automatically. The five newest releases are kept.
set -euo pipefail

APP_DIR=/srv/corin
RELEASES="$APP_DIR/releases"
CURRENT="$APP_DIR/current"
SERVICE=corin.service
HEALTH_URL="http://127.0.0.1:3000/"
HEALTH_HOST="corincommercial.com"
KEEP=5

[ "$(id -u)" -eq 0 ] || { echo "Run this as root." >&2; exit 1; }

switch_to() {
  ln -sfn "$1" "$CURRENT.tmp"
  mv -Tf "$CURRENT.tmp" "$CURRENT"
  basename "$1" > "$APP_DIR/RELEASE"
  systemctl restart "$SERVICE"
}

healthy() {
  local code="000"
  for _ in $(seq 1 90); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $HEALTH_HOST" "$HEALTH_URL" || true)"
    if [ "$code" = "200" ]; then echo "Health check passed (HTTP 200)."; return 0; fi
    sleep 1
  done
  echo "Health check failed (last answer: HTTP $code)." >&2
  return 1
}

cmd="${1:-status}"
case "$cmd" in
  install)
    tarball="${2:?usage: corin-release install <tarball> <release-id>}"
    id="${3:?usage: corin-release install <tarball> <release-id>}"
    [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Bad release id: $id" >&2; exit 1; }
    [ -f "$tarball" ] || { echo "No such file: $tarball" >&2; exit 1; }
    [ "$(uname -m)" = "x86_64" ] || echo "Warning: this server is $(uname -m); the build is for x86_64." >&2

    rel="$RELEASES/$id"
    previous="$(readlink -f "$CURRENT" 2>/dev/null || true)"
    rm -rf "$rel"
    install -d -m 0755 "$rel"
    tar -xzf "$tarball" -C "$rel"
    rm -f "$tarball"
    [ -f "$rel/server.js" ] || { echo "The release has no server.js; was it built with NEXT_OUTPUT_STANDALONE=1?" >&2; rm -rf "$rel"; exit 1; }
    # Code is read-only to the app. Next rewrites prerendered pages under
    # .next/server when they revalidate, so that folder belongs to the app user;
    # the rest of its cache (images, fetches) lives in the shared folder.
    chown -R root:root "$rel"
    chmod -R a+rX,go-w "$rel"
    install -d -m 0755 "$rel/.next"
    [ -d "$rel/.next/server" ] && chown -R corin:corin "$rel/.next/server"
    rm -rf "$rel/.next/cache"
    ln -s "$APP_DIR/shared/cache" "$rel/.next/cache"

    echo "Activating $id"
    switch_to "$rel"
    if ! healthy; then
      journalctl -u "$SERVICE" -n 80 --no-pager || true
      if [ -n "$previous" ] && [ -d "$previous" ] && [ "$previous" != "$rel" ]; then
        echo "Rolling back to $(basename "$previous")" >&2
        switch_to "$previous"
        healthy || true
      fi
      exit 1
    fi
    # Keep the newest releases; never delete the live one.
    live="$(readlink -f "$CURRENT")"
    ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's:/*$::' | tail -n +$((KEEP + 1)) | while read -r old; do
      [ "$(readlink -f "$old")" = "$live" ] || rm -rf "$old"
    done
    echo "Live release: $id"
    ;;
  rollback)
    live="$(readlink -f "$CURRENT" 2>/dev/null || true)"
    target="$(ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's:/*$::' | while read -r r; do [ "$(readlink -f "$r")" = "$live" ] || { echo "$r"; break; }; done)"
    [ -n "$target" ] || { echo "No earlier release to roll back to." >&2; exit 1; }
    echo "Rolling back to $(basename "$target")"
    switch_to "$target"
    healthy
    ;;
  status)
    echo "Live release: $(cat "$APP_DIR/RELEASE" 2>/dev/null || echo none)"
    echo "Releases:"; ls -1t "$RELEASES" 2>/dev/null | head -n "$KEEP" || true
    systemctl --no-pager --lines=15 status "$SERVICE" || true
    ;;
  *)
    echo "usage: corin-release install <tarball> <release-id> | rollback | status" >&2
    exit 2
    ;;
esac
