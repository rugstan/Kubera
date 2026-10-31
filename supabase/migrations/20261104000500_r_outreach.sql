-- WS-R · Lead & document chasers: the chasers' message log, outbound voice
-- calls, and AI-voice consent.
--
-- outreach_messages         one row per attempted chaser message (speed-to-lead
--                           reply, document reminder, closing nudge, vendor
--                           nudge). idempotency_key is unique, so a retried
--                           trigger sends once; (deal, kind, subject, sequence)
--                           drives the reminder cadence.
-- outreach_voice_calls      one row per outbound call, with the disclosure and
--                           recording timestamps that prove the order of events
--                           (a recording starts only after its disclosure).
-- outreach_voice_consents   append-only AI-voice consent ledger. The shared
--                           consent_events ledger (WS-B) does not carry an
--                           AI-voice channel, so AI-voice grants and
--                           revocations live here. Rows are never edited.
--
-- Nothing here models money: reminders ask for documents and conditions only
-- (Global rule 1). RLS is enabled with no policies: only the service role reads
-- or writes.

create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('speed_to_lead', 'document_reminder', 'closing_nudge', 'vendor_nudge')),
  channel text not null check (channel in ('email', 'sms')),
  template_id text not null check (length(template_id) between 1 and 80),
  template_version integer not null check (template_version > 0),
  audience text not null check (audience in ('borrower', 'vendor')),
  -- Email address or E.164 phone number.
  recipient text not null check (length(recipient) between 3 and 320),
  status text not null default 'queued' check (status in (
    'queued', 'pending_approval', 'sent', 'failed', 'skipped_no_consent',
    'skipped_unconfigured', 'deferred_quiet_hours', 'rejected', 'expired'
  )),
  reason_code text check (reason_code is null or reason_code in (
    'sent', 'no_consent', 'consent_revoked', 'consent_lookup_failed', 'outside_texting_window',
    'provider_unconfigured', 'approval_pending', 'approval_rejected', 'approval_expired',
    'send_failed', 'invalid_recipient', 'invalid_template_data', 'duplicate'
  )),
  idempotency_key text not null check (length(idempotency_key) between 1 and 300),
  lead_id uuid references public.leads (id) on delete set null,
  -- deals.id; kept loose like notifications.deal_id so a deal retention purge never blocks the log.
  deal_id uuid,
  -- What the message is about (docs:<deal>, closing:<deal>, report:<id>, lead:<id>).
  subject_key text check (subject_key is null or length(subject_key) <= 200),
  -- Round number within a reminder series (1-based).
  sequence integer not null default 1 check (sequence between 1 and 100),
  approval_id text,
  -- consent_events row that allowed (or blocked) the send.
  consent_event_id uuid references public.consent_events (id) on delete set null,
  provider text check (provider is null or provider in ('resend', 'telnyx', 'fake')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  attempts integer not null default 0 check (attempts >= 0),
  error text check (error is null or length(error) <= 1000),
  -- renderData holds the data the broker reviewed, so a retry sends what was approved.
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  sent_at timestamptz,
  constraint outreach_messages_idempotency_key_unique unique (idempotency_key)
);
create index outreach_messages_series_idx on public.outreach_messages (kind, deal_id, subject_key, sequence);
create index outreach_messages_lead_idx on public.outreach_messages (kind, lead_id, created_at desc) where lead_id is not null;
create index outreach_messages_waiting_idx on public.outreach_messages (kind, created_at desc)
  where status in ('pending_approval', 'deferred_quiet_hours');
create index outreach_messages_recipient_idx on public.outreach_messages (channel, recipient, created_at desc);

