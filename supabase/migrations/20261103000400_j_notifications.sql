-- WS-J · Notifications: outbound email/SMS log and the SMS message ledger.
--
-- notifications  one row per attempted email or text (any audience). The
--                idempotency_key is unique so a retried trigger sends once.
-- sms_messages   every text in or out through Telnyx, including STOP / HELP /
--                START keywords. Provider message ids are unique so a redelivered
--                webhook is recognised.
--
-- Opt-outs themselves live in the append-only consent ledger (consent_events,
-- WS-B): a STOP is a new row with event_type = 'revoked', never an edit here.
-- RLS is enabled with no policies: only the service role reads or writes.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  channel text not null check (channel in ('email', 'sms')),
  template_id text not null check (length(template_id) between 1 and 80),
  template_version integer not null check (template_version > 0),
  audience text not null check (audience in ('borrower', 'partner', 'staff')),
  -- Email address or E.164 phone number.
  recipient text not null check (length(recipient) between 3 and 320),
  subject text check (subject is null or length(subject) <= 300),
  status text not null default 'queued' check (status in (
    'queued', 'pending_approval', 'sent', 'delivered', 'failed',
    'skipped_no_consent', 'skipped_unconfigured', 'deferred_quiet_hours', 'rejected', 'expired'
  )),
  provider text check (provider is null or provider in ('resend', 'telnyx', 'fake')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  idempotency_key text not null check (length(idempotency_key) between 1 and 300),
  lead_id uuid references public.leads (id) on delete set null,
  -- deals arrives with WS-I (Phase 2), which adds the foreign key.
  deal_id uuid,
  approval_id text,
  -- consent_events row that allowed (or blocked) the send.
  consent_event_id uuid references public.consent_events (id) on delete set null,
  attempts integer not null default 0 check (attempts >= 0),
  error text check (error is null or length(error) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  sent_at timestamptz,
  delivered_at timestamptz,
  constraint notifications_idempotency_key_unique unique (idempotency_key)
);
create index notifications_lead_idx on public.notifications (lead_id, created_at desc) where lead_id is not null;
create index notifications_provider_idx on public.notifications (provider, provider_message_id) where provider_message_id is not null;
create index notifications_status_idx on public.notifications (status, created_at desc)
  where status in ('pending_approval', 'deferred_quiet_hours', 'failed');
create index notifications_recipient_idx on public.notifications (channel, recipient, created_at desc);

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  direction text not null check (direction in ('inbound', 'outbound')),
  from_number text not null check (length(from_number) between 3 and 40),
  to_number text not null check (length(to_number) between 3 and 40),
  body text not null check (length(body) <= 4000),
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  notification_id uuid references public.notifications (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  -- Keyword the inbound text was handled as.
  keyword text check (keyword is null or keyword in ('stop', 'help', 'start')),
  -- Set once an inbound text's effects (ledger row, CRM opt-out, reply) are done.
  processed_at timestamptz,
  delivered_at timestamptz,
  error text check (error is null or length(error) <= 1000),
  constraint sms_messages_provider_message_unique unique (provider_message_id)
);
create index sms_messages_from_idx on public.sms_messages (from_number, created_at desc);
create index sms_messages_to_idx on public.sms_messages (to_number, created_at desc);
create index sms_messages_notification_idx on public.sms_messages (notification_id) where notification_id is not null;

create or replace function public.notifications_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute function public.notifications_touch_updated_at();

alter table public.notifications enable row level security;
alter table public.sms_messages enable row level security;

revoke all on public.notifications from anon, authenticated;
revoke all on public.sms_messages from anon, authenticated;
revoke execute on function public.notifications_touch_updated_at() from public, anon, authenticated;
