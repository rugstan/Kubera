# DNS and email authentication

Two domains, two postures:

| Domain | Purpose | Mail |
| --- | --- | --- |
| `corincommercial.com` | Full site, advisor mailboxes (Mailflare, inbound through Cloudflare Email Routing), transactional sending (`notify.`, Cloudflare Email Service), newsletter (`news.`, Resend, off until turned on) | Sends and receives |
| `kubera.loans` | 60-second qualifier only | **Sends no mail.** Null SPF, DMARC reject |

Changed 2026-11-03 (owner decision): mailboxes moved from Zoho Mail to Mailflare, and transactional sending from Resend to Cloudflare Email Service. Zoho Sign is unaffected. `corincommercial.com`'s DNS is on Cloudflare.

All values below are templates. Cloudflare and Resend generate account-specific records; always copy the exact values from their dashboards. **VERIFY** record names against the vendor docs on the day you configure them, and note the date. Do not publish mail records while someone else is mid-way through the mail setup; agree who changes the zone first.

## corincommercial.com (mailboxes on Mailflare)

Mailflare (self-hosted, github.com/hieunc229/mailflare) runs on Cloudflare. Inbound mail reaches it through **Cloudflare Email Routing**, which hands each message to the Mailflare Worker; follow Mailflare's own deployment docs for the Worker, its storage and its outbound (advisor) sending path, and note the version deployed (the app's connector was written against v0.5.4).

1. Deploy Mailflare and create the mailboxes and aliases in `docs/BUILD_PLAN.md` (Reference, Mailboxes). `dmarc@` is an alias of `admin@`; it must exist before the `rua` address starts receiving reports.
2. In the Cloudflare dashboard, enable **Email Routing** on `corincommercial.com`. Cloudflare offers to add its MX and SPF records; accept them, and remove any other MX records first. Typically:

