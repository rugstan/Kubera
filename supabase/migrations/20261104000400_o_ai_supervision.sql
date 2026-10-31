-- WS-O · AI supervision & reporting (Phase 3, slot 04).
--
-- ai_conversations      gains the staff-review fields (flag reason/actor, review status)
-- ai_review_annotations staff notes on a conversation or one of its messages
-- ai_guardrail_events   every sentence the output guardrails (lib/ai/guardrails.ts) caught
-- kb_chunks             embedding bookkeeping (model, content hash) for scripts/ingest-kb.ts
-- match_kb_chunks       hybrid retrieval: full-text and vector rankings fused (reciprocal rank)
-- lead_source_costs     marketing spend per lead source, for lead-source ROI in /reports
--
-- Broker only (Global rule 1): lead_source_costs records what Kubera spends on its
-- own marketing; nothing here models borrower, investor or loan funds. RLS is
-- enabled with no policies, so only the service role reads or writes (the
-- staff pages authorize through lib/auth first).

-- Staff review fields on the transcript table ------------------------------------------
alter table public.ai_conversations
  add column if not exists flag_reason text check (flag_reason is null or length(flag_reason) <= 300),
  add column if not exists flagged_at timestamptz,
  add column if not exists flagged_by text check (flagged_by is null or length(flagged_by) <= 200),
  add column if not exists review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'in_review', 'reviewed')),
  add column if not exists reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 200),
  add column if not exists reviewed_at timestamptz;

create index if not exists ai_conversations_review_idx on public.ai_conversations (review_status, last_message_at desc) where flagged;

-- Annotations ---------------------------------------------------------------------------
create table public.ai_review_annotations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  -- Index into ai_conversations.messages; null = a note on the whole conversation.
  message_index integer check (message_index is null or message_index >= 0),
  label text not null check (label in ('accurate', 'inaccurate', 'compliance_issue', 'missing_context', 'tone', 'good_example', 'other')),
  note text not null check (length(note) between 1 and 2000),
  author_id uuid,
  author_label text not null check (length(author_label) between 1 and 200)
);
create index ai_review_annotations_conversation_idx on public.ai_review_annotations (conversation_id, created_at);

-- Guardrail hits --------------------------------------------------------------------------
create table public.ai_guardrail_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  -- Index of the assistant message in ai_conversations.messages.
  message_index integer not null check (message_index >= 0),
  rule_id text not null check (length(rule_id) between 1 and 80),
  category text not null check (category in (
    'commitment', 'legal_advice', 'usury_exemption', 'guaranteed_timeline', 'broker_role', 'disclosure_waiver', 'prohibited_copy'
  )),
  -- The sentence as the model wrote it. Internal review only: the borrower saw the replacement.
  excerpt text not null check (length(excerpt) <= 600),
  replaced boolean not null,
  mode text not null check (mode in ('enforce', 'monitor'))
);
create index ai_guardrail_events_conversation_idx on public.ai_guardrail_events (conversation_id);
create index ai_guardrail_events_created_idx on public.ai_guardrail_events (created_at desc);
create index ai_guardrail_events_category_idx on public.ai_guardrail_events (category, created_at desc);

-- Review records are never edited (a correction is a new annotation). Deletes are
-- allowed so retention and privacy erasure can remove a conversation's records.
create or replace function public.ai_review_records_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are immutable; add a new row instead', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;
revoke execute on function public.ai_review_records_immutable() from public, anon, authenticated;

create trigger ai_review_annotations_no_update before update on public.ai_review_annotations
  for each row execute function public.ai_review_records_immutable();
create trigger ai_guardrail_events_no_update before update on public.ai_guardrail_events
  for each row execute function public.ai_review_records_immutable();

-- Knowledge base embeddings -------------------------------------------------------------------
-- content_sha256 lets the ingest script skip unchanged sections; embedding_model
-- records which model produced the vector so a model change re-embeds everything.
alter table public.kb_chunks
  add column if not exists content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists embedding_model text check (embedding_model is null or length(embedding_model) <= 120),
  add column if not exists embedded_at timestamptz;

create index if not exists kb_chunks_unembedded_idx on public.kb_chunks (id) where embedding is null;

-- Hybrid retrieval. Full-text and vector rankings are fused with reciprocal rank
-- fusion (k = 60), so a chunk that ranks well on either list surfaces and one that
-- ranks well on both wins. Without an embedding it is the full-text ranking alone,
-- exactly as before; without query text the vector ranking alone.
create or replace function public.match_kb_chunks(query_text text, query_embedding extensions.vector(1024) default null, match_count int default 6)
returns table (id bigint, source text, section text, content text, score real)
language sql stable
set search_path = public, extensions
as $$
  with params as (
    select websearch_to_tsquery('english', coalesce(query_text, '')) as tsq, greatest(coalesce(match_count, 6), 1) as n
  ),
  lexical as (
    select c.id as chunk_id, row_number() over (order by ts_rank(c.fts, p.tsq) desc, c.id) as rnk
    from public.kb_chunks c, params p
    where c.fts @@ p.tsq
    order by ts_rank(c.fts, p.tsq) desc, c.id
    limit (select n * 4 from params)
  ),
  semantic as (
    select c.id as chunk_id, row_number() over (order by c.embedding <=> query_embedding, c.id) as rnk
    from public.kb_chunks c
    where query_embedding is not null and c.embedding is not null
    order by c.embedding <=> query_embedding, c.id
    limit (select n * 4 from params)
  ),
  fused as (
    select u.chunk_id, sum(1.0 / (60 + u.rnk)) as rrf
    from (select l.chunk_id, l.rnk from lexical l union all select s.chunk_id, s.rnk from semantic s) u
    group by u.chunk_id
  )
  select c.id, c.source, c.section, c.content, f.rrf::real as score
  from fused f
  join public.kb_chunks c on c.id = f.chunk_id
  order by f.rrf desc, c.id
  limit (select n from params);
$$;

revoke execute on function public.match_kb_chunks(text, extensions.vector, int) from public, anon, authenticated;

-- Lead-source spend -------------------------------------------------------------------------------
-- Kubera's own marketing cost per lead source (leads.source) for a period. /reports
-- prorates a period that straddles the reporting window by days.
create table public.lead_source_costs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null check (length(created_by) between 1 and 200),
  source text not null check (length(source) between 1 and 80),
  period_start date not null,
  period_end date not null,
  spend_cents bigint not null check (spend_cents >= 0),
  note text check (note is null or length(note) <= 300),
  constraint lead_source_costs_period check (period_start <= period_end),
  unique (source, period_start, period_end)
);
create index lead_source_costs_period_idx on public.lead_source_costs (period_start, period_end);

-- RLS: service role only --------------------------------------------------------------------------------
alter table public.ai_review_annotations enable row level security;
alter table public.ai_guardrail_events enable row level security;
alter table public.lead_source_costs enable row level security;

revoke all on public.ai_review_annotations, public.ai_guardrail_events, public.lead_source_costs from anon, authenticated;
