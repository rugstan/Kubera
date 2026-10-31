-- Final fixes r2 (data integrations): communications records join the
-- retention schedule, the mail review queue records who resolved a message,
-- and SMS opt-outs that could not reach Twenty are retried.
--
-- 1. Legal hold on mail_messages, sms_messages, notifications and
--    newsletter_subscribers (same columns and delete guard as WS-Y), so the
--    retention engine (lib/privacy/retention.ts) can purge them on schedule
--    and on erasure without ever deleting a held row. Indexes for the scans.
-- 2. mail_messages: a reviewed message names its reviewer and outcome.
-- 3. crm_optout_sync: one row per phone number whose STOP / START has not been
--    written to Twenty `person.smsOptOut` yet (outage, timeout, or no Twenty
--    person yet because the lead push is still pending). The crm-retry cron
--    retries it. The consent ledger stays the source of truth for sending.
--
-- RLS is enabled with no policies: only the service role reads or writes.

-- 1. Legal hold ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['mail_messages', 'sms_messages', 'notifications', 'newsletter_subscribers'] loop
    execute format(
      'alter table public.%I
         add column legal_hold boolean not null default false,
         add column legal_hold_reason text check (legal_hold_reason is null or length(legal_hold_reason) between 1 and 500),
         add column legal_hold_set_at timestamptz,
         add column legal_hold_set_by text check (legal_hold_set_by is null or length(legal_hold_set_by) <= 200),
         add constraint %I check (not legal_hold or (legal_hold_reason is not null and legal_hold_set_at is not null))',
      t, t || '_legal_hold_reason_present');
    execute format('create index %I on public.%I (id) where legal_hold', t || '_legal_hold_idx', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.refuse_delete_on_legal_hold()', t || '_legal_hold_guard', t);
  end loop;
end;
$$;

-- Retention scans and erasure lookups.
create index mail_messages_received_at_idx on public.mail_messages (received_at);
create index mail_messages_from_idx on public.mail_messages (lower(from_address));
create index sms_messages_created_at_idx on public.sms_messages (created_at);
create index sms_messages_lead_idx on public.sms_messages (lead_id) where lead_id is not null;
create index notifications_created_at_idx on public.notifications (created_at);
create index newsletter_subscribers_unsubscribed_idx on public.newsletter_subscribers (unsubscribed_at) where status = 'unsubscribed';

-- 2. Mail review outcome ------------------------------------------------------------------
alter table public.mail_messages
  add column review_outcome text check (review_outcome is null or review_outcome in ('assigned', 'dismissed')),
  add constraint mail_messages_reviewed_complete check ((reviewed_at is null) = (reviewed_by is null) and (reviewed_at is null) = (review_outcome is null));

-- 3. SMS opt-out → Twenty sync queue ---------------------------------------------------------
create table public.crm_optout_sync (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- The state Twenty should show: true after STOP, false after START. The latest change wins.
  opt_out boolean not null,
  status text not null default 'pending' check (status in ('pending', 'synced', 'exhausted')),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  last_attempt_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 1000),
  synced_at timestamptz,
  -- The inbound text that asked for the change.
  sms_message_id uuid references public.sms_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_optout_sync_synced_has_time check (status <> 'synced' or synced_at is not null)
);
create index crm_optout_sync_pending_idx on public.crm_optout_sync (last_attempt_at nulls first) where status = 'pending';
create index crm_optout_sync_updated_idx on public.crm_optout_sync (updated_at) where status <> 'pending';

create trigger crm_optout_sync_touch before update on public.crm_optout_sync
  for each row execute function public.touch_updated_at();

alter table public.crm_optout_sync enable row level security;
revoke all on public.crm_optout_sync from anon, authenticated;