| Type | Name | Value | Notes |
| --- | --- | --- | --- |
| MX | `@` | `route1.mx.cloudflare.net` (and `route2`, `route3`) | Priorities as Cloudflare sets them; **VERIFY** in the dashboard |
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | Single SPF record for the apex. If Mailflare's outbound path needs another `include:`, merge it into this one record |
| TXT | `<selector>._domainkey` | DKIM key for the apex | Whatever signs advisor mail sent as `@corincommercial.com` (Mailflare's outbound path); exact name and value from that setup |
| TXT | `_dmarc` | see "DMARC ramp" | |

3. Route the addresses (or a catch-all) to the Mailflare Worker as Mailflare's docs describe. Every message then carries an `Authentication-Results` header from `mx.cloudflare.net`; the app trusts only that one (`MAILFLARE_TRUSTED_AUTHSERV_IDS`), because senders can write their own.
4. For the app's inbound pipeline, create a Mailflare API key with the `jmap` scope for the polled mailboxes (deals@, docs@, lenders@, vendors@, closing@), or one key per mailbox, and set `MAILFLARE_URL` and `MAILFLARE_JMAP_KEY[_<MAILBOX>]` (`.env.example`). The connector only issues read methods.

There is no IMAP: the Twenty sync over IMAP planned for Zoho Mail cannot connect to Mailflare (BUILD_PLAN, Mailboxes).

Rules:

- Exactly **one** SPF TXT record per name. Two records break SPF. Keep the lookup count at 10 or fewer.
- Do not add the `notify.` or `news.` senders to the apex SPF record; they send from their own subdomains (below).
- Send a test message from an advisor mailbox and read the headers (`dkim=pass`, `spf=pass`, `dmarc=pass`).

## Transactional sending (Cloudflare Email Service)

Use a **separate sending subdomain** so a reputation problem there cannot affect advisor mail:

- `notify.corincommercial.com`: transactional (lead confirmations, document requests, milestone updates, document reminders, staff alerts, approved lender submissions and notices, invoices). Sender `notifications@notify.corincommercial.com`, reply-to `deals@corincommercial.com`.

In the Cloudflare dashboard, onboard `notify.corincommercial.com` as a sending domain under **Email Sending** and publish exactly the records it shows (SPF/return-path, DKIM, and any verification record). Wait for it to show as ready before sending: until then the API answers 409 ("setup still in progress") and the app records the send as failed and retryable.

Then create an API token that can only send email for this account, and set `CLOUDFLARE_EMAIL_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_TOKEN` on the server (optional `EMAIL_FROM`, `EMAIL_PROVIDER=cloudflare`). Staff sign-in codes go out through the same service over SMTP (`smtp.mx.cloudflare.net:465`), configured in GoTrue on the server rather than in the app.

Cloudflare Email Service is **transactional only**: its terms limit it to mail answering a specific customer interaction and bar marketing and unsolicited messages. So:

- The newsletter and cold prospect outreach never use it; the app sends those only through Resend (`resendEmailClientFromEnv`), and they stay off without `RESEND_API_KEY`.
- It takes no idempotency key. A send that times out may already have been delivered, so the app records it as "delivery unknown" (notifications: `send_unknown`; chasers: reason `delivery_unknown`), never resends it automatically, and alerts staff to check the Email Sending activity log before sending it again by hand.

## Newsletter sending (Resend, off until turned on)

- `news.corincommercial.com`: newsletter via Resend Broadcasts. Sender `updates@news.corincommercial.com`.

When the newsletter is turned on, add the domain in the Resend dashboard and publish exactly the records it shows. Typically:

| Type | Name (relative to the sending domain) | Purpose |
| --- | --- | --- |
| TXT or CNAME | `resend._domainkey` | DKIM public key |
| MX | `send` | Bounce and feedback handling (priority 10) |
| TXT | `send` | SPF for the return-path (`v=spf1 include:amazonses.com ~all`) |

Then confirm **Verified** in Resend before sending. Because these are subdomains, DMARC alignment is evaluated against the organizational domain's `_dmarc` policy unless you publish a subdomain-specific record.

Newsletter specifics: add a working unsubscribe link and the physical address in every email; keep consent records in the consent ledger (double opt-in).

## DMARC ramp (corincommercial.com)

Never start at reject. Ramp over about 6 to 8 weeks, reading the aggregate reports at each step to confirm every legitimate sender passes:

1. Week 0: `v=DMARC1; p=none; rua=mailto:dmarc@corincommercial.com; adkim=r; aspf=r; fo=1`
2. After clean reports: `p=quarantine; pct=25`, then `pct=50`, then `pct=100`
3. Steady state: `v=DMARC1; p=reject; sp=reject; rua=mailto:dmarc@corincommercial.com; adkim=s; aspf=s`

Set `adkim=s; aspf=s` only after confirming advisor mail (Mailflare's outbound path), `notify.` (Cloudflare Email Sending) and, once it is on, `news.` (Resend) all align strictly; otherwise keep relaxed.

## kubera.loans: no mail, spoof-proof

The domain must never be usable to impersonate Corin or to send mail. Publish:

| Type | Name | Value | Purpose |
| --- | --- | --- | --- |
| MX | `@` | `0 .` | Null MX (RFC 7505): says the domain accepts no mail |
| TXT | `@` | `v=spf1 -all` | Null SPF: no host may send as this domain |
| TXT | `*` | `v=spf1 -all` | Null SPF for every subdomain |
| TXT | `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@corincommercial.com` | Reject anything that claims this domain |
| TXT | `*._domainkey` | `v=DKIM1; p=` | Empty key: declares there are no valid DKIM keys |

Because the DMARC `rua` address is in a different domain, authorize report delivery by publishing, on **corincommercial.com**:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `kubera.loans._report._dmarc` | `v=DMARC1` |

Do not create mailboxes, forwarding, or web-form email on `kubera.loans`. The site there sends no mail by design (BUILD_PLAN: `kubera.loans` sends no mail).

## Web records and hardening

- Apex and `www` for both domains point at the production host: the Contabo server (A/AAAA records, `docs/runbooks/vps.md`), or the Vercel project while it still serves (A or CNAME as Vercel instructs in **Settings, Domains**). Both `kubera.loans` names go to the same app; `proxy.ts` routes them to the qualifier.
- Add a CAA record restricting issuance to the CAs actually in use: Let's Encrypt (`0 issue "letsencrypt.org"`) for certbot on the server or for Vercel, plus Cloudflare's edge CAs if the records are proxied through Cloudflare. **VERIFY** against the current certificate docs before adding, or you can block certificate renewal.
- Registrar: registrar lock on, auto-renew on, WHOIS privacy on, MFA on the registrar account, and a second admin. See [vendor-mfa-checklist.md](./vendor-mfa-checklist.md).
- Optional later: MTA-STS and TLS-RPT for `corincommercial.com`; DNSSEC at the registrar if the DNS host supports it.

## Verification checklist

Run after any DNS change; record results in the change ticket.

- [ ] `dig +short MX corincommercial.com` returns only the Cloudflare Email Routing hosts.
- [ ] `dig +short TXT corincommercial.com` shows exactly one `v=spf1` record.
- [ ] `dig +short TXT <selector>._domainkey.corincommercial.com` returns the public key for advisor mail.
- [ ] `dig +short TXT _dmarc.corincommercial.com` shows the intended policy for the current ramp step.
- [ ] A message from an advisor mailbox to an external account shows SPF, DKIM and DMARC **pass**.
- [ ] A test from `notifications@notify.corincommercial.com` (and, once the newsletter is on, from `updates@news.corincommercial.com`) shows SPF, DKIM and DMARC **pass**.
- [ ] A message sent to `deals@` from an external account arrives in Mailflare and shows `Authentication-Results: mx.cloudflare.net; … dmarc=pass`.
- [ ] `dig +short MX kubera.loans` returns `0 .`; `dig +short TXT kubera.loans` returns `"v=spf1 -all"`; `dig +short TXT _dmarc.kubera.loans` shows `p=reject`.
- [ ] `dig +short TXT kubera.loans._report._dmarc.corincommercial.com` returns `"v=DMARC1"`.
- [ ] Aggregate reports arrive at `dmarc@` and show only expected senders.
