-- WS-T · Deal desk records (Phase 2, slot 02).
--
-- deals               extended with program, stage, stage template, term-sheet field locks
-- stage_templates     published copy of the per-program stage templates in lib/deals/stages.ts
-- lender_panel        lender appetite, broker-friendly flag, fee splits, verification date
-- deal_packages       versioned loan packages; a version is locked (immutable) when sent
-- share_links         expiring, per-lender links to one locked package version (token hashed)
-- lender_outreach     package submissions to lenders, each through the broker approval gate
-- fee_ledger          Corin's broker compensation per deal (record keeping only)
-- invoices            Corin's invoices for its own compensation, settled on the closing statement
-- deal_modifications  forbearance / extension / modification workflow (gate H, SB 1146)
-- sba_form159         SBA Form 159 fee disclosure data built from the ledger, e-sign status
-- dre_reporting       §10232 threshold monitor snapshots and RE 853 / RE 860 / RE 881 data
-- audit_log           append-only, trigger-written history of every row change above
--
-- Broker only (Global rule 1): nothing here accepts, holds, transfers or
-- disburses money. Amounts are Corin's own compensation as recorded on the
-- lender's closing statement. RLS is enabled with no policies: only the
-- service role reads or writes until WS-I defines staff policies.

-- Deals ----------------------------------------------------------------------------
-- WS-I (slot 01) creates the base table; this keeps the migration applicable on
-- its own and only adds what the deal desk needs.
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.deals
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists lead_id uuid references public.leads (id) on delete set null,
  add column if not exists twenty_opportunity_id uuid,
  add column if not exists title text,
  add column if not exists program text,
  add column if not exists stage text,
  add column if not exists stage_template_version integer,
  add column if not exists stage_entered_at timestamptz,
  add column if not exists owner_id uuid,
  add column if not exists borrower_name text,
  add column if not exists property_address text,
  add column if not exists property_state text,
  add column if not exists loan_amount_cents bigint,
  add column if not exists collateral_real_property boolean,
  add column if not exists engagement_agreement_ref text,
  add column if not exists term_sheet_accepted_at timestamptz,
  add column if not exists locked_fields text[] not null default '{}',
  add column if not exists locked_terms jsonb,
  add column if not exists lock_override_ref text,
  add column if not exists closed_on date,
  add column if not exists record_version integer not null default 1,
  add column if not exists updated_by text;

do $$
begin
  alter table public.deals add constraint deals_loan_amount_nonnegative check (loan_amount_cents is null or loan_amount_cents >= 0);
exception when duplicate_object then null;
end;
$$;

create index if not exists deals_stage_idx on public.deals (program, stage);
create index if not exists deals_lead_idx on public.deals (lead_id) where lead_id is not null;

-- After the borrower accepts a term sheet the economic terms are locked. A
-- change needs a documented modification: the caller sets a NEW
-- lock_override_ref (the deal_modifications id) in the same update.
create or replace function public.deals_enforce_term_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.term_sheet_accepted_at is not null
     and (new.program is distinct from old.program
          or new.loan_amount_cents is distinct from old.loan_amount_cents
          or new.locked_terms is distinct from old.locked_terms
          or new.term_sheet_accepted_at is distinct from old.term_sheet_accepted_at)
     and (new.lock_override_ref is null or new.lock_override_ref is not distinct from old.lock_override_ref) then
    raise exception 'Deal % terms are locked since term-sheet acceptance; record a modification first', old.id
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists deals_enforce_term_lock on public.deals;
create trigger deals_enforce_term_lock before update on public.deals
  for each row execute function public.deals_enforce_term_lock();

alter table public.deals enable row level security;

-- Stage templates ----------------------------------------------------------------------
create table public.stage_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  program text not null,
  version integer not null check (version > 0),
  name text not null,
  stages jsonb not null,
  events jsonb not null,
  locked_fields text[] not null default '{}',
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  unique (program, version)
);

-- Published template versions never change (deals reference them by version).
create or replace function public.stage_templates_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'stage_templates rows are immutable; publish a new version' using errcode = 'insufficient_privilege';
end;
$$;
create trigger stage_templates_immutable before update or delete on public.stage_templates
  for each row execute function public.stage_templates_immutable();

