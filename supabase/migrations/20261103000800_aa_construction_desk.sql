-- WS-AA · Construction desk (Phase 2, slot 08).
--
-- Pre-closing and post-construction tracking only. Kubera brokers the loan and
-- has no role in construction draws, so there are no money, draw, inspection or
-- servicing columns anywhere in this file (the no-custody guard from the WS-W
-- migration checks that).
--
-- construction_projects             one row per construction-related financing
-- construction_reports              third-party report tracker (PML, plan-and-cost, BPO, builder's risk, PCNA, Phase I)
-- construction_contractor_checks    CSLB contractor license lookups (history)
-- construction_conversions          CO date, loan maturity, HUD cost certification, payoff status
-- construction_leaseup_snapshots    occupancy / absorption snapshots per conversion
-- construction_takeouts             take-out refinance trigger and the deal it opened
-- construction_events               append-only audit trail
--
-- deal_id points at the deals table created by WS-I; the foreign key is added
-- there once both migrations have landed (same approach as the WS-W tables).
-- RLS is enabled on every table with no policies: only the service role reads
-- or writes.

create table public.construction_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deal_id uuid,
  lead_id uuid references public.leads (id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  program text not null check (program in (
    'HUD_221D4', 'HUD_232_NEW_CONSTRUCTION', 'HUD_223F', 'HUD_232_223F', 'AGENCY_MULTIFAMILY',
    'BANK_CONSTRUCTION', 'DEBT_FUND_CONSTRUCTION', 'PRIVATE_CONSTRUCTION', 'BRIDGE', 'HOTEL_PIP_BRIDGE'
  )),
  asset_type text not null check (asset_type in ('MULTIFAMILY', 'SENIOR_HOUSING', 'HOTEL', 'MIXED_USE', 'COMMERCIAL')),
  phase text not null default 'pre_closing' check (phase in ('pre_closing', 'under_construction', 'conversion', 'taken_out', 'closed_out')),
  property_address text,
  city text,
  state text check (state ~ '^[A-Z]{2}$'),
  zip text check (zip ~ '^\d{5}(-\d{4})?$'),
  units integer check (units >= 0),
  seismic_zone boolean not null default false,
  new_construction boolean not null default false,
  general_contractor_name text,
  general_contractor_license text check (general_contractor_license ~ '^\d{1,8}$'),
  notes text
);
create index construction_projects_deal_idx on public.construction_projects (deal_id) where deal_id is not null;
create index construction_projects_phase_idx on public.construction_projects (phase);

create table public.construction_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null references public.construction_projects (id) on delete cascade,
  report_type text not null check (report_type in ('seismic_pml', 'plan_and_cost_review', 'bpo', 'builders_risk', 'pcna', 'phase_i')),
  status text not null default 'not_ordered' check (status in (
    'not_ordered', 'order_pending_approval', 'order_blocked', 'ordered', 'in_progress',
    'delivered', 'revision_requested', 'accepted', 'cancelled'
  )),
  vendor_name text,
  vendor_email text,
  vendor_reference text,
  ordered_at timestamptz,
  due_at date,
  delivered_at timestamptz,
  accepted_at timestamptz,
  document_id uuid references public.documents (id) on delete set null,
  approval_id text,
  order_attempt integer not null default 0 check (order_attempt >= 0),
  notes text,
  -- A report is never ordered without a recorded broker approval (Global rule 2).
  constraint construction_reports_ordered_has_approval check (
    status in ('not_ordered', 'order_pending_approval', 'order_blocked', 'cancelled') or approval_id is not null
  ),
  constraint construction_reports_ordered_has_time check (
    status in ('not_ordered', 'order_pending_approval', 'order_blocked', 'cancelled') or ordered_at is not null
  ),
  constraint construction_reports_accepted_has_time check (status <> 'accepted' or accepted_at is not null)
);
-- One live report per type per project (a cancelled one can be replaced).
create unique index construction_reports_one_live_idx on public.construction_reports (project_id, report_type) where status <> 'cancelled';
create index construction_reports_project_idx on public.construction_reports (project_id);
create index construction_reports_open_due_idx on public.construction_reports (due_at) where status in ('ordered', 'in_progress', 'revision_requested');

