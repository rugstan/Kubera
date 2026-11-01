-- Final fixes round 4 (data integrations): notifications.status 'send_unknown'.
--
-- Telnyx /v2/messages takes no idempotency key. When a text's provider call
-- times out, hits a network error or gets a 5xx, Telnyx may already have
-- accepted it, so the Notifier (lib/notify/service.ts) records 'send_unknown'
-- instead of the retryable 'failed' and alerts staff. A later call with the same
-- idempotency key never sends it again.

alter table public.notifications drop constraint if exists notifications_status_check;
alter table public.notifications add constraint notifications_status_check check (status in (
  'queued', 'pending_approval', 'sent', 'delivered', 'failed', 'send_unknown',
  'skipped_no_consent', 'skipped_unconfigured', 'deferred_quiet_hours', 'rejected', 'expired'
));

-- Staff review texts with unknown delivery; keep that lookup cheap.
create index notifications_send_unknown_idx on public.notifications (created_at desc) where status = 'send_unknown';