-- Lender panel -----------------------------------------------------------------------------
create table public.lender_panel (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  partner_id uuid references public.partners (id) on delete set null,
  name text not null,
  category text not null check (category in (
    'NATIONAL_BANK', 'STATE_BANK', 'SAVINGS_ASSOCIATION', 'CREDIT_UNION', 'INSURANCE_COMPANY',
    'CFL_LICENSEE', 'INDUSTRIAL_LOAN_COMPANY', 'PRIVATE_NON_EXEMPT', 'UNKNOWN'
  )),
  category_evidence_ref text,
  programs text[] not null default '{}',
  min_loan_cents bigint check (min_loan_cents is null or min_loan_cents >= 0),
  max_loan_cents bigint check (max_loan_cents is null or max_loan_cents >= 0),
  states text[] not null default '{}',
  asset_types text[] not null default '{}',
  appetite_notes text,
  broker_friendly boolean not null default false,
  fee_split_kind text not null default 'none' check (fee_split_kind in ('none', 'percent_of_loan', 'percent_of_lender_fee', 'flat')),
  fee_split_value numeric(12, 4) not null default 0 check (fee_split_value >= 0),
  fee_agreement_ref text,
  contact_name text,
  contact_email text,
  verified_at timestamptz,
  verified_by text,
  active boolean not null default true,
  constraint lender_panel_loan_range check (min_loan_cents is null or max_loan_cents is null or min_loan_cents <= max_loan_cents)
);
create index lender_panel_programs_idx on public.lender_panel using gin (programs);

-- Loan packages ---------------------------------------------------------------------------
create table public.deal_packages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  deal_id uuid not null references public.deals (id) on delete restrict,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'locked')),
  manifest jsonb not null default '[]',
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  locked_at timestamptz,
  locked_by text,
  unique (deal_id, version),
  constraint deal_packages_locked_shape check (status <> 'locked' or (locked_at is not null and locked_by is not null))
);

-- A locked version is what a lender saw: it can never change or disappear.
create or replace function public.deal_packages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'locked' then
    raise exception 'Package % version % is locked', old.deal_id, old.version using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger deal_packages_guard before update or delete on public.deal_packages
  for each row execute function public.deal_packages_guard();

-- Share links ------------------------------------------------------------------------------
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  deal_id uuid not null references public.deals (id) on delete restrict,
  lender_id uuid not null references public.lender_panel (id) on delete restrict,
  package_id uuid not null references public.deal_packages (id) on delete restrict,
  package_version integer not null check (package_version > 0),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  access_count integer not null default 0 check (access_count >= 0),
  last_accessed_at timestamptz,
  updated_by text,
  constraint share_links_expiry check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  constraint share_links_revoked_shape check (revoked_at is null or revoked_by is not null)
);
create index share_links_deal_idx on public.share_links (deal_id, lender_id);

-- Lender outreach -----------------------------------------------------------------------------
create table public.lender_outreach (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deal_id uuid not null references public.deals (id) on delete restrict,
  lender_id uuid not null references public.lender_panel (id) on delete restrict,
  package_id uuid not null references public.deal_packages (id) on delete restrict,
  package_version integer not null,
  share_link_id uuid references public.share_links (id) on delete restrict,
  status text not null check (status in ('pending_approval', 'approved', 'sent', 'rejected', 'expired', 'declined', 'term_sheet', 'withdrawn')),
  approval_key text not null unique,
  approval_id text,
  approved_by text,
  requested_by text not null,
  sent_at timestamptz,
  external_message_id text,
  response_note text,
  term_sheet_ref text,
  stale_lender_override boolean not null default false,
  unique (deal_id, lender_id, package_version),
  constraint lender_outreach_sent_shape check (status not in ('sent', 'declined', 'term_sheet') or (sent_at is not null and share_link_id is not null))
);
create index lender_outreach_deal_idx on public.lender_outreach (deal_id);