create table public.outreach_voice_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key text not null check (length(idempotency_key) between 1 and 300),
  mode text not null check (mode in ('human_assisted', 'ai_voice')),
  to_number text not null check (length(to_number) between 3 and 40),
  from_number text check (from_number is null or length(from_number) <= 40),
  status text not null default 'queued' check (status in (
    'blocked', 'pending_approval', 'rejected', 'expired', 'queued', 'dialing', 'announcing',
    'speaking', 'transferring', 'completed', 'no_answer', 'voicemail_skipped', 'failed'
  )),
  block_reason text check (block_reason is null or block_reason in (
    'invalid_number', 'voice_not_configured', 'no_phone_consent', 'phone_consent_revoked',
    'no_automated_contact_consent', 'automated_contact_revoked', 'no_ai_voice_consent',
    'ai_voice_consent_revoked', 'outside_calling_window', 'consent_lookup_failed', 'handoff_number_required'
  )),
  script_id text not null check (length(script_id) between 1 and 60),
  script_version integer not null check (script_version > 0),
  -- The exact words spoken after the disclosures (what the broker approved).
  body_text text check (body_text is null or length(body_text) <= 2000),
  record_requested boolean not null default false,
  ai_disclosed_at timestamptz,
  recording_disclosed_at timestamptz,
  recording_started_at timestamptz,
  recording_stopped_at timestamptz,
  recording_id text check (recording_id is null or length(recording_id) <= 200),
  lead_id uuid references public.leads (id) on delete set null,
  deal_id uuid,
  approval_id text,
  consent_event_ids text[] not null default '{}',
  ai_voice_consent_id uuid,
  call_control_id text check (call_control_id is null or length(call_control_id) <= 300),
  call_session_id text check (call_session_id is null or length(call_session_id) <= 300),
  handoff_number text check (handoff_number is null or length(handoff_number) <= 40),
  hangup_cause text check (hangup_cause is null or length(hangup_cause) <= 100),
  error text check (error is null or length(error) <= 1000),
  ended_at timestamptz,
  constraint outreach_voice_calls_idempotency_key_unique unique (idempotency_key),
  -- A recording never starts before its disclosure has played.
  constraint outreach_voice_calls_record_after_disclosure check (
    recording_started_at is null
    or (recording_disclosed_at is not null and recording_started_at >= recording_disclosed_at)
  ),
  -- An AI-voice call that was answered carries its AI disclosure timestamp before any later step.
  constraint outreach_voice_calls_ai_needs_consent check (mode <> 'ai_voice' or status in ('blocked', 'rejected', 'expired', 'pending_approval', 'queued') or ai_voice_consent_id is not null)
);
create unique index outreach_voice_calls_control_idx on public.outreach_voice_calls (call_control_id) where call_control_id is not null;
create index outreach_voice_calls_lead_idx on public.outreach_voice_calls (lead_id, created_at desc) where lead_id is not null;
create index outreach_voice_calls_status_idx on public.outreach_voice_calls (status, created_at desc) where status in ('pending_approval', 'dialing', 'announcing', 'speaking', 'transferring');

create table public.outreach_voice_consents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  occurred_at timestamptz not null default now(),
  event_type text not null check (event_type in ('granted', 'revoked')),
  kind text not null default 'ai_voice' check (kind = 'ai_voice'),
  -- E.164.
  phone text not null check (length(phone) between 7 and 20),
  lead_id uuid references public.leads (id) on delete set null,
  text_version text not null check (length(text_version) between 1 and 80),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  -- Where it was captured: a form path, call:<id>, sms:<id>, staff:<user>.
  page text check (page is null or length(page) <= 512)
);
create index outreach_voice_consents_phone_idx on public.outreach_voice_consents (phone, occurred_at desc);

-- AI-voice consent rows are immutable (append-only evidence). The only permitted
-- update is the foreign-key cascade that nulls lead_id when a lead is purged.
create or replace function public.outreach_voice_consents_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.id, new.created_at, new.occurred_at, new.event_type, new.kind, new.phone, new.text_version, new.text_sha256, new.page)
     is distinct from
     (old.id, old.created_at, old.occurred_at, old.event_type, old.kind, old.phone, old.text_version, old.text_sha256, old.page)
     or (new.lead_id is not null and new.lead_id is distinct from old.lead_id) then
    raise exception 'outreach_voice_consents is append-only; insert a new event instead';
  end if;
  return new;
end;
$$;

create trigger outreach_voice_consents_no_update
  before update on public.outreach_voice_consents
  for each row execute function public.outreach_voice_consents_immutable();

create or replace function public.outreach_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger outreach_messages_set_updated_at
  before update on public.outreach_messages
  for each row execute function public.outreach_touch_updated_at();

create trigger outreach_voice_calls_set_updated_at
  before update on public.outreach_voice_calls
  for each row execute function public.outreach_touch_updated_at();

alter table public.outreach_messages enable row level security;
alter table public.outreach_voice_calls enable row level security;
alter table public.outreach_voice_consents enable row level security;

revoke all on public.outreach_messages from anon, authenticated;
revoke all on public.outreach_voice_calls from anon, authenticated;
revoke all on public.outreach_voice_consents from anon, authenticated;
revoke execute on function public.outreach_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.outreach_voice_consents_immutable() from public, anon, authenticated;
