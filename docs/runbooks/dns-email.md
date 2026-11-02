# DNS and email authentication

Two domains, two postures:

| Domain | Purpose | Mail |
| --- | --- | --- |
| `corincommercial.com` | Full site, advisor mailboxes (Zoho Mail), transactional (`notify.`) and newsletter (`news.`) sending | Sends and receives |
| `kubera.loans` | 60-second qualifier only | **Sends no mail.** Null SPF, DMARC reject |

All values below are templates. Zoho and Resend generate account-specific records; always copy the exact values from their consoles. **VERIFY** record names against the vendor docs on the day you configure them, and note the date.

## corincommercial.com (mailboxes on Zoho Mail)

Use the Zoho data-center region of the account (US shown). Add the domain in Zoho Mail Admin Console, prove ownership, then publish:

| Type | Name | Value | Notes |
| --- | --- | --- | --- |
| TXT | `@` | `zoho-verification=zb########.zmverify.zoho.com` | Domain ownership; exact value from Zoho |
| MX | `@` | `mx.zoho.com` priority 10 | US region |
| MX | `@` | `mx2.zoho.com` priority 20 | |
| MX | `@` | `mx3.zoho.com` priority 50 | |
| TXT | `@` | `v=spf1 include:zohomail.com ~all` | Single SPF record for the domain. Add other legitimate senders here if any send as the apex domain |
| TXT | `<selector>._domainkey` | `v=DKIM1; k=rsa; p=<public key>` | Generate in Zoho (Email Configuration, DKIM); the selector is the name you choose |
| TXT | `_dmarc` | see "DMARC ramp" | |

Mailboxes, groups and sync behavior are defined in `docs/BUILD_PLAN.md` (Reference, Mailboxes). `dmarc@` is a group that delivers to `admin@`; it must exist before the `rua` address starts receiving reports.

Rules:

- Exactly **one** SPF TXT record per name. Two records break SPF. Keep the lookup count at 10 or fewer.
- Do not add Resend to the apex SPF record; Resend sends from subdomains (below).
- Enable DKIM signing in Zoho after the DNS record resolves, then send a test message and read the headers (`dkim=pass`, `spf=pass`, `dmarc=pass`).

## Transactional and newsletter sending (Resend)

Create **separate sending domains** so a reputation problem on one stream cannot affect advisor mail or each other:

- `notify.corincommercial.com`: transactional (lead confirmations, document requests, milestone updates). Sender `notifications@notify.corincommercial.com`, reply-to `deals@corincommercial.com`.
- `news.corincommercial.com`: newsletter via Resend Broadcasts. Sender `updates@news.corincommercial.com`.

For each, add the domain in the Resend dashboard and publish exactly the records it shows. Typically:

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

Set `adkim=s; aspf=s` only after confirming Zoho and both Resend subdomains align strictly; otherwise keep relaxed.

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

- Apex and `www` for both domains point at the Vercel project as shown in **Settings, Domains** (A or CNAME as Vercel instructs). Add both `kubera.loans` and `www.kubera.loans` to the same Vercel project; `proxy.ts` routes them to the qualifier.
- Add a CAA record restricting issuance to the CA Vercel uses (`0 issue "letsencrypt.org"`). **VERIFY** against Vercel's current certificate docs before adding, or you can block certificate renewal.
- Registrar: registrar lock on, auto-renew on, WHOIS privacy on, MFA on the registrar account, and a second admin. See [vendor-mfa-checklist.md](./vendor-mfa-checklist.md).
- Optional later: MTA-STS and TLS-RPT for `corincommercial.com`; DNSSEC at the registrar if the DNS host supports it.

## Verification checklist

Run after any DNS change; record results in the change ticket.

- [ ] `dig +short MX corincommercial.com` returns the three Zoho hosts.
- [ ] `dig +short TXT corincommercial.com` shows exactly one `v=spf1` record.
- [ ] `dig +short TXT <selector>._domainkey.corincommercial.com` returns the Zoho public key.
- [ ] `dig +short TXT _dmarc.corincommercial.com` shows the intended policy for the current ramp step.
- [ ] A message from an advisor mailbox to an external account shows SPF, DKIM and DMARC **pass**.
- [ ] A test from `notifications@notify.corincommercial.com` and from `updates@news.corincommercial.com` shows SPF, DKIM and DMARC **pass**.
- [ ] `dig +short MX kubera.loans` returns `0 .`; `dig +short TXT kubera.loans` returns `"v=spf1 -all"`; `dig +short TXT _dmarc.kubera.loans` shows `p=reject`.
- [ ] `dig +short TXT kubera.loans._report._dmarc.corincommercial.com` returns `"v=DMARC1"`.
- [ ] Aggregate reports arrive at `dmarc@` and show only expected senders.
