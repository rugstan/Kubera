# VPS hosting

Corin Commercial runs on a VPS (Ubuntu 22.04/24.04 or Debian 12). GitHub's runners open the SSH
connection: the workflow `.github/workflows/vps.yml` runs the scripts in `ops/vps/` on the server, and every
run is logged in the Actions tab.

## One-time access setup (owner)

1. **Create a key for GitHub on the server.** Log in as root, either from your computer
   (`ssh root@<server-ip>`, with the password from the provider's email) or through the provider's web
   console. Then paste this. It makes a key, lets it log in, prints the private half once, and deletes it
   from the server:

   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh && \
   ssh-keygen -t ed25519 -N "" -C github-actions-vps -f /tmp/gh_vps -q && \
   cat /tmp/gh_vps.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && \
   echo "----- copy everything below, including the BEGIN and END lines -----" && \
   cat /tmp/gh_vps && rm -f /tmp/gh_vps /tmp/gh_vps.pub
   ```

2. **Add two repository secrets.** In GitHub, open the repo, then **Settings → Secrets and variables →
   Actions → New repository secret**:
   - `VPS_HOST`: the server's IP address.
   - `VPS_SSH_KEY`: the private key printed above, including the BEGIN and END lines.

   Optional secrets:
   - `VPS_PORT`, if SSH is not on port 22.
   - `VPS_USER`, if not root. That user needs passwordless sudo.
   - `VPS_KNOWN_HOSTS`, to pin the host key. The first run prints the value to save.

## Tasks

Run a task from **Actions → VPS → Run workflow**. That button appears once the workflow is on the default
branch. You can also push an annotated tag `vps/<task>/<label>`; for `run` and `tls`, the tag message is the
argument:

```bash
git tag -a vps/run/disk-$(date +%s) -m "df -h" && git push origin vps/run/disk-$(date +%s)
```

| Task | What it does |
|---|---|
| `inspect` | Read-only report: OS, memory, disk, firewall, SSH, services, releases, certificates. |
| `setup` | `ops/vps/setup.sh`, which is safe to run again. It covers updates, swap, firewall (22/80/443), fail2ban, Node 22, nginx, certbot, the `corin` user and systemd service, generated secrets and scheduled jobs. |
| `deploy` | Builds this commit as a Next.js standalone server, ships it, switches to it, and checks it answers. It rolls back automatically if not. The five newest releases are kept. |
| `rollback` | Back to the previous release. |
| `status` | The live release and the service status. |
| `run` | Any shell command, as root. |
| `tls` | Let's Encrypt HTTPS for domains whose DNS points at the server. Default: all four domains. Add `email=you@example.com` for expiry notices. Certificates renew automatically. |
| `harden` | SSH keys only, no passwords. Run it only once everyone who needs SSH has a key. |

Pushes to `main` deploy automatically when the repository variable `VPS_DEPLOY_ON_PUSH` is `true`.

## Settings

- `/etc/corin/generated.env` holds `AUTH_COOKIE_SECRET`, `LEAD_TOKEN_SECRET`, `CRON_SECRET`,
  `PORTAL_SESSION_SECRET` and `IP_HASH_SALT`. They are generated once on the server and never leave it.
- `/etc/corin/app.env` holds your settings (Supabase, Resend, Telnyx, Zoho, Twenty, Inngest, Sentry and so
  on; see `docs/runbooks/environments.md`). Put them in the `CORIN_ENV` secret in `.env` format; each deploy
  writes them here. Values here override the generated ones.
- Build-time public settings (`NEXT_PUBLIC_*`) go in the `CORIN_BUILD_ENV` secret.

The service runs with `DEPLOY_ENV=production`, so the demo sign-in (`AUTH_PROVIDER=fake`) is refused. Staff
sign-in needs Supabase.

## Layout on the server

- `/srv/corin/releases/<id>` holds the releases, and `/srv/corin/current` points to the live one.
- The `corin.service` systemd unit runs `node server.js` on port 3000. Logs: `journalctl -u corin`.
- nginx (`/etc/nginx/sites-available/corin.conf`) serves corincommercial.com, kubera.loans and the bare IP,
  and proxies to the app.
- Scheduled jobs are in `/etc/cron.d/corin`. Logs: `journalctl -t corin-cron`.

## Moving the domains

1. Deploy, then open `http://<server-ip>/` to check the site.
2. At the domain registrar, point the A records for `corincommercial.com`, `www.corincommercial.com`,
   `kubera.loans` and `www.kubera.loans` at the server IP. If there are AAAA records, update them to the
   server's IPv6 address or remove them.
3. Once DNS has updated, run the `tls` task.

## Adding another site

Add a site's nginx file under `/etc/nginx/sites-available/<site>.conf`, enable it, and run `tls` for its
domains. Each app gets its own systemd service and port.
