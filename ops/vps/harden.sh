#!/usr/bin/env bash
# Switches SSH to key-only logins (no passwords) and keeps root to keys only.
# Run this only after everyone who needs SSH has a key on the server; anyone
# who logs in with a password today is locked out afterwards. The provider's
# web console still works for recovery. Run as root.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run this as root." >&2; exit 1; }
keys="$(grep -c -E '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys 2>/dev/null || echo 0)"
[ "$keys" -ge 1 ] || { echo "No key in /root/.ssh/authorized_keys; refusing to turn off passwords." >&2; exit 1; }

cat > /etc/ssh/sshd_config.d/10-corin-hardening.conf <<'EOF'
# Managed by ops/vps/harden.sh
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 4
EOF
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "SSH now accepts keys only ($keys key(s) authorized for root)."
sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication) '
