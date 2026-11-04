-- Final fixes round 5 (data integrations): 'undelivered' for carrier delivery receipts.
--
-- A Telnyx delivery_failed / sending_failed receipt used to set
-- notifications.status = 'failed', which the Notifier (lib/notify/service.ts)
-- treats as retryable, so the every-minute Tier-1 sweep re-texted a number that
-- cannot receive texts on every run (each send billed by Telnyx). A carrier
-- receipt is now recorded as 'undelivered', which is never retried; 'failed'
-- keeps meaning "nothing reached the provider". Same for sms_messages.

alter table public.notifications drop constraint if exists notifications_status_check;
alter table public.notifications add constraint notifications_status_check check (status in (
  'queued', 'pending_approval', 'sent', 'delivered', 'failed', 'send_unknown', 'undelivered',
  'skipped_no_consent', 'skipped_unconfigured', 'deferred_quiet_hours', 'rejected', 'expired'
));

alter table public.sms_messages drop constraint if exists sms_messages_status_check;
alter table public.sms_messages add constraint sms_messages_status_check check (status in (
  'queued', 'sent', 'delivered', 'failed', 'undelivered', 'received'
));

-- Existing carrier failures: a send-time failure never has a provider message
-- id, so a failed text that has one came from a delivery receipt. Move those
-- out of the retry loop.
update public.notifications set status = 'undelivered'
  where channel = 'sms' and status = 'failed' and provider_message_id is not null;
update public.sms_messages set status = 'undelivered'
  where direction = 'outbound' and status = 'failed' and provider_message_id is not null;
