-- WS-M · Lender matching (Phase 3, slot 02).
--
-- credit_boxes  typed lender appetite (programs, size, leverage, coverage, recourse,
--               structure, pricing indications), sourced from /partners lender
--               registrations or staff edits, with an approval status and a
--               verification date. Only approved boxes are used by the matcher.
-- quotes        lender term sheets / quotes per deal (parsed from lenders@ mail or
--               entered by staff) with normalized terms, per-field confidence and
--               the computed all-in cost.
--
-- Broker only (Global rule 1): nothing here accepts, holds, transfers or
-- disburses money. Reserve amounts in a quote are what the LENDER requires the
-- borrower to fund with the lender; they are recorded only to compare offers.
-- RLS is enabled with no policies: only the service role reads or writes.

-- Credit boxes ---------------------------------------------------------------------------
create table public.credit_boxes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  lender_id uuid references public.lender_panel (id) on delete restrict,
  partner_id uuid references public.partners (id) on delete set null,
  source text not null check (source in ('partner_registration', 'staff')),
  status text not null check (status in ('pending_review', 'approved', 'rejected', 'retired')),
  label text not null check (length(label) between 1 and 160),
  programs text[] not null default '{}',
  asset_classes text[] not null default '{}' check (asset_classes <@ array['SENIOR_LIVING', 'HOSPITALITY', 'MULTIFAMILY', 'COMMERCIAL', 'CONSTRUCTION']::text[]),
  states text[] not null default '{}',
  min_loan_cents bigint check (min_loan_cents is null or min_loan_cents >= 0),
  max_loan_cents bigint check (max_loan_cents is null or max_loan_cents >= 0),
  max_ltv_pct numeric(6, 3) check (max_ltv_pct is null or (max_ltv_pct > 0 and max_ltv_pct <= 100)),
  max_ltc_pct numeric(6, 3) check (max_ltc_pct is null or (max_ltc_pct > 0 and max_ltc_pct <= 100)),
  min_dscr numeric(6, 3) check (min_dscr is null or (min_dscr >= 0 and min_dscr <= 5)),
  min_debt_yield_pct numeric(6, 3) check (min_debt_yield_pct is null or (min_debt_yield_pct >= 0 and min_debt_yield_pct <= 50)),
  lien_positions text[] not null default '{first}' check (lien_positions <@ array['first', 'second']::text[] and cardinality(lien_positions) > 0),
  recourse text check (recourse in ('full', 'partial', 'non_recourse', 'negotiable')),
  max_term_months integer check (max_term_months is null or max_term_months between 1 and 600),
  max_amortization_months integer check (max_amortization_months is null or max_amortization_months between 1 and 600),
  max_io_months integer check (max_io_months is null or max_io_months between 0 and 600),
  rate_min_pct numeric(7, 4) check (rate_min_pct is null or (rate_min_pct >= 0 and rate_min_pct <= 40)),
  rate_max_pct numeric(7, 4) check (rate_max_pct is null or (rate_max_pct >= 0 and rate_max_pct <= 40)),
  origination_fee_pct numeric(6, 3) check (origination_fee_pct is null or (origination_fee_pct >= 0 and origination_fee_pct <= 10)),
  broker_compensation_pct numeric(6, 3) check (broker_compensation_pct is null or (broker_compensation_pct >= 0 and broker_compensation_pct <= 10)),
  typical_close_days integer check (typical_close_days is null or typical_close_days between 1 and 730),
  franchise_requirements text check (franchise_requirements is null or length(franchise_requirements) <= 400),
  notes text check (notes is null or length(notes) <= 2000),
  verified_at timestamptz,
  verified_by text,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text check (review_note is null or length(review_note) <= 500),
  record_version integer not null default 1 check (record_version > 0),
  constraint credit_boxes_loan_range check (min_loan_cents is null or max_loan_cents is null or min_loan_cents <= max_loan_cents),
  constraint credit_boxes_rate_range check (rate_min_pct is null or rate_max_pct is null or rate_min_pct <= rate_max_pct),
  constraint credit_boxes_owner check (lender_id is not null or partner_id is not null),
  -- An approved box is tied to a panel lender, names at least one program and was reviewed.
  constraint credit_boxes_approved_shape check (
    status <> 'approved' or (lender_id is not null and cardinality(programs) > 0 and reviewed_at is not null and reviewed_by is not null)
  ),
  constraint credit_boxes_rejected_reason check (status <> 'rejected' or review_note is not null)
);
create index credit_boxes_lender_idx on public.credit_boxes (lender_id) where lender_id is not null;
create index credit_boxes_programs_idx on public.credit_boxes using gin (programs);
create index credit_boxes_status_idx on public.credit_boxes (status);
-- One imported box per partner registration (re-imports update it instead of duplicating).
create unique index credit_boxes_partner_registration_uidx on public.credit_boxes (partner_id) where source = 'partner_registration';

-- Quotes -----------------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  deal_id uuid not null references public.deals (id) on delete restrict,
  lender_id uuid references public.lender_panel (id) on delete restrict,
  lender_name text not null check (length(lender_name) between 1 and 160),
  outreach_id uuid references public.lender_outreach (id) on delete set null,
  mail_message_id uuid references public.mail_messages (id) on delete set null,
  source text not null check (source in ('email_parse', 'staff')),
  status text not null check (status in ('needs_review', 'active', 'accepted', 'declined', 'withdrawn', 'expired')),
  -- Normalized terms (lib/agents/lenders/types.ts QuoteTerms) and per-field confidence (0..1).
  terms jsonb not null check (jsonb_typeof(terms) = 'object'),
  confidence jsonb not null default '{}'::jsonb check (jsonb_typeof(confidence) = 'object'),
  low_confidence_fields text[] not null default '{}',
  -- Computed all-in cost (lib/agents/lenders/all-in.ts) and the assumptions it used.
  all_in jsonb check (all_in is null or jsonb_typeof(all_in) = 'object'),
  all_in_rate_pct numeric(8, 4),
  binding_constraint text check (binding_constraint in ('ltv', 'ltc', 'dscr', 'debt_yield', 'loan_amount', 'program_max')),
  parser text not null check (parser in ('model', 'rules', 'staff')),
  parser_model text check (parser_model is null or length(parser_model) <= 100),
  received_at timestamptz not null,
  expires_on date,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text check (review_note is null or length(review_note) <= 500),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  -- A parsed quote with low-confidence fields is used (active / accepted) only after a person reviewed it.
  constraint quotes_review_shape check (status not in ('active', 'accepted') or source = 'staff' or (reviewed_at is not null and reviewed_by is not null) or cardinality(low_confidence_fields) = 0)
);
create index quotes_deal_idx on public.quotes (deal_id, received_at desc);
create unique index quotes_mail_message_uidx on public.quotes (mail_message_id) where mail_message_id is not null;

-- Audit (WS-T trigger) and updated_at ------------------------------------------------------
create trigger credit_boxes_audit after insert or update or delete on public.credit_boxes
  for each row execute function public.audit_row_change();
create trigger quotes_audit after insert or update or delete on public.quotes
  for each row execute function public.audit_row_change();
create trigger credit_boxes_touch before update on public.credit_boxes
  for each row execute function public.touch_updated_at();
create trigger quotes_touch before update on public.quotes
  for each row execute function public.touch_updated_at();

-- RLS: service role only ---------------------------------------------------------------------
alter table public.credit_boxes enable row level security;
alter table public.quotes enable row level security;
revoke all on public.credit_boxes, public.quotes from anon, authenticated;
