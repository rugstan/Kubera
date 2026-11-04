#!/usr/bin/env bash
# Adds free Let's Encrypt HTTPS certificates for domains that already point at
# this server, and turns on the HTTP-to-HTTPS redirect. Certificates renew
# automatically (certbot's systemd timer). Run as root:
#
#   corin-tls [email=you@example.com] corincommercial.com www.corincommercial.com
#
# A domain whose DNS does not point here yet is skipped with a message.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run this as root." >&2; exit 1; }

email=""
domains=()
for arg in "$@"; do
  case "$arg" in
    email=*) email="${arg#email=}" ;;
    *) domains+=("$arg") ;;
  esac
done
[ "${#domains[@]}" -gt 0 ] || { echo "usage: corin-tls [email=you@example.com] domain [domain...]" >&2; exit 2; }
if [ -n "$email" ] && ! [[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$ ]]; then echo "Bad email: $email" >&2; exit 2; fi

server_ip="$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
ready=()
for d in "${domains[@]}"; do
  [[ "$d" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] || { echo "Bad domain: $d" >&2; exit 2; }
  resolved="$(getent ahostsv4 "$d" | awk '{print $1; exit}')"
  if [ "$resolved" = "$server_ip" ]; then
    ready+=("-d" "$d")
  else
    echo "Skipping $d: it points to ${resolved:-nothing}, this server is $server_ip."
  fi
done
[ "${#ready[@]}" -gt 0 ] || { echo "No domain points at this server yet; nothing to do." >&2; exit 1; }

if [ -n "$email" ]; then account=(--email "$email"); else account=(--register-unsafely-without-email); fi
certbot --nginx --non-interactive --agree-tos --redirect "${account[@]}" "${ready[@]}"
nginx -t && systemctl reload nginx
certbot certificates
