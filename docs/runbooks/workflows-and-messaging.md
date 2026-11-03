# Workflows and messaging

Turning on the Phase 2 background services. Every one of them is env-gated: with its variables empty the feature reports "not configured" and nothing is sent. Anything marked **VERIFY** depends on a vendor dashboard; confirm it there and note the as-of date.

All outbound messages still go through the broker approval queue (`/approvals`). Nothing here changes that.

## Inngest (workflows)

1. Create the Inngest app and copy `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` into Vercel (Production and Preview get different keys). Leave `INNGEST_DEV` empty outside local development.
2. Deploy, then sync the app in the Inngest dashboard with the URL `https://<host>/api/inngest`. **VERIFY** the sync shows the approval, outbound and inbound-mail functions.
3. Without the keys `/api/inngest` answers 503 and approval-decided events are dropped; workflows then fall back to their 30-minute gate poll.

## Inbound mail (Mailflare, or Zoho Mail)

`MAIL_PROVIDER` picks the connector (`mailflare` or `zoho`); unset, it uses Mailflare when `MAILFLARE_URL` and a key are set, else Zoho Mail when it is configured. Both connectors are read-only. Polling also needs the Inngest keys above.

**Mailflare** (the mailboxes for `corincommercial.com`, see `dns-email.md`):

1. Set `MAILFLARE_URL` to the Mailflare origin (https only; never a path or credentials).
2. Create an API key with the `jmap` scope in Mailflare. `MAILFLARE_JMAP_KEY` serves every polled mailbox (deals@, docs@, lenders@, vendors@, closing@); a per-mailbox `MAILFLARE_JMAP_KEY_<MAILBOX>` overrides it. A `jmap` key could also send, move and delete mail, so limit each key to the mailboxes it needs; the connector itself only issues `Mailbox/get`, `Email/query`, `Email/get` and blob downloads.
3. Leave `MAILFLARE_TRUSTED_AUTHSERV_IDS` empty unless the receiving hop in front of Mailflare is not Cloudflare Email Routing (`mx.cloudflare.net`). Only `Authentication-Results` headers from those hosts count toward the DMARC verdict.
4. **VERIFY** against the deployed Mailflare version: the connector was written against v0.5.4 and has only been tested against a fake, not a live server.
5. There is no IMAP on Mailflare, so the Twenty mailbox sync (IMAP) is unavailable; see BUILD_PLAN, Mailboxes.

**Zoho Mail** (kept for a deployment still on Zoho):

1. In the Zoho API console create a server-based OAuth client for the Zoho data centre the mail lives in (`ZOHO_MAIL_DC`). Set `ZOHO_MAIL_CLIENT_ID` and `ZOHO_MAIL_CLIENT_SECRET`.
2. Generate a refresh token with the read-only scopes `ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ` (**VERIFY** in the Zoho console). `ZOHO_MAIL_REFRESH_TOKEN` serves every mailbox; a per-mailbox `ZOHO_MAIL_REFRESH_TOKEN_<MAILBOX>` (minted while signed in as deals@, docs@, lenders@, vendors@ or closing@) overrides it. `ZOHO_MAIL_ACCOUNT_ID_<MAILBOX>` is optional and looked up by address when empty.

For either: set `MAIL_DOMAIN` (default `corincommercial.com`). Attachments land in the `deal-documents-quarantine` bucket and are scanned before anyone can open them.

## Langfuse (tracing)

Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`; `LANGFUSE_BASE_URL` defaults to the US cloud. Tracing sends metadata only. Keep `LANGFUSE_CAPTURE_CONTENT` empty unless counsel has approved sending prompt and response text (PII is redacted first) to the tracing vendor.

## Email (Cloudflare Email Service) and Telnyx (SMS)

1. Set `CLOUDFLARE_EMAIL_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_TOKEN` (and optionally `EMAIL_FROM`, `EMAIL_PROVIDER=cloudflare`) once `notify.corincommercial.com` is ready under Email Sending (`dns-email.md`). `EMAIL_PROVIDER=resend` with `RESEND_*` switches transactional email back to Resend. The newsletter and prospect outreach only ever use Resend and stay off without `RESEND_API_KEY`.
2. Cloudflare takes no idempotency key. A send that times out or gets an unreadable answer is recorded as delivery unknown and never resent automatically; staff in `NOTIFY_STAFF_EMAILS` get an alert to check the Email Sending activity log. A refusal Cloudflare documents as "no email was sent" (for example 429 throttled, or 409 while setup is in progress) stays retryable.
3. Set the `TELNYX_*` variables from `.env.example`.
4. In the Telnyx messaging profile, turn **off** the automatic STOP/HELP replies (Corin answers them and records the opt-out in the consent ledger), point the webhook URL at `https://<host>/api/webhooks/telnyx`, and set `TELNYX_PUBLIC_KEY` so webhook signatures verify. **VERIFY** all three after every profile change.
5. Send a test SMS to a staff phone, reply STOP, and confirm the reply and the consent-ledger row. Send a test lead confirmation to a staff address and confirm the notification row shows provider `cloudflare` and a message id.

## Construction desk CSLB lookup

`CSLB_LOOKUP_ENABLED=true` turns on the public CSLB license lookup; leave it empty to verify contractor licenses by hand. `CSLB_LOOKUP_BASE_URL` is only for tests and proxies.

## Crons (Inngest relay + vercel.json)

All cron routes require `Authorization: Bearer $CRON_SECRET`.

Vercel Hobby only accepts once-a-day crons, so `vercel.json` runs every job once a day as a floor and Inngest runs the frequent cadence (`lib/workflows/cron-relay.ts`, served at `/api/inngest`). The relay calls each route handler in-process with the cron bearer, so it needs `CRON_SECRET` and the Inngest keys. On Vercel Pro you can put the original schedules back in `vercel.json` and drop the relay. The schedules below are the relay's; `/api/notify/sweep` and `/api/documents/scan` run every 5 minutes there instead of every minute.

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/notify/sweep` | every minute | Backstop for Tier-1 broker alerts missed in-request. |
| `/api/documents/scan` | every minute | Finalizes abandoned uploads and scans quarantined documents. Use every 5 minutes on plans that limit cron frequency, or run `npm run scan:worker` in a container. |
| `/api/cron/approvals-expire` | every 15 minutes | Marks pending approvals past their deadline as expired. Expiry is also enforced on every read. |
