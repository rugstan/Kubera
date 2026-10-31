-- WS-Y · Privacy & AI controls (Phase 1, slot 05).
--
-- privacy_requests     CCPA consumer requests (access/export, deletion, correction,
--                      human-review / AI opt-out, opt-out of sale/sharing). This is
--                      the compliance@ queue: staff work it from here. Kept 24 months
--                      after closure (11 CCR §7101).
-- privacy_preferences  per-person AI and automated-decision preferences, keyed by
--                      lower-cased email; read by agents and the model routing guard.
-- retention_runs       log of each retention-engine run (/api/cron/retention).
-- legal hold           legal_hold flag + reason on every table the retention engine
--                      deletes from; a trigger refuses to delete a held row.
--
-- RLS is enabled with no policies: only the service role reads or writes.

-- Legal hold ------------------------------------------------------------------------
-- A row on hold is never deleted (retention, erasure requests, or by hand) until
-- the hold is released. Holds are set by counsel/compliance (POST /api/privacy/legal-hold).
create or replace function public.refuse_delete_on_legal_hold()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.legal_hold then
    raise exception 'Row %.% is under legal hold (%); release the hold before deleting', tg_table_name, old.id, coalesce(old.legal_hold_reason, 'no reason recorded')
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
revoke execute on function public.refuse_delete_on_legal_hold() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['leads', 'partners', 'documents', 'ai_conversations', 'consent_events'] loop
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

-- Indexes for the retention scans (leads and ai_conversations already have created_at indexes).
create index partners_created_at_idx on public.partners (created_at);
create index crm_events_received_at_idx on public.crm_events (received_at);
create index consent_events_occurred_at_idx on public.consent_events (occurred_at);
create index ai_conversations_lead_idx on public.ai_conversations (lead_id) where lead_id is not null;

-- Privacy requests (compliance@ queue) ----------------------------------------------------
create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  request_type text not null check (request_type in ('access', 'deletion', 'correction', 'human_review', 'opt_out_sale_share')),
  status text not null check (status in ('pending_verification', 'verified', 'in_progress', 'completed', 'partially_completed', 'denied', 'withdrawn')),
  -- The queue this ticket lands in; compliance@ (no CRM sync) owns privacy requests.
  queue text not null default 'compliance' check (queue = 'compliance'),
  mailbox text not null default 'compliance@kuberacommercial.com' check (mailbox ~ '^[^@\s]+@[^@\s]+$'),
  subject_email text not null check (subject_email = lower(subject_email) and length(subject_email) between 3 and 200),
  subject_name text check (subject_name is null or length(subject_name) <= 200),
  subject_phone text check (subject_phone is null or length(subject_phone) <= 40),
  relationship text not null default 'self' check (relationship in ('self', 'authorized_agent')),
  agent_name text check (agent_name is null or length(agent_name) <= 200),
  details text check (details is null or length(details) <= 4000),
  -- Optional: the lead the requester proved they own with its capability token.
  lead_id uuid references public.leads (id) on delete set null,
  verification_method text check (verification_method in ('lead_token', 'staff_match', 'not_required')),
  verified_at timestamptz,
  verified_by text check (verified_by is null or length(verified_by) <= 200),
  -- 11 CCR §7021: confirm receipt within 10 business days, respond within 45 calendar days (+45 with notice).
  acknowledge_by date not null,
  due_at date not null,
  extended_due_at date,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  denial_reason text check (denial_reason is null or length(denial_reason) <= 2000),
  resolution jsonb not null default '{}'::jsonb check (jsonb_typeof(resolution) = 'object'),
  -- The export itself is never stored; only proof of what was produced.
  export_generated_at timestamptz,
  export_sha256 text check (export_sha256 is null or export_sha256 ~ '^[0-9a-f]{64}$'),
  ip_hash text check (ip_hash is null or length(ip_hash) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  -- Dedupe key: one open request per subject × type × day from the public form.
  dedupe_key text not null check (length(dedupe_key) between 16 and 128),
  legal_hold boolean not null default false,
  legal_hold_reason text check (legal_hold_reason is null or length(legal_hold_reason) between 1 and 500),
  legal_hold_set_at timestamptz,
  legal_hold_set_by text check (legal_hold_set_by is null or length(legal_hold_set_by) <= 200),
  constraint privacy_requests_legal_hold_reason_present check (not legal_hold or (legal_hold_reason is not null and legal_hold_set_at is not null)),
  constraint privacy_requests_verified_has_method check (verified_at is null or verification_method is not null),
  constraint privacy_requests_verified_status check (status not in ('verified', 'in_progress') or verified_at is not null),
  constraint privacy_requests_closed_has_time check (status not in ('completed', 'partially_completed', 'denied', 'withdrawn') or completed_at is not null),
  constraint privacy_requests_denied_has_reason check (status <> 'denied' or denial_reason is not null),
  constraint privacy_requests_agent_named check (relationship <> 'authorized_agent' or agent_name is not null),
  constraint privacy_requests_due_order check (acknowledge_by <= due_at and (extended_due_at is null or extended_due_at > due_at))
);
create unique index privacy_requests_dedupe_idx on public.privacy_requests (dedupe_key);
create index privacy_requests_open_idx on public.privacy_requests (due_at) where status in ('pending_verification', 'verified', 'in_progress');
create index privacy_requests_subject_idx on public.privacy_requests (subject_email, created_at desc);
create index privacy_requests_closed_idx on public.privacy_requests (completed_at) where completed_at is not null;

create trigger privacy_requests_touch before update on public.privacy_requests
  for each row execute function public.touch_updated_at();
create trigger privacy_requests_legal_hold_guard before delete on public.privacy_requests
  for each row execute function public.refuse_delete_on_legal_hold();

-- Preferences --------------------------------------------------------------------------------
-- Opting out is protective, so it applies immediately without identity
-- verification; it can only be cleared by staff or a verified request.
create table public.privacy_preferences (
  subject_email text primary key check (subject_email = lower(subject_email) and length(subject_email) between 3 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An advisor, not an automated rule, reviews this person's requests (no automated tiering or scoring).
  human_review_only boolean not null default false,
  -- No personal data about this person is sent to any AI model (lib/ai/routing.ts).
  ai_processing_opt_out boolean not null default false,
  -- Opt-out of sale/sharing (and GPC). Kubera does not sell or share; recorded anyway.
  opt_out_sale_share boolean not null default false,
  source_request_id uuid references public.privacy_requests (id) on delete set null
);
create trigger privacy_preferences_touch before update on public.privacy_preferences
  for each row execute function public.touch_updated_at();

-- Retention run log ------------------------------------------------------------------------------
create table public.retention_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  dry_run boolean not null default false,
  ok boolean,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error text check (error is null or length(error) <= 2000)
);
create index retention_runs_started_idx on public.retention_runs (started_at desc);

-- RLS: service role only ----------------------------------------------------------------------------
alter table public.privacy_requests enable row level security;
alter table public.privacy_preferences enable row level security;
alter table public.retention_runs enable row level security;

revoke all on public.privacy_requests from anon, authenticated;
revoke all on public.privacy_preferences from anon, authenticated;
revoke all on public.retention_runs from anon, authenticated;
