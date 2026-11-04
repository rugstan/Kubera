-- WS-Q · Workflow & AI platform (Phase 2, slot 06).
--
-- agent_runs         one row per workflow / agent run: trigger, subject, outcome,
--                    model calls (provider, model, tokens, latency, stop reason;
--                    never prompt text) and the Langfuse trace id.
-- workflow_effects   idempotency keys for side effects that must happen at most
--                    once (lib/workflows/idempotency.ts).
-- mail_messages      inbound Zoho Mail for deals@, docs@, lenders@, vendors@ and
--                    closing@: classification, deal routing, attachments (stored
--                    in quarantine), review queue.
--
-- Nothing here models funds: Corin brokers loans and never holds or moves money.
-- RLS is enabled with no policies: only the service role reads or writes.

-- Agent runs ---------------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  workflow text not null check (workflow ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  -- One row per logical run (e.g. 'mail:deals:<provider id>'); replays reuse it.
  idempotency_key text unique check (idempotency_key is null or length(idempotency_key) between 8 and 300),
  trigger_event text check (trigger_event is null or length(trigger_event) <= 120),
  trigger_event_id text check (trigger_event_id is null or length(trigger_event_id) <= 200),
  inngest_run_id text check (inngest_run_id is null or length(inngest_run_id) <= 200),
  subject_type text check (subject_type is null or subject_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  subject_id text check (subject_id is null or length(subject_id) <= 300),
  deal_id uuid,
  lead_id uuid references public.leads (id) on delete set null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped', 'needs_review')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  -- [{provider, model, servedModel, purpose, inputTokens, outputTokens, stopReason, latencyMs, refused, redacted}]
  model_calls jsonb not null default '[]'::jsonb check (jsonb_typeof(model_calls) = 'array'),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  routing_refusals integer not null default 0 check (routing_refusals >= 0),
  trace_id text check (trace_id is null or length(trace_id) <= 300),
  error text check (error is null or length(error) <= 2000),
  constraint agent_runs_finished check ((status = 'running') = (finished_at is null))
);
create index agent_runs_created_idx on public.agent_runs (created_at desc);
create index agent_runs_workflow_idx on public.agent_runs (workflow, status, created_at desc);
create index agent_runs_deal_idx on public.agent_runs (deal_id) where deal_id is not null;
create index agent_runs_attention_idx on public.agent_runs (created_at desc) where status in ('failed', 'needs_review');

-- Idempotent effects -------------------------------------------------------------------------
create table public.workflow_effects (
  idempotency_key text primary key check (length(idempotency_key) between 8 and 300),
  created_at timestamptz not null default now(),
  workflow text not null check (length(workflow) between 1 and 63),
  run_id uuid references public.agent_runs (id) on delete set null,
  status text not null check (status in ('in_progress', 'completed', 'failed')),
  started_at timestamptz not null,
  completed_at timestamptz,
  attempts integer not null default 1 check (attempts >= 1),
  -- JSON-safe receipt (provider message id etc.); never message content.
  result jsonb,
  error text check (error is null or length(error) <= 1000),
  constraint workflow_effects_completed_has_time check (status = 'in_progress' or completed_at is not null)
);
create index workflow_effects_stuck_idx on public.workflow_effects (started_at) where status = 'in_progress';

-- Inbound mail -----------------------------------------------------------------------------------
create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mailbox text not null check (mailbox in ('deals', 'docs', 'lenders', 'vendors', 'closing')),
  provider text not null check (provider in ('zoho', 'fake')),
  provider_message_id text not null check (length(provider_message_id) between 1 and 200),
  folder_id text not null check (length(folder_id) between 1 and 200),
  internet_message_id text check (internet_message_id is null or (internet_message_id = lower(internet_message_id) and length(internet_message_id) <= 300)),
  in_reply_to text check (in_reply_to is null or length(in_reply_to) <= 300),
  reference_ids text[] not null default '{}' check (cardinality(reference_ids) <= 50),
  from_address text not null check (length(from_address) <= 320),
  from_name text check (from_name is null or length(from_name) <= 200),
  to_addresses text[] not null default '{}' check (cardinality(to_addresses) <= 50),
  cc_addresses text[] not null default '{}' check (cardinality(cc_addresses) <= 50),
  subject text not null default '' check (length(subject) <= 998),
  received_at timestamptz not null,
  snippet text not null default '' check (length(snippet) <= 500),
  -- Restricted values (SSN, account numbers) are masked here; the full body is
  -- sealed in body_encrypted with lib/privacy/crypto.ts when it had any.
  body_text text not null default '' check (length(body_text) <= 200000),
  body_encrypted text check (body_encrypted is null or body_encrypted like 'pii1.%'),
  body_restricted boolean not null default false,
  has_attachments boolean not null default false,
  -- [{attachmentId, fileName, size, contentType, sha256, status, bucket, storagePath, documentId, kind, error}]
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  automated boolean not null default false,
  bulk boolean not null default false,
  dmarc text not null default 'unknown' check (dmarc in ('pass', 'fail', 'none', 'unknown')),
  classification jsonb not null default '{}'::jsonb check (jsonb_typeof(classification) = 'object'),
  category text not null check (category in (
    'new_inquiry', 'borrower_update', 'document_submission', 'lender_correspondence', 'term_sheet',
    'third_party_report', 'closing_coordination', 'partner_referral', 'scheduling', 'auto_reply',
    'marketing', 'spam_or_phishing', 'other'
  )),
  classifier_source text not null check (classifier_source in ('model', 'rules')),
  classifier_model text check (classifier_model is null or length(classifier_model) <= 100),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  suspicious boolean not null default false,
  deal_id uuid,
  lead_id uuid references public.leads (id) on delete set null,
  route_method text not null check (route_method in ('reference', 'thread', 'participant', 'property', 'none')),
  route_confidence numeric(4, 3) not null default 0 check (route_confidence between 0 and 1),
  queue text not null check (queue in ('deal-desk', 'documents', 'capital-markets', 'third-party-reports', 'closing')),
  status text not null check (status in ('processed', 'needs_review', 'ignored', 'failed')),
  review_reasons text[] not null default '{}',
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  processed_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 200),
  error text check (error is null or length(error) <= 2000),
  unique (mailbox, provider_message_id),
  constraint mail_messages_review_has_reason check (status <> 'needs_review' or cardinality(review_reasons) > 0),
  constraint mail_messages_restricted_body_sealed check (body_encrypted is null or body_restricted)
);
create index mail_messages_received_idx on public.mail_messages (mailbox, received_at desc);
create index mail_messages_thread_idx on public.mail_messages (internet_message_id) where internet_message_id is not null;
create index mail_messages_deal_idx on public.mail_messages (deal_id, received_at desc) where deal_id is not null;
create index mail_messages_lead_idx on public.mail_messages (lead_id) where lead_id is not null;
create index mail_messages_review_idx on public.mail_messages (queue, received_at desc) where status = 'needs_review' and reviewed_at is null;

-- deals (WS-I, same phase) may or may not exist yet when this runs; link when it does.
do $$
begin
  if to_regclass('public.deals') is not null then
    alter table public.agent_runs add constraint agent_runs_deal_fk foreign key (deal_id) references public.deals (id) on delete set null;
    alter table public.mail_messages add constraint mail_messages_deal_fk foreign key (deal_id) references public.deals (id) on delete set null;
  end if;
end;
$$;

-- RLS: service role only -------------------------------------------------------------------------
alter table public.agent_runs enable row level security;
alter table public.workflow_effects enable row level security;
alter table public.mail_messages enable row level security;

revoke all on public.agent_runs from anon, authenticated;
revoke all on public.workflow_effects from anon, authenticated;
revoke all on public.mail_messages from anon, authenticated;
