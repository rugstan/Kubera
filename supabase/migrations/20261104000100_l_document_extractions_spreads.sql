-- WS-L · Document agent & spreads (Phase 3, slot 01).
--
-- document_extractions           one row per extraction run over a borrower or lender document
--                                (vault document or mail attachment): typed fields with per-field
--                                confidence, the engine that produced them and the review state
-- document_extraction_events     append-only audit trail (extracted, corrected, approved, rejected)
-- construction_budgets           construction / PIP budget extraction target (hard, soft,
--                                contingency, developer fee, financing costs, LTC inputs)
-- spreads                        versioned ratio-layer results per deal or lead (NOI normalization,
--                                DSCR / debt yield / LTV per quote, SBA global cash flow, STR,
--                                senior census, rent roll, construction budget)
--
-- Extraction is analysis only: nothing here sends anything outside Kubera,
-- and there are no funds or draw columns (the WS-W no-custody guard checks).
-- Field values are confidential (restricted for personal financial statements);
-- RLS is enabled on every table with no policies, so only the service role reads
-- or writes. Staff screens read through the service role after the auth guard.

create table public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_type text not null check (source_type in ('vault_document', 'mail_attachment', 'manual')),
  document_id uuid references public.documents (id) on delete cascade,
  mail_message_id uuid references public.mail_messages (id) on delete cascade,
  attachment_name text check (attachment_name is null or length(attachment_name) <= 300),
  lead_id uuid references public.leads (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete set null,
  -- Null only on a failed run that could not tell what the document is.
  doc_type text check (doc_type in ('T12', 'RENT_ROLL', 'CENSUS', 'STR', 'PFS', 'CONSTRUCTION_BUDGET', 'TERM_SHEET')),
  source_format text not null check (source_format in ('pdf', 'xlsx', 'csv', 'text')),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'extracted', 'needs_review', 'approved', 'rejected', 'failed', 'superseded')),
  -- rules | nemo+rules | nemo+model | text+model | claude_pdf | merged | manual
  engine text not null check (length(engine) between 1 and 40),
  model text check (model is null or length(model) <= 120),
  prompt_version text check (prompt_version is null or length(prompt_version) <= 40),
  fields jsonb not null default '{}',
  row_count integer not null default 0 check (row_count >= 0),
  overall_confidence numeric(4, 3) check (overall_confidence is null or (overall_confidence >= 0 and overall_confidence <= 1)),
  low_confidence_fields text[] not null default '{}',
  warnings text[] not null default '{}',
  error text check (error is null or length(error) <= 1000),
  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 200),
  reviewed_at timestamptz,
  review_notes text check (review_notes is null or length(review_notes) <= 2000),
  superseded_by uuid references public.document_extractions (id) on delete set null,
  constraint document_extractions_source check (
    (source_type = 'vault_document' and document_id is not null)
    or (source_type = 'mail_attachment' and mail_message_id is not null)
    or (source_type = 'manual')
  ),
  constraint document_extractions_typed check (doc_type is not null or status = 'failed'),
  constraint document_extractions_reviewed check (
    status not in ('approved', 'rejected') or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint document_extractions_review_queue check (
    status <> 'needs_review' or cardinality(low_confidence_fields) > 0 or cardinality(warnings) > 0
  )
);
create index document_extractions_document_idx on public.document_extractions (document_id) where document_id is not null;
create index document_extractions_deal_idx on public.document_extractions (deal_id, doc_type, created_at desc) where deal_id is not null;
create index document_extractions_lead_idx on public.document_extractions (lead_id, doc_type, created_at desc) where lead_id is not null;
create index document_extractions_review_idx on public.document_extractions (created_at) where status = 'needs_review';
-- One live extraction per document (and per mail attachment) and document type; re-runs supersede.
create unique index document_extractions_live_document on public.document_extractions (document_id, doc_type)
  where document_id is not null and status not in ('superseded', 'failed', 'rejected');
create unique index document_extractions_live_attachment on public.document_extractions (mail_message_id, attachment_name, doc_type)
  where mail_message_id is not null and status not in ('superseded', 'failed', 'rejected');

