# Workflows and messaging

Turning on the Phase 2 background services. Every one of them is env-gated: with its variables empty the feature reports "not configured" and nothing is sent. Anything marked **VERIFY** depends on a vendor dashboard; confirm it there and note the as-of date.

All outbound messages still go through the broker approval queue (`/approvals`). Nothing here changes that.

## Inngest (workflows)

1. Create the Inngest app and copy `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` into Vercel (Production and Preview get different keys). Leave `INNGEST_DEV` empty outside local development.
2. Deploy, then sync the app in the Inngest dashboard with the URL `https://<host>/api/inngest`. **VERIFY** the sync shows the approval, outbound and inbound-mail functions.
3. Without the keys `/api/inngest` answers 503 and approval-decided events are dropped; workflows then fall back to their 30-minute gate poll.

## Zoho Mail (inbound mail)

1. In the Zoho API console create a server-based OAuth client for the Zoho data centre the mail lives in (`ZOHO_MAIL_DC`). Set `ZOHO_MAIL_CLIENT_ID` and `ZOHO_MAIL_CLIENT_SECRET`.
2. Generate a refresh token with the read-only scopes `ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ` (**VERIFY** in the Zoho console). `ZOHO_MAIL_REFRESH_TOKEN` serves every mailbox; a per-mailbox `ZOHO_MAIL_REFRESH_TOKEN_<MAILBOX>` (minted while signed in as deals@, docs@, lenders@, vendors@ or closing@) overrides it. `ZOHO_MAIL_ACCOUNT_ID_<MAILBOX>` is optional and looked up by address when empty.
3. Set `MAIL_DOMAIN` (default `corincommercial.com`). Attachments land in the `deal-documents-quarantine` bucket and are scanned before anyone can open them.

## Langfuse (tracing)

Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`; `LANGFUSE_BASE_URL` defaults to the US cloud. Tracing sends metadata only. Keep `LANGFUSE_CAPTURE_CONTENT` empty unless counsel has approved sending prompt and response text (PII is redacted first) to the tracing vendor.

## Telnyx (SMS) and Resend (email)

1. Set the `RESEND_*` and `TELNYX_*` variables from `.env.example`.
2. In the Telnyx messaging profile, turn **off** the automatic STOP/HELP replies (Corin answers them and records the opt-out in the consent ledger), point the webhook URL at `https://<host>/api/webhooks/telnyx`, and set `TELNYX_PUBLIC_KEY` so webhook signatures verify. **VERIFY** all three after every profile change.
3. Send a test SMS to a staff phone, reply STOP, and confirm the reply and the consent-ledger row.

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
