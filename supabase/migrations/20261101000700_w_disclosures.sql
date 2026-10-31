-- WS-W · Disclosures & e-sign (Phase 0, slot 07).
--
-- disclosures         RE 882 MLDS and funder disclosures with their lifecycle
--                     (required → generated → sent → signed; held_for_counsel; superseded)
-- disclosure_events   append-only audit trail (state changes, e-sign webhooks, consents)
-- broker_of_record    Civ. Code §1916.1 broker-arrangement file per loan and per
--                     forbearance / extension / modification (SB 1146)
-- deal_disclosure_status  current MLDS state per lead/deal for pipeline gates
-- custody guard       public.custody_column_violations() + DDL event trigger:
--                     Kubera never holds or moves funds and has no draw role.
--
-- RLS is enabled on every table with no policies: only the service role reads
-- or writes. Signed MLDS copies are retained at least 3 years (B&P §10148).

-- Disclosures ------------------------------------------------------------------
create table public.disclosures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  kind text not null check (kind in ('MLDS_RE882', 'FUNDER_DISCLOSURE')),
  status text not null check (status in ('required', 'generated', 'sent', 'signed', 'held_for_counsel', 'superseded')),
  lead_id uuid references public.leads (id) on delete restrict,
  -- deals arrives with WS-I (Phase 2), which adds the foreign key.
  deal_id uuid,
  twenty_opportunity_id uuid,
  supersedes_id uuid references public.disclosures (id) on delete restrict,
  application_completed_at timestamptz,
  borrower_obligated_at timestamptz,
  due_at timestamptz,
  generated_at timestamptz,
  sent_at timestamptz,
  signed_at timestamptz,
  held_reason text,
  flags text[] not null default '{}',
  template_version text,
  payload jsonb,
  document_path text,
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  signed_document_path text,
  signed_document_sha256 text check (signed_document_sha256 ~ '^[0-9a-f]{64}$'),
  provider text check (provider in ('zoho_sign', 'boldsign', 'fake')),
  provider_request_id text,
  signer_actions jsonb not null default '[]',
  ueta_consent jsonb not null default '[]',
  retain_until date,
  constraint disclosures_deal_ref check (lead_id is not null or deal_id is not null or twenty_opportunity_id is not null),
  constraint disclosures_signed_complete check (
    signed_at is null or (signed_document_path is not null and signed_document_sha256 is not null and retain_until is not null)
  ),
  constraint disclosures_signed_has_time check (status <> 'signed' or signed_at is not null),
  constraint disclosures_sent_has_request check (status <> 'sent' or (provider is not null and provider_request_id is not null)),
  constraint disclosures_held_has_reason check (status <> 'held_for_counsel' or held_reason is not null),
  constraint disclosures_generated_has_document check (status not in ('generated', 'sent', 'signed') or (document_path is not null and document_sha256 is not null))
);
create unique index disclosures_provider_request_idx on public.disclosures (provider, provider_request_id) where provider_request_id is not null;
create index disclosures_lead_idx on public.disclosures (lead_id) where lead_id is not null;
create index disclosures_deal_idx on public.disclosures (deal_id) where deal_id is not null;
create index disclosures_open_due_idx on public.disclosures (due_at) where status in ('required', 'generated');
-- One current MLDS per lead (superseded rows are history).
create unique index disclosures_one_current_mlds_per_lead on public.disclosures (lead_id)
  where kind = 'MLDS_RE882' and status <> 'superseded' and lead_id is not null;

-- Signed disclosures cannot be deleted before their retention date.
create or replace function public.disclosures_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.signed_at is not null and (old.retain_until is null or old.retain_until > current_date) then
    raise exception 'Disclosure % is signed and retained until %', old.id, coalesce(old.retain_until::text, 'unset')
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
create trigger disclosures_guard_delete before delete on public.disclosures
  for each row execute function public.disclosures_guard_delete();