create table public.construction_contractor_checks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.construction_projects (id) on delete cascade,
  license_number text not null check (license_number ~ '^\d{1,8}$'),
  contractor_name text,
  status text not null check (status in ('clear', 'issues', 'not_found', 'lookup_unavailable')),
  issues text[] not null default '{}',
  snapshot jsonb,
  checked_at timestamptz not null default now(),
  checked_by text not null,
  constraint construction_checks_issues_status check (status <> 'clear' or cardinality(issues) = 0)
);
create index construction_contractor_checks_project_idx on public.construction_contractor_checks (project_id, checked_at desc);

create table public.construction_conversions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null unique references public.construction_projects (id) on delete cascade,
  co_date date,
  units_total integer check (units_total >= 0),
  loan_maturity_date date,
  extension_deadline date,
  takeout_path text not null default 'refinance' check (takeout_path in ('refinance', 'hud_conversion')),
  hud_cost_cert_status text not null default 'not_applicable' check (hud_cost_cert_status in (
    'not_applicable', 'not_started', 'in_preparation', 'submitted', 'under_review', 'approved'
  )),
  hud_cost_cert_submitted_at date,
  hud_cost_cert_approved_at date,
  payoff_status text not null default 'not_scheduled' check (payoff_status in (
    'not_scheduled', 'takeout_selected', 'payoff_requested', 'payoff_confirmed'
  )),
  payoff_target_date date,
  payoff_confirmed_at date,
  notes text,
  constraint construction_conversions_cert_path check (takeout_path = 'hud_conversion' or hud_cost_cert_status = 'not_applicable'),
  constraint construction_conversions_payoff_confirmed check (payoff_status <> 'payoff_confirmed' or payoff_confirmed_at is not null)
);

create table public.construction_leaseup_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversion_id uuid not null references public.construction_conversions (id) on delete cascade,
  as_of date not null,
  units_leased integer not null check (units_leased >= 0),
  units_occupied integer not null check (units_occupied >= 0),
  avg_monthly_rent numeric(10, 2) check (avg_monthly_rent >= 0),
  noi_t3_annualized numeric(14, 2),
  unique (conversion_id, as_of),
  constraint construction_leaseup_occupied_within_leased check (units_occupied <= units_leased)
);

create table public.construction_takeouts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  conversion_id uuid not null unique references public.construction_conversions (id) on delete cascade,
  status text not null default 'triggered' check (status in ('triggered', 'deal_created', 'dismissed')),
  reasons text[] not null default '{}' check (reasons <@ array['stabilized_occupancy', 'maturity_runway', 'extension_deadline', 'manual']),
  suggested_programs text[] not null default '{}',
  -- The new refinance deal; foreign key added with the deals table (WS-I).
  new_deal_id uuid,
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  constraint construction_takeouts_deal_created check (status <> 'deal_created' or new_deal_id is not null)
);

-- Audit trail ---------------------------------------------------------------------
create table public.construction_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.construction_projects (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  event_type text not null,
  actor text not null,
  detail jsonb not null default '{}'
);
create index construction_events_project_idx on public.construction_events (project_id, id);

-- Append-only: rows are never updated, and are deleted only by the cascade from
-- a deleted project (pg_trigger_depth() > 1 means the delete came from the
-- foreign-key action, not a direct statement).
create or replace function public.construction_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'construction_events is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger construction_events_append_only before update or delete on public.construction_events
  for each row execute function public.construction_events_append_only();

-- updated_at upkeep ---------------------------------------------------------------
create or replace function public.construction_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger construction_projects_touch before update on public.construction_projects
  for each row execute function public.construction_touch_updated_at();
create trigger construction_reports_touch before update on public.construction_reports
  for each row execute function public.construction_touch_updated_at();
create trigger construction_conversions_touch before update on public.construction_conversions
  for each row execute function public.construction_touch_updated_at();
create trigger construction_takeouts_touch before update on public.construction_takeouts
  for each row execute function public.construction_touch_updated_at();

-- Row level security: service role only -------------------------------------------
alter table public.construction_projects enable row level security;
alter table public.construction_reports enable row level security;
alter table public.construction_contractor_checks enable row level security;
alter table public.construction_conversions enable row level security;
alter table public.construction_leaseup_snapshots enable row level security;
alter table public.construction_takeouts enable row level security;
alter table public.construction_events enable row level security;

comment on table public.construction_projects is 'Construction desk (WS-AA): pre-closing and post-construction tracking. Kubera has no draw role.';