create table public.document_extraction_events (
  id bigint generated always as identity primary key,
  extraction_id uuid not null references public.document_extractions (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  event_type text not null check (event_type in ('extracted', 'queued_for_review', 'corrected', 'approved', 'rejected', 'superseded', 'failed', 'routing_refused')),
  actor text not null check (length(actor) between 1 and 200),
  -- Field names and reason codes only; never field values.
  detail jsonb not null default '{}'
);
create index document_extraction_events_extraction_idx on public.document_extraction_events (extraction_id, id);

create or replace function public.document_extraction_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'document_extraction_events is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger document_extraction_events_append_only before update or delete on public.document_extraction_events
  for each row execute function public.document_extraction_events_append_only();

create table public.construction_budgets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extraction_id uuid not null unique references public.document_extractions (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete set null,
  lead_id uuid references public.leads (id) on delete cascade,
  budget_kind text not null default 'ground_up' check (budget_kind in ('ground_up', 'renovation', 'pip')),
  status text not null default 'extracted' check (status in ('extracted', 'needs_review', 'approved', 'rejected', 'superseded')),
  land_cost numeric(14, 2) check (land_cost is null or land_cost >= 0),
  hard_costs numeric(14, 2) check (hard_costs is null or hard_costs >= 0),
  soft_costs numeric(14, 2) check (soft_costs is null or soft_costs >= 0),
  contingency numeric(14, 2) check (contingency is null or contingency >= 0),
  developer_fee numeric(14, 2) check (developer_fee is null or developer_fee >= 0),
  financing_costs numeric(14, 2) check (financing_costs is null or financing_costs >= 0),
  total_cost numeric(14, 2) check (total_cost is null or total_cost >= 0),
  contingency_pct_of_hard numeric(6, 4) check (contingency_pct_of_hard is null or contingency_pct_of_hard >= 0),
  gmp_contract boolean,
  -- [{ description, category, amount, confidence }]
  line_items jsonb not null default '[]' check (jsonb_typeof(line_items) = 'array'),
  constraint construction_budgets_total_covers_parts check (
    total_cost is null
    or total_cost + 1 >= coalesce(land_cost, 0) + coalesce(hard_costs, 0) + coalesce(soft_costs, 0)
      + coalesce(contingency, 0) + coalesce(developer_fee, 0) + coalesce(financing_costs, 0)
  )
);
create index construction_budgets_deal_idx on public.construction_budgets (deal_id) where deal_id is not null;

create table public.spreads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  deal_id uuid references public.deals (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  kind text not null check (kind in ('operating_statement', 'quotes', 'global_cash_flow', 'hotel_str', 'senior_census', 'rent_roll', 'construction_budget', 'deal_summary')),
  version integer not null check (version >= 1),
  lender_profile text check (lender_profile is null or lender_profile ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  source_extraction_ids uuid[] not null default '{}',
  inputs jsonb not null default '{}',
  results jsonb not null,
  flags text[] not null default '{}',
  created_by text not null check (length(created_by) between 1 and 200),
  constraint spreads_subject check (deal_id is not null or lead_id is not null)
);
create unique index spreads_deal_version on public.spreads (deal_id, kind, coalesce(lender_profile, ''), version) where deal_id is not null;
create unique index spreads_lead_version on public.spreads (lead_id, kind, coalesce(lender_profile, ''), version) where deal_id is null;
create index spreads_deal_latest_idx on public.spreads (deal_id, kind, version desc) where deal_id is not null;

-- Spreads are versioned records: a new calculation is a new row, never an edit.
create or replace function public.spreads_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'spreads rows are immutable; insert a new version' using errcode = 'insufficient_privilege';
end;
$$;
create trigger spreads_immutable before update or delete on public.spreads
  for each row execute function public.spreads_immutable();

create or replace function public.l_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger document_extractions_touch before update on public.document_extractions
  for each row execute function public.l_touch_updated_at();
create trigger construction_budgets_touch before update on public.construction_budgets
  for each row execute function public.l_touch_updated_at();

alter table public.document_extractions enable row level security;
alter table public.document_extraction_events enable row level security;
alter table public.construction_budgets enable row level security;
alter table public.spreads enable row level security;
revoke all on public.document_extractions, public.document_extraction_events, public.construction_budgets, public.spreads from anon, authenticated;
