-- WS-AB · Agent safety platform (Phase 3, slot 06).
--
-- agent_events               insert-only audit trail of everything an AI agent
--                            does: tool requests and outcomes, approval waits,
--                            decisions with reason codes, injection findings.
--                            Each row records the agent, prompt, model and tool
--                            versions, the approver and any external message ids.
--                            Rows in a chain are hash-linked (tamper evidence).
-- agent_task_autonomy        history of per-task autonomy levels
--                            (audit / assist / automate); the latest row wins.
-- approval_reauthentications step-up re-authentication by the approving broker
--                            for MLDS, Form 159, lender submissions and fee
--                            quotes, bound to the approval and its payload hash.
--
-- Nothing here models funds: Kubera brokers loans and never holds or moves money.
-- RLS is enabled with no policies: only the service role reads or writes.

-- Agent events -------------------------------------------------------------------------------
create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  event_type text not null check (event_type ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  agent text not null check (agent ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  agent_version text check (agent_version is null or agent_version ~ '^\d+\.\d+\.\d+$'),
  task text check (task is null or task ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  autonomy text check (autonomy is null or autonomy in ('audit', 'assist', 'automate')),
  run_id uuid references public.agent_runs (id) on delete set null,
  deal_id uuid,
  lead_id uuid references public.leads (id) on delete set null,
  -- Prompt and model versions (lib/agents/core/registry.ts). Never prompt text.
  prompt_id text check (prompt_id is null or prompt_id ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  prompt_version text check (prompt_version is null or prompt_version ~ '^\d+\.\d+\.\d+$'),
  prompt_sha256 text check (prompt_sha256 is null or prompt_sha256 ~ '^[0-9a-f]{64}$'),
  model text check (model is null or length(model) <= 100),
  served_model text check (served_model is null or length(served_model) <= 100),
  tool_name text check (tool_name is null or tool_name ~ '^[a-z][a-z0-9_.]{1,62}$'),
  tool_version text check (tool_version is null or tool_version ~ '^\d+\.\d+\.\d+$'),
  -- Approval gate (Global rule 2).
  approval_id uuid references public.approvals (id) on delete restrict,
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 8 and 300),
  approver_id uuid references public.profiles (id) on delete set null,
  approver_label text check (approver_label is null or length(approver_label) <= 200),
  approver_dre text check (approver_dre is null or approver_dre ~ '^\d{8}$'),
  outcome text check (outcome is null or outcome in (
    'proposed', 'pending_approval', 'executed', 'already_executed', 'rejected', 'expired', 'blocked', 'failed', 'recorded'
  )),
  -- Provider ids of what went out (email message id, SMS id, envelope id).
  external_message_ids text[] not null default '{}' check (cardinality(external_message_ids) <= 50),
  reason_codes text[] not null default '{}' check (cardinality(reason_codes) <= 64),
  -- Metadata only (counts, codes, ids); never message bodies or restricted data.
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 16384),
  -- Optional hash chain: rows sharing a chain are numbered 1, 2, 3 … and each
  -- carries the previous row's hash. The hash itself is computed by the app.
  chain text check (chain is null or chain ~ '^[a-z][a-z0-9_.:-]{1,120}$'),
  seq bigint check (seq is null or seq >= 1),
  prev_hash text check (prev_hash is null or prev_hash ~ '^[0-9a-f]{64}$'),
  hash text check (hash is null or hash ~ '^[0-9a-f]{64}$'),
  constraint agent_events_chain_shape check (
    (chain is null and seq is null and prev_hash is null and hash is null)
    or (chain is not null and seq is not null and hash is not null and ((seq = 1) = (prev_hash is null)))
  ),
  constraint agent_events_chain_seq unique (chain, seq),
  constraint agent_events_reason_codes_shape check (
    array_to_string(reason_codes, ',') ~ '^([a-z][a-z0-9_]*(\.[a-z0-9_]+)*(,|$))*$'
  )
);
create index agent_events_occurred_idx on public.agent_events (occurred_at desc);
create index agent_events_agent_idx on public.agent_events (agent, occurred_at desc);
create index agent_events_deal_idx on public.agent_events (deal_id, occurred_at desc) where deal_id is not null;
create index agent_events_lead_idx on public.agent_events (lead_id, occurred_at desc) where lead_id is not null;
create index agent_events_run_idx on public.agent_events (run_id) where run_id is not null;
create index agent_events_approval_idx on public.agent_events (approval_id) where approval_id is not null;
create index agent_events_idem_idx on public.agent_events (idempotency_key) where idempotency_key is not null;
create index agent_events_attention_idx on public.agent_events (occurred_at desc) where outcome in ('blocked', 'failed');
create index agent_events_reason_idx on public.agent_events using gin (reason_codes);

-- deals (WS-I) exists in every environment after Phase 2; link when it does.
do $$
begin
  if to_regclass('public.deals') is not null then
    alter table public.agent_events add constraint agent_events_deal_fk foreign key (deal_id) references public.deals (id) on delete set null;
  end if;
end;
$$;

-- Insert-only: no update, delete or truncate. Foreign keys that null a
-- reference (run, lead, deal or approver deleted) are the only permitted
-- update, and only when nothing else on the row changes.
create or replace function public.agent_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and (new.id, new.occurred_at, new.recorded_at, new.event_type, new.agent, new.agent_version, new.task, new.autonomy,
          new.prompt_id, new.prompt_version, new.prompt_sha256, new.model, new.served_model, new.tool_name, new.tool_version,
          new.approval_id, new.idempotency_key, new.approver_label, new.approver_dre, new.outcome, new.external_message_ids,
          new.reason_codes, new.detail, new.chain, new.seq, new.prev_hash, new.hash)
         is not distinct from
         (old.id, old.occurred_at, old.recorded_at, old.event_type, old.agent, old.agent_version, old.task, old.autonomy,
          old.prompt_id, old.prompt_version, old.prompt_sha256, old.model, old.served_model, old.tool_name, old.tool_version,
          old.approval_id, old.idempotency_key, old.approver_label, old.approver_dre, old.outcome, old.external_message_ids,
          old.reason_codes, old.detail, old.chain, old.seq, old.prev_hash, old.hash)
     and (new.run_id is null or new.run_id is not distinct from old.run_id)
     and (new.lead_id is null or new.lead_id is not distinct from old.lead_id)
     and (new.deal_id is null or new.deal_id is not distinct from old.deal_id)
     and (new.approver_id is null or new.approver_id is not distinct from old.approver_id) then
    return new;
  end if;
  raise exception 'agent_events is insert-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger agent_events_append_only before update or delete on public.agent_events
  for each row execute function public.agent_events_append_only();
create trigger agent_events_no_truncate before truncate on public.agent_events
  for each statement execute function public.agent_events_append_only();

-- Chain linkage: a chained row must extend the current head of its chain.
create or replace function public.agent_events_chain_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  head record;
begin
  new.recorded_at := now();
  if new.chain is null then
    return new;
  end if;
  -- Serialise appends to one chain so two writers cannot both extend the same head.
  perform pg_advisory_xact_lock(hashtextextended('agent_events:' || new.chain, 0));
  select seq, hash into head from public.agent_events where chain = new.chain order by seq desc limit 1;
  if head is null then
    if new.seq <> 1 or new.prev_hash is not null then
      raise exception 'agent_events chain % starts at seq 1 with no previous hash', new.chain using errcode = 'check_violation';
    end if;
  elsif new.seq <> head.seq + 1 or new.prev_hash is distinct from head.hash then
    raise exception 'agent_events chain % head is seq % (got seq % / prev %)', new.chain, head.seq, new.seq, new.prev_hash
      using errcode = 'serialization_failure';
  end if;
  return new;
end;
$$;
create trigger agent_events_chain_guard before insert on public.agent_events
  for each row execute function public.agent_events_chain_guard();

-- Per-task autonomy history -------------------------------------------------------------------
create table public.agent_task_autonomy (
  id bigint generated always as identity primary key,
  set_at timestamptz not null default now(),
  task text not null check (task ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  level text not null check (level in ('audit', 'assist', 'automate')),
  set_by uuid references public.profiles (id) on delete set null,
  set_by_label text not null check (length(set_by_label) between 1 and 200),
  set_by_dre text not null check (set_by_dre ~ '^\d{8}$'),
  reason text not null check (length(reason) between 1 and 1000)
);
create index agent_task_autonomy_task_idx on public.agent_task_autonomy (task, id desc);

create or replace function public.agent_task_autonomy_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.set_by is null
     and (new.id, new.set_at, new.task, new.level, new.set_by_label, new.set_by_dre, new.reason)
         is not distinct from (old.id, old.set_at, old.task, old.level, old.set_by_label, old.set_by_dre, old.reason) then
    return new;
  end if;
  raise exception 'agent_task_autonomy is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger agent_task_autonomy_append_only before update or delete on public.agent_task_autonomy
  for each row execute function public.agent_task_autonomy_append_only();

-- Step-up re-authentication for sensitive approvals ---------------------------------------------
create table public.approval_reauthentications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  approval_id uuid not null references public.approvals (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  user_dre text not null check (user_dre ~ '^\d{8}$'),
  method text not null check (method in ('totp', 'webauthn')),
  -- When the second factor was verified (from the identity provider's amr claim).
  verified_at timestamptz not null,
  -- The approval payload hash the broker re-authenticated for.
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  session_ref text check (session_ref is null or length(session_ref) <= 200),
  ip_hash text check (ip_hash is null or length(ip_hash) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  constraint approval_reauthentications_fresh check (verified_at <= created_at + interval '1 minute')
);
create index approval_reauthentications_approval_idx on public.approval_reauthentications (approval_id, created_at desc);

create or replace function public.approval_reauthentications_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'approval_reauthentications is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger approval_reauthentications_append_only before update or delete on public.approval_reauthentications
  for each row execute function public.approval_reauthentications_append_only();

revoke execute on function public.agent_events_append_only(), public.agent_events_chain_guard(),
  public.agent_task_autonomy_append_only(), public.approval_reauthentications_append_only() from public, anon, authenticated;

-- RLS: service role only ---------------------------------------------------------------------------
alter table public.agent_events enable row level security;
alter table public.agent_task_autonomy enable row level security;
alter table public.approval_reauthentications enable row level security;

revoke all on public.agent_events from anon, authenticated;
revoke all on public.agent_task_autonomy from anon, authenticated;
revoke all on public.approval_reauthentications from anon, authenticated;
