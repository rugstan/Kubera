-- WS-S · Market intel & prospecting (Phase 4, slot 02).
--
-- intel_drafts            weekly market-intel drafts written from public signals only
--                         (xAI through the model gateway, or a rules digest when no key is
--                         set). A draft waits in the staff review queue; nothing here is
--                         published or sent.
-- prospect_scans          one row per refinance-maturity scan of recorded mortgage data
--                         (ATTOM / Reonomy), so a scan can be audited and repeated.
-- prospects               properties whose recorded mortgage matures inside the scan window,
--                         with an explainable score (score_factors) and a program fit.
-- prospect_outreach       outreach drafts to a prospect. Every draft is requested through the
--                         broker approval gate; a draft is sent (email) or released for
--                         mailing (letter) only after approval, and only once.
-- prospect_suppressions   do-not-contact list. Values are stored as SHA-256 hashes so the
--                         list can be checked without keeping the address in a second place.
--
-- Broker only (Global rule 1): these tables hold public-record facts and Corin's own
-- drafts. Loan figures are the recorded mortgage on the property, never funds Corin
-- handles. RLS is enabled with no policies, so only the service role reads or writes
-- (the staff pages authorize through lib/auth first).

create table public.intel_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Monday of the week the note covers.
  week_start date not null check (extract(isodow from week_start) = 1),
  version integer not null default 1 check (version > 0),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'superseded')),
  -- 'model' = written by the market-intel model; 'rules' = deterministic digest (no key, refusal or invalid output).
  generated_by text not null check (generated_by in ('model', 'rules')),
  model text check (model is null or length(model) <= 100),
  served_model text check (served_model is null or length(served_model) <= 100),
  prompt_id text check (prompt_id is null or length(prompt_id) <= 63),
  prompt_version text check (prompt_version is null or prompt_version ~ '^\d+\.\d+\.\d+$'),
  prompt_sha256 text check (prompt_sha256 is null or prompt_sha256 ~ '^[0-9a-f]{64}$'),
  headline text not null check (length(headline) between 1 and 200),
  summary text not null check (length(summary) between 1 and 4000),
  -- [{ title, bullets: [{ text, signalIds: [] }] }]
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  -- The public signals the draft was written from: [{ id, source, title, url, publishedAt }]
  signals jsonb not null default '[]'::jsonb check (jsonb_typeof(signals) = 'array'),
  -- Output-guardrail rule ids that matched the text (commitment language, guaranteed timelines...).
  guardrail_hits text[] not null default '{}',
  -- Prompt-injection finding codes seen in the signal text (the text was stripped before it reached the model).
  injection_codes text[] not null default '{}',
  note text check (note is null or length(note) <= 1000),
  created_by text not null default 'agent:intel' check (length(created_by) between 1 and 200),
  edited_by text check (edited_by is null or length(edited_by) <= 200),
  edited_at timestamptz,
  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 200),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 1000),
  constraint intel_drafts_week_version_unique unique (week_start, version),
  constraint intel_drafts_review_shape check (
    status in ('pending_review', 'superseded') or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint intel_drafts_rejected_reason check (status <> 'rejected' or review_note is not null)
);
create index intel_drafts_status_idx on public.intel_drafts (status, week_start desc);

