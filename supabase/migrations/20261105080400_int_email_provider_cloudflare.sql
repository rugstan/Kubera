-- Transactional email can go out through Cloudflare Email Service as well as
-- Resend. lib/notify/email/cloudflare.ts reports provider = 'cloudflare'; the
-- provider is chosen from env in lib/notify/email/index.ts. Rows already stored
-- keep their value.
--
-- Cloudflare takes no idempotency key, so an outreach email whose send timed
-- out may already have been delivered. lib/agents/outreach/sender.ts records it
-- as failed with reason_code 'delivery_unknown' and never resends it
-- automatically (notifications use status 'send_unknown' for the same case).

alter table public.notifications drop constraint if exists notifications_provider_check;
alter table public.notifications
  add constraint notifications_provider_check check (provider is null or provider in ('resend', 'cloudflare', 'telnyx', 'fake'));

alter table public.outreach_messages drop constraint if exists outreach_messages_provider_check;
alter table public.outreach_messages
  add constraint outreach_messages_provider_check check (provider is null or provider in ('resend', 'cloudflare', 'telnyx', 'fake'));

alter table public.outreach_messages drop constraint if exists outreach_messages_reason_code_check;
alter table public.outreach_messages add constraint outreach_messages_reason_code_check check (reason_code is null or reason_code in (
  'sent', 'no_consent', 'consent_revoked', 'consent_lookup_failed', 'outside_texting_window',
  'provider_unconfigured', 'approval_pending', 'approval_rejected', 'approval_expired',
  'send_failed', 'delivery_unknown', 'invalid_recipient', 'invalid_template_data', 'duplicate'
));
