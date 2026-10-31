-- WS-Z · Multifamily data & California rules (Phase 2, slot 07).
--
-- property_facts   cache of merged parcel / owner / flood / deed / rent-comp facts
--                  per normalized address (lib/data/property-facts.ts). Public-record
--                  and market data only; borrower data never goes in this table.
--
-- RLS is enabled with no policies: only the service role reads or writes.
-- Rows are a cache. They expire (expires_at) and may be deleted at any time;
-- nothing else references them.

create table public.property_facts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- lib/data/address.ts normalizeAddress(): line1|city|state|zip5, lower-case.
  address_key text not null unique check (length(address_key) between 3 and 400 and address_key = lower(address_key)),
  address jsonb not null check (jsonb_typeof(address) = 'object'),
  apn text check (apn is null or length(apn) <= 60),
  county text check (county is null or length(county) <= 80),
  -- Merged PropertyFacts document with per-field source, confidence and conflicts.
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  -- Per-source status (ok / not_found / not_configured / error / skipped), for monitoring.
  source_status jsonb not null default '{}'::jsonb check (jsonb_typeof(source_status) = 'object'),
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  constraint property_facts_expiry_after_fetch check (expires_at > fetched_at)
);

create index property_facts_expires_idx on public.property_facts (expires_at);
create index property_facts_apn_idx on public.property_facts (apn) where apn is not null;

create trigger property_facts_touch before update on public.property_facts
  for each row execute function public.touch_updated_at();

alter table public.property_facts enable row level security;
revoke all on public.property_facts from anon, authenticated;