create table public.prospect_scans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  provider text not null check (provider in ('attom', 'reonomy', 'fake')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  -- The query that ran: areas, window, property types.
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  found integer not null default 0 check (found >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error text check (error is null or length(error) <= 1000),
  started_by text not null check (length(started_by) between 1 and 200)
);
create index prospect_scans_created_idx on public.prospect_scans (created_at desc);

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Stable identity of the property + recorded loan, so a repeat scan updates the same row.
  dedupe_key text not null check (length(dedupe_key) between 8 and 300),
  source text not null check (source in ('attom', 'reonomy', 'fake', 'manual')),
  source_ref text check (source_ref is null or length(source_ref) <= 200),
  scan_id uuid references public.prospect_scans (id) on delete set null,
  address_line1 text not null check (length(address_line1) between 1 and 200),
  city text check (city is null or length(city) <= 100),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  zip text check (zip is null or zip ~ '^\d{5}(-\d{4})?$'),
  apn text check (apn is null or length(apn) <= 60),
  property_type text not null default 'other' check (property_type in (
    'multifamily', 'hotel', 'senior_housing', 'retail', 'office', 'industrial', 'mixed_use', 'self_storage', 'special_purpose', 'other'
  )),
  units integer check (units is null or units > 0),
  building_sqft integer check (building_sqft is null or building_sqft > 0),
  year_built integer check (year_built is null or year_built between 1700 and 2100),
  owner_name text check (owner_name is null or length(owner_name) <= 200),
  owner_kind text not null default 'unknown' check (owner_kind in ('entity', 'individual', 'unknown')),
  mailing_line1 text check (mailing_line1 is null or length(mailing_line1) <= 200),
  mailing_city text check (mailing_city is null or length(mailing_city) <= 100),
  mailing_state text check (mailing_state is null or mailing_state ~ '^[A-Z]{2}$'),
  mailing_zip text check (mailing_zip is null or mailing_zip ~ '^\d{5}(-\d{4})?$'),
  -- Staff-entered contact (public records carry no email address).
  contact_name text check (contact_name is null or length(contact_name) <= 200),
  contact_email text check (contact_email is null or (length(contact_email) <= 320 and contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  -- The recorded mortgage that matures (public record, not Corin's loan).
  loan_original_cents bigint check (loan_original_cents is null or loan_original_cents > 0),
  loan_lender text check (loan_lender is null or length(loan_lender) <= 200),
  loan_origination_date date,
  loan_maturity_date date not null,
  loan_rate_pct numeric(6, 3) check (loan_rate_pct is null or (loan_rate_pct >= 0 and loan_rate_pct < 40)),
  loan_type text check (loan_type is null or length(loan_type) <= 100),
  last_sale_date date,
  last_sale_price_cents bigint check (last_sale_price_cents is null or last_sale_price_cents > 0),
  data_as_of date not null,
  score integer not null check (score between 0 and 100),
  -- [{ factor, points, max, detail }]
  score_factors jsonb not null default '[]'::jsonb check (jsonb_typeof(score_factors) = 'array'),
  recommended_program text check (recommended_program is null or recommended_program in (
    'hud_223f', 'hud_232', 'sba_504', 'sba_7a', 'hotel_cmbs', 'agency', 'bank_life_co', 'bridge', 'other'
  )),
  window_bucket text not null check (window_bucket in ('matured', 'under_3_months', 'months_3_6', 'months_6_12', 'months_12_18', 'later')),
  status text not null default 'new' check (status in ('new', 'reviewing', 'drafted', 'contacted', 'engaged', 'not_a_fit', 'do_not_contact')),
  assigned_to text check (assigned_to is null or length(assigned_to) <= 200),
  notes text check (notes is null or length(notes) <= 4000),
  last_scanned_at timestamptz not null default now(),
  updated_by text check (updated_by is null or length(updated_by) <= 200),
  constraint prospects_dedupe_key_unique unique (dedupe_key)
);
create index prospects_rank_idx on public.prospects (score desc, loan_maturity_date) where status not in ('not_a_fit', 'do_not_contact');
create index prospects_status_idx on public.prospects (status, score desc);
create index prospects_maturity_idx on public.prospects (loan_maturity_date);
create index prospects_contact_email_idx on public.prospects (lower(contact_email)) where contact_email is not null;

create table public.prospect_outreach (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  version integer not null default 1 check (version > 0),
  channel text not null check (channel in ('email', 'letter')),
  status text not null default 'pending_approval' check (status in (
    'pending_approval', 'sent', 'ready_to_mail', 'mailed', 'rejected', 'expired', 'failed', 'blocked', 'cancelled'
  )),
  reason_code text check (reason_code is null or reason_code in (
    'approval_pending', 'approval_rejected', 'approval_expired', 'reauth_required', 'already_executed', 'sent', 'ready_to_mail', 'mailed',
    'send_failed', 'provider_unconfigured', 'suppressed', 'no_contact', 'consent_revoked', 'guardrail', 'cancelled'
  )),
  idempotency_key text not null check (length(idempotency_key) between 8 and 300),
  -- Email address or the mailing address (one line) the letter goes to.
  recipient text not null check (length(recipient) between 3 and 400),
  subject text not null check (length(subject) between 1 and 200),
  body_text text not null check (length(body_text) between 1 and 8000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  generated_by text not null default 'template' check (generated_by in ('template', 'model')),
  model text check (model is null or length(model) <= 100),
  guardrail_hits text[] not null default '{}',
  approval_id text,
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 300),
  error text check (error is null or length(error) <= 1000),
  drafted_by text not null check (length(drafted_by) between 1 and 200),
  sent_at timestamptz,
  mailed_at timestamptz,
  mailed_by text check (mailed_by is null or length(mailed_by) <= 200),
  constraint prospect_outreach_idempotency_key_unique unique (idempotency_key),
  constraint prospect_outreach_version_unique unique (prospect_id, version),
  constraint prospect_outreach_sent_shape check (status <> 'sent' or (sent_at is not null and channel = 'email' and approval_id is not null)),
  constraint prospect_outreach_mailed_shape check (status <> 'mailed' or (mailed_at is not null and mailed_by is not null and channel = 'letter')),
  -- Nothing leaves without a decision on record.
  constraint prospect_outreach_released_needs_approval check (status not in ('sent', 'ready_to_mail', 'mailed') or approval_id is not null)
);
create index prospect_outreach_prospect_idx on public.prospect_outreach (prospect_id, version desc);
create index prospect_outreach_waiting_idx on public.prospect_outreach (created_at) where status = 'pending_approval';

create table public.prospect_suppressions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('email', 'domain', 'owner', 'address')),
  -- SHA-256 of the normalized value (see lib/agents/intel/suppression.ts).
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  -- Masked hint for staff ("j***@example.com"); never the full value.
  label text not null check (length(label) between 1 and 120),
  reason text not null check (reason in ('opt_out', 'complaint', 'bounce', 'staff')),
  created_by text not null check (length(created_by) between 1 and 200),
  constraint prospect_suppressions_unique unique (kind, value_hash)
);

create trigger intel_drafts_touch before update on public.intel_drafts
  for each row execute function public.touch_updated_at();
create trigger prospects_touch before update on public.prospects
  for each row execute function public.touch_updated_at();
create trigger prospect_outreach_touch before update on public.prospect_outreach
  for each row execute function public.touch_updated_at();

alter table public.intel_drafts enable row level security;
alter table public.prospect_scans enable row level security;
alter table public.prospects enable row level security;
alter table public.prospect_outreach enable row level security;
alter table public.prospect_suppressions enable row level security;

revoke all on public.intel_drafts from anon, authenticated;
revoke all on public.prospect_scans from anon, authenticated;
revoke all on public.prospects from anon, authenticated;
revoke all on public.prospect_outreach from anon, authenticated;
revoke all on public.prospect_suppressions from anon, authenticated;
