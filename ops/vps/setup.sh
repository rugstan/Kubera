#!/usr/bin/env bash
# Prepares a fresh Ubuntu (22.04/24.04) or Debian (12) VPS to host Corin
# Commercial, and any other sites added later. Safe to run again: every step
# checks what is already there. Run as root from the folder holding ops/vps:
#
#   SSH_PORT=22 bash setup.sh
#
# What it does:
# - Updates the system and installs security updates automatically.
# - Adds a 4 GB swap file.
# - Firewall: only SSH, HTTP and HTTPS are open. fail2ban guards SSH.
# - Node.js 22, nginx and certbot.
# - A locked-down `corin` user runs the app under systemd.
# - Generates the app's own secrets once, in /etc/corin/generated.env.
# - Scheduled jobs run from /etc/cron.d/corin.
#
# Password logins are left as they are; `harden.sh` switches SSH to keys only.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_PORT="${SSH_PORT:-22}"
APP_USER=corin
APP_DIR=/srv/corin
ETC=/etc/corin
LIB=/usr/local/lib/corin

log() { printf '\n==> %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run this as root." >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu | debian) ;;
  *) echo "Unsupported system: ${PRETTY_NAME:-unknown}. Use Ubuntu 22.04/24.04 or Debian 12." >&2; exit 1 ;;
esac
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || { echo "SSH_PORT must be a number." >&2; exit 1; }

log "System packages ($PRETTY_NAME, $(uname -m))"
apt-get update -y
apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg openssl rsync jq tar gzip \
  ufw fail2ban unattended-upgrades \
  nginx certbot python3-certbot-nginx
timedatectl set-timezone UTC 2>/dev/null || true

log "Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

log "Swap"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon --show

log "Firewall (SSH port $SSH_PORT, HTTP, HTTPS)"
ufw allow "$SSH_PORT/tcp" comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ufw status verbose
systemctl enable --now fail2ban

log "Node.js 22"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v22\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
node -v

log "App user, folders and secrets"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o root -g root -m 0755 "$APP_DIR" "$APP_DIR/releases"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR/shared" "$APP_DIR/shared/cache"
install -d -o root -g "$APP_USER" -m 0750 "$ETC"
if [ ! -s "$ETC/generated.env" ]; then
  (
    umask 077
    for key in AUTH_COOKIE_SECRET LEAD_TOKEN_SECRET CRON_SECRET PORTAL_SESSION_SECRET IP_HASH_SALT; do
      echo "$key=$(openssl rand -hex 32)"
    done > "$ETC/generated.env"
  )
fi
chown root:"$APP_USER" "$ETC/generated.env"
chmod 0640 "$ETC/generated.env"
# app.env holds settings you provide (the CORIN_ENV GitHub secret is written here on each deploy).
[ -f "$ETC/app.env" ] || install -o root -g "$APP_USER" -m 0640 /dev/null "$ETC/app.env"

log "Helper scripts"
install -d -m 0755 "$LIB"
install -m 0755 "$SRC/release.sh" "$LIB/release.sh"
install -m 0755 "$SRC/tls.sh" "$LIB/tls.sh"
install -m 0755 "$SRC/harden.sh" "$LIB/harden.sh"
install -m 0755 "$SRC/inspect.sh" "$LIB/inspect.sh"
install -m 0755 "$SRC/corin-cron" /usr/local/bin/corin-cron
ln -sfn "$LIB/release.sh" /usr/local/bin/corin-release
ln -sfn "$LIB/tls.sh" /usr/local/bin/corin-tls

log "systemd service"
install -m 0644 "$SRC/corin.service" /etc/systemd/system/corin.service
systemctl daemon-reload
systemctl enable corin.service
if [ -e "$APP_DIR/current" ]; then systemctl restart corin.service; else echo "No release yet: the service starts on the first deploy."; fi

log "nginx"
install -m 0644 "$SRC/nginx-corin.conf" /etc/nginx/sites-available/corin.conf
ln -sfn /etc/nginx/sites-available/corin.conf /etc/nginx/sites-enabled/corin.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

log "Scheduled jobs"
install -m 0644 "$SRC/cron.d-corin" /etc/cron.d/corin
systemctl restart cron 2>/dev/null || true

log "Done"
echo "Server is ready. Deploy the app next (task: deploy)."