-- Audit trail ------------------------------------------------------------------
create table public.disclosure_events (
  id bigint generated always as identity primary key,
  disclosure_id uuid not null references public.disclosures (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  event_type text not null,
  from_status text,
  to_status text,
  actor text not null,
  provider_event_id text unique,
  detail jsonb not null default '{}'
);
create index disclosure_events_disclosure_idx on public.disclosure_events (disclosure_id, id);

-- Append-only: rows are never updated, and are deleted only by the cascade
-- from a disclosure whose retention period has ended (pg_trigger_depth() > 1
-- means the delete came from the foreign-key action, not a direct statement).
create or replace function public.disclosure_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'disclosure_events is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger disclosure_events_append_only before update or delete on public.disclosure_events
  for each row execute function public.disclosure_events_append_only();

-- Broker of record (gate H) ------------------------------------------------------
create table public.broker_of_record (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  record_kind text not null check (record_kind in ('loan', 'forbearance', 'extension', 'modification')),
  lead_id uuid references public.leads (id) on delete restrict,
  deal_id uuid,
  twenty_opportunity_id uuid,
  parent_id uuid references public.broker_of_record (id) on delete restrict,
  transaction_date date,
  effective_date date,
  arranged_by text not null check (arranged_by in ('kubera', 'other_licensed_broker', 'lender_or_servicer_only')),
  arranging_licensee_name text,
  arranging_licensee_dre text check (arranging_licensee_dre ~ '^\d{8}$'),
  licensee_active_at_transaction boolean,
  other_broker_name text,
  other_broker_dre text check (other_broker_dre ~ '^\d{8}$'),
  acts_for text check (acts_for in ('borrower', 'lender', 'borrower_and_lender')),
  engagement_agreement_ref text,
  compensation_amount_usd numeric(14, 2) check (compensation_amount_usd >= 0),
  compensation_payer text check (compensation_payer in ('borrower', 'lender', 'borrower_and_lender')),
  compensation_expected boolean,
  closing_statement_line text,
  negotiation_log jsonb not null default '[]',
  lender_name text not null,
  lender_category text not null check (lender_category in (
    'NATIONAL_BANK', 'STATE_BANK', 'SAVINGS_ASSOCIATION', 'CREDIT_UNION', 'INSURANCE_COMPANY',
    'CFL_LICENSEE', 'INDUSTRIAL_LOAN_COMPANY', 'PRIVATE_NON_EXEMPT', 'UNKNOWN'
  )),
  lender_evidence_ref text,
  collateral_real_property_lien boolean not null,
  collateral_equity_pledge_or_ucc_only boolean not null default false,
  collateral_apn text,
  collateral_lien_position smallint check (collateral_lien_position between 1 and 5),
  business_purpose_certified boolean not null default false,
  note_rate_pct numeric(7, 4) not null check (note_rate_pct >= 0),
  fed_discount_rate_pct numeric(7, 4) not null check (fed_discount_rate_pct >= 0),
  table_funded boolean not null default false,
  true_funding_source text,
  table_funded_in_kubera_name boolean not null default false,
  agreement_recites_broker_arrangement boolean,
  lender_notice_sent_at timestamptz,
  officer_approved_by text,
  officer_approved_dre text check (officer_approved_dre ~ '^\d{8}$'),
  officer_approved_at timestamptz,
  mlds_signed_on date,
  gate_status text not null check (gate_status in (
    'lender_exempt', 'within_cap', 'cleared', 'blocked', 'held_for_counsel',
    'no_exemption_representation', 'documented', 'incomplete'
  )),
  gate_blocking boolean not null,
  gate_result jsonb not null,
  flags text[] not null default '{}',
  -- §10148: keep transaction records at least 3 years.
  retain_until date generated always as ((coalesce(effective_date, transaction_date) + interval '3 years')::date) stored,
  constraint broker_of_record_deal_ref check (lead_id is not null or deal_id is not null or twenty_opportunity_id is not null),
  constraint broker_of_record_loan_shape check (
    (record_kind = 'loan' and parent_id is null and transaction_date is not null and arranged_by = 'kubera')
    or (record_kind <> 'loan' and parent_id is not null and effective_date is not null)
  ),
  constraint broker_of_record_equity_only check (not (collateral_real_property_lien and collateral_equity_pledge_or_ucc_only))
);
create index broker_of_record_lead_idx on public.broker_of_record (lead_id) where lead_id is not null;
create index broker_of_record_deal_idx on public.broker_of_record (deal_id) where deal_id is not null;
create index broker_of_record_parent_idx on public.broker_of_record (parent_id) where parent_id is not null;
create index broker_of_record_blocking_idx on public.broker_of_record (gate_status) where gate_blocking;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger broker_of_record_touch before update on public.broker_of_record
  for each row execute function public.touch_updated_at();

-- Current MLDS state per deal (security_invoker so RLS of the caller applies).
create view public.deal_disclosure_status
with (security_invoker = true)
as
select distinct on (coalesce(d.lead_id::text, d.deal_id::text, d.twenty_opportunity_id::text))
  d.lead_id,
  d.deal_id,
  d.twenty_opportunity_id,
  d.id as mlds_disclosure_id,
  d.status as mlds_status,
  d.due_at as mlds_due_at,
  d.sent_at as mlds_sent_at,
  d.signed_at as mlds_signed_at,
  d.held_reason,
  (d.status = 'signed') as closing_allowed_by_mlds
from public.disclosures d
where d.kind = 'MLDS_RE882' and d.status <> 'superseded'
order by coalesce(d.lead_id::text, d.deal_id::text, d.twenty_opportunity_id::text), d.created_at desc;

-- RLS: service role only ------------------------------------------------------------
alter table public.disclosures enable row level security;
alter table public.disclosure_events enable row level security;
alter table public.broker_of_record enable row level security;
revoke all on public.deal_disclosure_status from anon, authenticated;

-- No-custody guard ----------------------------------------------------------------------
-- Keep the pattern in sync with FORBIDDEN_CUSTODY_TOKENS in lib/compliance/no-custody.ts.
create or replace function public.custody_column_violations()
returns table (table_name text, column_name text)
language sql
stable
set search_path = ''
as $$
  select c.table_name::text, c.column_name::text
  from information_schema.columns c
  where c.table_schema = 'public'
    and replace(lower(c.column_name), '_', '') ~ '(disburse|escrowbalance|trustaccount|drawamount|drawrequest|drawschedule|lienwaiver|fundsheld|custodialaccount)'
$$;
revoke execute on function public.custody_column_violations() from public, anon, authenticated;

create or replace function public.enforce_no_custody_columns()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  v record;
begin
  for v in select * from public.custody_column_violations() loop
    raise exception 'No-custody guard: public.%.% looks like a funds or draw field. Kubera never holds or disburses funds and has no role in construction draws.',
      v.table_name, v.column_name
      using errcode = 'check_violation';
  end loop;
end;
$$;
revoke execute on function public.enforce_no_custody_columns() from public, anon, authenticated;

-- Event triggers need elevated privileges; where the migration role lacks them
-- the function above still runs in CI (scripts/test-migrations.ts) and the unit
-- scanner in lib/compliance/no-custody.test.ts.
do $$
begin
  create event trigger no_custody_columns on ddl_command_end
    when tag in ('CREATE TABLE', 'ALTER TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW')
    execute function public.enforce_no_custody_columns();
exception
  when insufficient_privilege or feature_not_supported then
    raise notice 'no_custody_columns event trigger not installed: %', sqlerrm;
end;
$$;
