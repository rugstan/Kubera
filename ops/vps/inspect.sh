#!/usr/bin/env bash
# Read-only health report for the VPS. Changes nothing.
set -uo pipefail

section() { printf '\n== %s\n' "$*"; }
version() { command -v "$1" >/dev/null 2>&1 && { "$@" 2>&1 | head -n 1; } || echo "not installed"; }

section "System"
# shellcheck disable=SC1091
. /etc/os-release 2>/dev/null
echo "${PRETTY_NAME:-unknown} on $(uname -m), kernel $(uname -r)"
echo "Host: $(hostname)  Up: $(uptime -p 2>/dev/null || uptime)  Time zone: $(cat /etc/timezone 2>/dev/null || date +%Z)"

section "CPU, memory, disk"
echo "CPUs: $(nproc)"
free -h
df -h / /srv 2>/dev/null | awk '!seen[$0]++'
swapon --show 2>/dev/null || true

section "Network"
ip -4 -brief addr 2>/dev/null | grep -v '^lo' || true
echo "Public IPv4: $(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || echo unknown)"
echo "Listening:"; ss -tlnp 2>/dev/null | awk 'NR==1 || /LISTEN/' | head -n 25

section "Software"
printf '%-10s %s\n' node "$(version node -v)" nginx "$(version nginx -v)" certbot "$(version certbot --version)" ufw "$(version ufw version)" fail2ban "$(version fail2ban-client --version)"

section "Firewall"
ufw status verbose 2>/dev/null || echo "ufw not installed"

section "SSH"
sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication) ' || true
echo "Keys for root: $(grep -c -E '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys 2>/dev/null || echo 0)"

section "Corin"
echo "Service: $(systemctl is-active corin 2>/dev/null || echo absent)"
echo "Live release: $(cat /srv/corin/RELEASE 2>/dev/null || echo none)"
ls -1t /srv/corin/releases 2>/dev/null | head -n 5
if systemctl is-active --quiet corin 2>/dev/null; then
  echo "Local check: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: corincommercial.com' http://127.0.0.1:3000/)"
fi
echo "Settings files:"; ls -l /etc/corin 2>/dev/null || echo "  none"

section "Web server"
ls -1 /etc/nginx/sites-enabled 2>/dev/null || echo "nginx not installed"
certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry' || echo "No certificates yet."

section "Updates"
echo "Packages waiting for an upgrade: $(apt list --upgradable 2>/dev/null | tail -n +2 | wc -l)"
[ -f /var/run/reboot-required ] && echo "A reboot is required." || echo "No reboot needed."
