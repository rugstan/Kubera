# Vendor account MFA and access checklist

Every vendor account that can reach production data, send messages as Kubera, or move DNS must meet this bar. Review quarterly and on every staffing change.

## Baseline for every vendor

- [ ] **MFA enforced for all users** at the organization level wherever the vendor supports enforcement; otherwise each user has it on and the owner verifies.
- [ ] Prefer **passkeys or hardware security keys**; authenticator-app TOTP is the fallback. **No SMS-only MFA** for owners or admins.
- [ ] **At least two owners/admins** (so one lost device never locks the company out), neither using a shared mailbox login.
- [ ] Named, individual accounts only. No shared logins. Service access uses scoped API keys or tokens.
- [ ] Recovery codes generated and stored in the company password manager (vault with restricted access), not in email or chat.
- [ ] Roles follow least privilege: day-to-day users are not owners.
- [ ] API keys are scoped to the minimum permission, stored only in Vercel environment variables (per environment), and have an owner and a rotation date.
- [ ] Audit log or activity log exists and someone knows how to export it.
- [ ] SSO is used where available (and where it is, local passwords for non-owner users are disabled).

## Vendor register

Fill in the owner and last-review date. "Blast radius" says why the account matters.

| Vendor | Blast radius | Specific controls | Owner | Last review |
| --- | --- | --- | --- | --- |
| Domain registrar and DNS | Redirect the whole company, hijack mail | Registrar lock, MFA with hardware key, auto-renew, no email-based recovery to a mailbox on the same domain | | |
| GitHub | Source code, CI, deploy trigger | Org-wide MFA requirement, branch protection on `main`, required CI checks, no force-push, Dependabot alerts on, secret scanning and push protection on | | |
| Vercel | Production hosting, env vars, firewall, rollbacks | Team MFA, production env var access limited to owners, Preview env vars never hold production secrets, deployment protection on previews | | |
| Supabase | Borrower data, vault, service-role key | Org MFA, separate production and staging projects, service-role key only in Vercel, network restrictions where available, point-in-time recovery on | | |
| Twenty CRM | Borrower and partner relationships | Separate production and staging workspaces, API keys per environment, admin role limited, webhook secret rotated | | |
| Zoho (Mail, Sign, CRM if used) | Mailboxes, signed disclosures | Org-wide MFA, admin console limited to owners, mailbox app passwords reviewed, OAuth client scoped, Sign API credentials per environment | | |
| Resend | Sending as `notify.` and `news.` | MFA, API keys per environment and per domain, sending domains verified | | |
| Telnyx | SMS and voice, 10DLC registration | MFA, API keys scoped, webhook signing key set, messaging profile restricted to the registered campaign | | |
| Cloudflare (Turnstile, and DNS if used) | Bot protection, possibly DNS | MFA with hardware key, API tokens scoped to zone, Turnstile secret per environment | | |
| Upstash Redis | Rate limiting state | MFA, separate databases per environment, TLS only | | |
| Sentry | Error data (PII-scrubbed) | MFA/SSO, member roles least privilege, data scrubbing server-side rules enabled in addition to the app's `beforeSend` | | |
| Anthropic Console | Model spend, prompts | MFA, separate workspaces/keys for production and staging, spend limits, no borrower data in test prompts | | |
| NVIDIA / xAI / other model providers | Model spend; xAI must never receive borrower data | MFA, spend limits, keys per environment | | |
| Langfuse | Traces (can contain prompts) | MFA, project per environment, PII masking on, retention set | | |
| Inngest | Workflow execution | MFA, signing key per environment, event keys scoped | | |
| Cal.com | Scheduling, calendar access | MFA, minimal calendar scopes | | |
| Password manager | Everything | MFA with hardware key, emergency access configured, offboarding procedure | | |
| Google Workspace or equivalent (if used) | Docs, calendars, recovery email for other tools | Enforced 2-step verification, admin accounts separate from daily accounts | | |

## Onboarding a person

- [ ] Create named accounts with the lowest role that does the job.
- [ ] Enrol a passkey or hardware key; confirm MFA is enforced before first use.
- [ ] Grant production access only if the role needs it; default to staging.
- [ ] Record the grant in the access register.

## Offboarding a person (same day)

- [ ] Remove or disable the account at **every** vendor above; remove GitHub org membership and deploy keys.
- [ ] Revoke sessions and personal API tokens.
- [ ] Rotate shared secrets the person could read (Vercel env vars they had access to, vendor API keys).
- [ ] Transfer ownership of mailboxes, calendars and any saved queries.
- [ ] Remove their device from MFA and password-manager trust lists.
- [ ] Note the removal in the access register.

## Quarterly review

- [ ] List every user per vendor; remove anyone who no longer needs access.
- [ ] Confirm MFA enforcement is still on and no owner uses SMS.
- [ ] Rotate API keys older than 12 months, and any key stored outside Vercel.
- [ ] Check each vendor's audit log for unfamiliar sign-ins, new API keys, and role changes.
- [ ] Re-run the staging versus production audit in [environments.md](./environments.md).
- [ ] Test recovery: confirm a second owner can sign in and recover each critical account.
