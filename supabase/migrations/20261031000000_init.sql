-- Kubera Commercial — core schema.
-- Twenty CRM is the system of record for relationships and pipeline; Supabase
-- keeps the raw intake, Jev decisions, partner registrations, rate history,
-- the RAG knowledge base, and the encrypted borrower document vault.

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Leads ---------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  contact jsonb not null,
  intake jsonb not null,
  decision jsonb not null,
  rationale text[] not null default '{}',
  engine text not null,
  latency_ms integer not null,
  urgency_tier text generated always as (decision->>'leadUrgencyTier') stored,
  primary_program text generated always as (decision->>'primaryProgramFit') stored,
  loan_amount numeric generated always as ((intake->>'loanAmount')::numeric) stored,
  twenty_person_id uuid,
  twenty_opportunity_id uuid,
  crm_error text
);
create index leads_created_at_idx on public.leads (created_at desc);
create index leads_tier_idx on public.leads (urgency_tier);

-- Partners --------------------------------------------------------------------
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  partner_type text not null check (partner_type in ('LENDER', 'REFERRAL', 'OPERATOR', 'VENDOR')),
  organization text,
  email text not null,
  profile jsonb not null,
  status text not null default 'PENDING_REVIEW' check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  twenty_company_id uuid,
  crm_error text
);
create index partners_type_idx on public.partners (partner_type, status);

-- Borrower documents (T-12s, STR reports, rent rolls, franchise agreements, PIPs)
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind text not null check (kind in ('T12', 'RENT_ROLL', 'CENSUS', 'STR_REPORT', 'FRANCHISE_AGREEMENT', 'PIP_BUDGET', 'PFS', 'TAX_RETURN', 'APPRAISAL', 'OTHER')),
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  extracted jsonb
);
create index documents_lead_idx on public.documents (lead_id);

-- Rate history ------------------------------------------------------------------
create table public.rate_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  as_of date not null,
  live boolean not null,
  benchmarks jsonb not null
);
create index rate_snapshots_captured_idx on public.rate_snapshots (captured_at desc);

-- CRM webhook events --------------------------------------------------------------
create table public.crm_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event_name text not null,
  record_id uuid,
  payload jsonb not null
);

-- Knowledge base (HUD 4232.1, MAP Guide, SBA SOP 50 10, CMBS / STR standards, CA DRE + Title 22)
create table public.kb_chunks (
  id bigint generated always as identity primary key,
  source text not null,
  section text,
  content text not null,
  -- 1024 dims matches voyage-3.5; change with the embedding model.
  embedding extensions.vector(1024),
  fts tsvector generated always as (to_tsvector('english', coalesce(section, '') || ' ' || content)) stored,
  unique (source, section)
);
create index kb_chunks_fts_idx on public.kb_chunks using gin (fts);
create index kb_chunks_embedding_idx on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- Hybrid retrieval: vector similarity when an embedding is supplied, full-text otherwise.
create or replace function public.match_kb_chunks(query_text text, query_embedding extensions.vector(1024) default null, match_count int default 6)
returns table (id bigint, source text, section text, content text, score real)
language sql stable
set search_path = public, extensions
as $$
  select c.id, c.source, c.section, c.content,
    case when query_embedding is null
      then ts_rank(c.fts, websearch_to_tsquery('english', query_text))
      else (1 - (c.embedding <=> query_embedding))::real
    end as score
  from public.kb_chunks c
  where (query_embedding is null and c.fts @@ websearch_to_tsquery('english', query_text))
     or (query_embedding is not null and c.embedding is not null)
  order by score desc
  limit match_count;
$$;

-- Row Level Security: no anon/authenticated access. Server routes use the service role.
alter table public.leads enable row level security;
alter table public.partners enable row level security;
alter table public.documents enable row level security;
alter table public.rate_snapshots enable row level security;
alter table public.crm_events enable row level security;
alter table public.kb_chunks enable row level security;

revoke execute on function public.match_kb_chunks from anon, authenticated;

-- Private, encrypted-at-rest bucket for borrower financials. Uploads go through
-- short-lived signed URLs minted by the server; no public reads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-documents', 'deal-documents', false, 52428800,
  array['application/pdf', 'text/csv', 'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg']
)
on conflict (id) do nothing;
