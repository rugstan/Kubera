# Runbooks

Operational procedures for Corin Commercial. Owned by the Platform workstream. Anything marked **VERIFY** is a fact that changes outside this repo (vendor UI, statute, dashboard defaults); confirm it at the source before relying on it, and update the page with the as-of date.

| Runbook | Use it when |
| --- | --- |
| [deploy-and-rollback.md](./deploy-and-rollback.md) | Shipping to production, or a release is misbehaving and needs to be reverted. |
| [environments.md](./environments.md) | Setting up or auditing staging versus production (Supabase, Twenty, Vercel, vendors). |
| [incident-response.md](./incident-response.md) | Anything that looks like an outage, data exposure, or compromised credential, including California breach notification. |
| [dns-email.md](./dns-email.md) | Creating or changing DNS: Zoho Mail, Resend subdomains, SPF/DKIM/DMARC, and the no-mail `kubera.loans` domain. |
| [vendor-mfa-checklist.md](./vendor-mfa-checklist.md) | Onboarding a vendor account, quarterly access review, or offboarding a person. |
| [document-vault-backup-restore.md](./document-vault-backup-restore.md) | Backing up the document vault, restoring a deleted or corrupted file, or rehearsing a restore. |
| [workflows-and-messaging.md](./workflows-and-messaging.md) | Turning on Inngest workflows, inbound Zoho Mail, Langfuse tracing, Telnyx SMS, the construction CSLB lookup, or the Phase 2 crons. |

## Ground rules that apply to every runbook

- Corin is a broker. No runbook step may involve receiving, holding or moving borrower, investor or draw funds.
- Never paste secrets, borrower documents or personal data into tickets, chat or logs. Reference the record id instead.
- Every outbound message to a borrower, lender or regulator during an incident goes through a broker (the approval gate applies to humans and agents alike).
- Record what you did and when. During an incident, keep a running timeline in the incident ticket; it becomes the post-incident review.