-- Fee ledger ------------------------------------------------------------------------------------
create table public.fee_ledger (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deal_id uuid not null references public.deals (id) on delete restrict,
  entry_kind text not null check (entry_kind in (
    'broker_fee', 'lender_paid_compensation', 'agency_split', 'hard_money_points',
    'extension_fee', 'modification_fee', 'sba_packaging_fee', 'referral_fee', 'co_broker_split'
  )),
  payer text not null check (payer in ('borrower', 'lender', 'corin')),
  payee text not null check (payee in ('corin', 'co_broker', 'referral_partner')),
  basis text not null check (basis in ('flat', 'percent_of_loan', 'points', 'percent_of_lender_fee')),
  rate_pct numeric(12, 6),
  base_cents bigint check (base_cents is null or base_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null check (status in ('projected', 'earned', 'invoiced', 'settled', 'void')),
  sba159_category text check (sba159_category in ('packaging', 'other_services', 'referral')),
  description text not null,
  counterparty text,
  earned_on date,
  invoice_id uuid,
  modification_id uuid,
  idempotency_key text not null unique,
  void_reason text,
  constraint fee_ledger_void_reason check (status <> 'void' or void_reason is not null),
  -- Corin pays only a co-broker or referral partner's share, and only as a ledger record.
  constraint fee_ledger_party_shape check ((payee = 'corin' and payer <> 'corin') or (payee <> 'corin' and payer = 'corin'))
);
create index fee_ledger_deal_idx on public.fee_ledger (deal_id);

-- Invoiced or settled entries are frozen; corrections void and re-enter.
create or replace function public.fee_ledger_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'fee_ledger rows are never deleted; void them' using errcode = 'insufficient_privilege';
  end if;
  if old.status in ('invoiced', 'settled', 'void')
     and (new.amount_cents is distinct from old.amount_cents
          or new.payer is distinct from old.payer
          or new.payee is distinct from old.payee
          or new.entry_kind is distinct from old.entry_kind
          or new.deal_id is distinct from old.deal_id) then
    raise exception 'fee_ledger entry % is % and cannot change amount or parties', old.id, old.status
      using errcode = 'check_violation';
  end if;
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A void fee_ledger entry cannot be reinstated' using errcode = 'check_violation';
  end if;
  if old.status = 'settled' and new.status <> 'settled' then
    raise exception 'A settled fee_ledger entry is final' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger fee_ledger_guard before update or delete on public.fee_ledger
  for each row execute function public.fee_ledger_guard();

-- Invoices ------------------------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deal_id uuid not null references public.deals (id) on delete restrict,
  number text not null unique,
  bill_to_kind text not null check (bill_to_kind in ('borrower', 'lender')),
  bill_to_name text not null,
  bill_to_email text,
  status text not null check (status in ('draft', 'pending_approval', 'issued', 'settled', 'void')),
  lines jsonb not null,
  total_cents bigint not null check (total_cents >= 0),
  issued_at timestamptz,
  due_on date,
  settled_on date,
  closing_statement_ref text,
  approval_key text unique,
  approval_id text,
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  void_reason text,
  constraint invoices_issued_shape check (status not in ('issued', 'settled') or issued_at is not null),
  constraint invoices_settled_shape check (status <> 'settled' or (settled_on is not null and closing_statement_ref is not null)),
  constraint invoices_void_reason check (status <> 'void' or void_reason is not null)
);
create index invoices_deal_idx on public.invoices (deal_id);

-- Gapless enough for a broker desk; numbers are never reused.
create sequence public.invoice_number_seq;
create or replace function public.next_invoice_number(p_year integer)
returns text
language sql
set search_path = ''
as $$
  select format('CC-%s-%s', p_year, lpad(nextval('public.invoice_number_seq')::text, 4, '0'))
$$;
revoke execute on function public.next_invoice_number(integer) from public, anon, authenticated;
revoke all on sequence public.invoice_number_seq from anon, authenticated;

alter table public.fee_ledger
  add constraint fee_ledger_invoice_fk foreign key (invoice_id) references public.invoices (id) on delete restrict;

create or replace function public.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'invoices are never deleted; void them' using errcode = 'insufficient_privilege';
  end if;
  if old.status in ('issued', 'settled', 'void')
     and (new.lines is distinct from old.lines or new.total_cents is distinct from old.total_cents
          or new.bill_to_name is distinct from old.bill_to_name or new.number is distinct from old.number) then
    raise exception 'Invoice % is % and its lines cannot change', old.number, old.status using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger invoices_guard before update or delete on public.invoices
  for each row execute function public.invoices_guard();

-- Modifications (gate H) -------------------------------------------------------------------------------
create table public.deal_modifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deal_id uuid not null references public.deals (id) on delete restrict,
  kind text not null check (kind in ('forbearance', 'extension', 'modification')),
  status text not null check (status in (
    'held_for_counsel', 'blocked', 'incomplete', 'pending_lender_notice', 'no_exemption_representation', 'documented', 'withdrawn'
  )),
  parent_broker_of_record_id uuid not null references public.broker_of_record (id) on delete restrict,
  broker_of_record_id uuid references public.broker_of_record (id) on delete restrict,
  facts jsonb not null,
  evaluation jsonb not null,
  flags text[] not null default '{}',
  lender_notice_approval_key text unique,
  lender_notice_sent_at timestamptz,
  officer_approved_by text,
  officer_approved_at timestamptz,
  fee_entry_id uuid references public.fee_ledger (id) on delete restrict,
  terms_applied_at timestamptz
);
create index deal_modifications_deal_idx on public.deal_modifications (deal_id);

alter table public.fee_ledger
  add constraint fee_ledger_modification_fk foreign key (modification_id) references public.deal_modifications (id) on delete restrict;

