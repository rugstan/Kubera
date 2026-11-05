-- Integrator: which model each AI task runs on (lib/ai/model-settings.ts, staff page /settings/ai).
--
-- ai_task_models   append-only history of administrator choices. The latest row
--                  per task wins; model null means "back to the default" (the
--                  code constant, or DOCUMENT_TEXT_MODEL / XAI_MODEL where set).
--                  previous_model is what the task ran on when the row was
--                  written, so the history reads "from -> to" without replaying
--                  defaults that may have changed since.
--
-- The app re-checks a stored model against the approved model list and the
-- routing guard every time it reads it, so a row can never widen what a task
-- may send where; an unusable row is ignored and the task uses its default.
--
-- Mirrors agent_task_autonomy (20261104000600_ab_agent_safety.sql): history
-- rows with who and why, no update or delete (a deleted profile may only null
-- set_by), RLS on with no policies so only the service role reads or writes.
-- Nothing here models funds.

create table public.ai_task_models (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  task text not null check (task ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  model text check (model is null or (length(model) between 1 and 100 and model !~ '\s')),
  previous_model text not null check (length(previous_model) between 1 and 100 and previous_model !~ '\s'),
  set_by uuid references public.profiles (id) on delete set null,
  set_by_label text not null check (length(set_by_label) between 1 and 200),
  reason text not null check (length(reason) between 1 and 1000 and length(btrim(reason)) > 0)
);
create index ai_task_models_task_idx on public.ai_task_models (task, id desc);

create or replace function public.ai_task_models_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Deleting a profile nulls set_by (on delete set null); nothing else may change.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.set_by is null
     and (new.id, new.created_at, new.task, new.model, new.previous_model, new.set_by_label, new.reason)
         is not distinct from (old.id, old.created_at, old.task, old.model, old.previous_model, old.set_by_label, old.reason) then
    return new;
  end if;
  raise exception 'ai_task_models is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger ai_task_models_append_only before update or delete on public.ai_task_models
  for each row execute function public.ai_task_models_append_only();
create trigger ai_task_models_no_truncate before truncate on public.ai_task_models
  for each statement execute function public.ai_task_models_append_only();

revoke execute on function public.ai_task_models_append_only() from public, anon, authenticated;

-- RLS: service role only -----------------------------------------------------------------------
alter table public.ai_task_models enable row level security;
revoke all on public.ai_task_models from anon, authenticated;