-- SBA Form 159 ------------------------------------------------------------------------------------------
create table public.sba_form159 (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deal_id uuid not null references public.deals (id) on delete restrict,
  version integer not null check (version > 0),
  sba_program text not null check (sba_program in ('7A', '504')),
  status text not null check (status in ('generated', 'pending_approval', 'sent', 'signed', 'superseded')),
  data jsonb not null,
  ledger_entry_ids uuid[] not null default '{}',
  flags text[] not null default '{}',
  template_version text not null,
  draft boolean not null,
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  document_path text,
  approval_key text unique,
  approval_id text,
  provider text check (provider in ('zoho_sign', 'boldsign', 'fake')),
  provider_request_id text,
  sent_at timestamptz,
  signed_at timestamptz,
  unique (deal_id, version),
  constraint sba_form159_sent_shape check (status not in ('sent', 'signed') or (provider is not null and provider_request_id is not null and sent_at is not null))
);

-- DRE reporting -----------------------------------------------------------------------------------------
create table public.dre_reporting (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null,
  report_kind text not null check (report_kind in ('threshold_monitor', 'RE853', 'RE860', 'RE881')),
  as_of date not null,
  period_start date not null,
  period_end date not null,
  counters jsonb not null,
  threshold_met boolean not null,
  first_met_on date,
  notify_by date,
  notified_on date,
  export jsonb,
  unique (report_kind, as_of),
  constraint dre_reporting_period check (period_start <= period_end)
);

-- Audit log (append-only, trigger-written) --------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  table_name text not null,
  row_id text not null,
  deal_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor text not null,
  changed text[] not null default '{}',
  old_row jsonb,
  new_row jsonb
);
create index audit_log_row_idx on public.audit_log (table_name, row_id, id);
create index audit_log_deal_idx on public.audit_log (deal_id, id) where deal_id is not null;

create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

-- Writes one audit row per change. Actor: the row's updated_by / created_by /
-- locked_by, else the JWT subject, else the app.actor setting, else the role.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  who text;
  diff text[];
  deal uuid;
begin
  who := coalesce(
    nullif(r ->> 'updated_by', ''),
    nullif(r ->> 'created_by', ''),
    nullif(r ->> 'locked_by', ''),
    nullif(r ->> 'requested_by', ''),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''),
    nullif(current_setting('app.actor', true), ''),
    current_user::text
  );
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into diff
    from jsonb_object_keys(n) as k
    where (n -> k) is distinct from (o -> k) and k not in ('updated_at');
    if cardinality(diff) = 0 then
      return new;
    end if;
  end if;
  deal := case when tg_table_name = 'deals' then (r ->> 'id')::uuid else nullif(r ->> 'deal_id', '')::uuid end;
  insert into public.audit_log (table_name, row_id, deal_id, action, actor, changed, old_row, new_row)
  values (tg_table_name, r ->> 'id', deal, tg_op, who, coalesce(diff, '{}'), o, n);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['deals', 'stage_templates', 'lender_panel', 'deal_packages', 'share_links', 'lender_outreach',
                           'fee_ledger', 'invoices', 'deal_modifications', 'sba_form159', 'dre_reporting'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end;
$$;

-- Touch updated_at on tables without a guard trigger that already does it.
create trigger lender_panel_touch before update on public.lender_panel
  for each row execute function public.touch_updated_at();
create trigger lender_outreach_touch before update on public.lender_outreach
  for each row execute function public.touch_updated_at();
create trigger deal_modifications_touch before update on public.deal_modifications
  for each row execute function public.touch_updated_at();
create trigger sba_form159_touch before update on public.sba_form159
  for each row execute function public.touch_updated_at();

-- Share-link access counter: one atomic statement, returns the link only while valid.
create or replace function public.record_share_link_access(p_token_hash text)
returns setof public.share_links
language sql
set search_path = ''
as $$
  update public.share_links
     set access_count = access_count + 1, last_accessed_at = now(), updated_by = 'share_link:access'
   where token_hash = p_token_hash and revoked_at is null and expires_at > now()
  returning *;
$$;
revoke execute on function public.record_share_link_access(text) from public, anon, authenticated;

-- RLS: service role only -----------------------------------------------------------------------------------------
alter table public.stage_templates enable row level security;
alter table public.lender_panel enable row level security;
alter table public.deal_packages enable row level security;
alter table public.share_links enable row level security;
alter table public.lender_outreach enable row level security;
alter table public.fee_ledger enable row level security;
alter table public.invoices enable row level security;
alter table public.deal_modifications enable row level security;
alter table public.sba_form159 enable row level security;
alter table public.dre_reporting enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.stage_templates, public.lender_panel, public.deal_packages, public.share_links, public.lender_outreach,
  public.fee_ledger, public.invoices, public.deal_modifications, public.sba_form159, public.dre_reporting, public.audit_log
  from anon, authenticated;
