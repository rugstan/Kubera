-- Phase 2 integration fixes (slot 51, after the deal-link reconciliation in slot 50).
--
-- 1. Borrower-portal uploads go through the WS-K vault: each checklist file is
--    backed by a `documents` row (quarantine bucket, malware scan), so
--    checklist_item_files gains document_id, a `scanning` status (finalized,
--    waiting on the scan; the item is not received yet) and vault object paths.
-- 2. Deals opened by another process (a construction take-out) record the
--    idempotency key they were opened under (deals.origin_key, unique).
-- 3. Terminal stages settle deals.status (closed → won, lost, withdrawn), so the
--    pipeline stops counting them as active.
-- 4. Open sanctions holds pause the deal: a possible match → on_hold, a confirmed
--    match or counsel review → held_for_counsel; releasing the last hold → active.

-- 1 · checklist files backed by vault documents -------------------------------------------
alter table public.checklist_item_files
  add column if not exists document_id uuid unique references public.documents (id) on delete set null;

alter table public.checklist_item_files drop constraint if exists checklist_item_files_status_check;
alter table public.checklist_item_files add constraint checklist_item_files_status_check
  check (status in ('pending_upload', 'scanning', 'uploaded', 'rejected'));

-- Legacy rows keep their deals/<deal>/checklist/... path; vault documents use <lead>/<kind>/<uuid>-<name>.
alter table public.checklist_item_files drop constraint if exists checklist_item_files_storage_path_check;
alter table public.checklist_item_files add constraint checklist_item_files_storage_path_check check (
  storage_path ~ '^deals/[0-9a-f-]{36}/checklist/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9_.-]+$'
  or storage_path ~ '^[0-9a-f-]{36}/[A-Z0-9_]{2,40}/[0-9a-f-]{36}-[^/]{1,120}$'
);

-- 2 · deal origin key -----------------------------------------------------------------------
alter table public.deals add column if not exists origin_key text unique
  check (origin_key is null or length(origin_key) between 8 and 200);

-- 3 · status follows terminal stages --------------------------------------------------------------
create or replace function public.deals_status_from_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    if new.stage = 'closed' then
      new.status := 'won';
    elsif new.stage = 'lost' then
      new.status := 'lost';
    elsif new.stage = 'withdrawn' then
      new.status := 'withdrawn';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists deals_b_status_from_stage on public.deals;
create trigger deals_b_status_from_stage before insert or update of stage on public.deals
  for each row execute function public.deals_status_from_stage();

update public.deals set status = 'won' where stage = 'closed' and status = 'active';
update public.deals set status = 'lost' where stage = 'lost' and status = 'active';
update public.deals set status = 'withdrawn' where stage = 'withdrawn' and status = 'active';

-- 4 · open holds pause the deal -------------------------------------------------------------------
create or replace function public.deal_holds_sync_deal_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target uuid := coalesce(new.deal_id, old.deal_id);
  counsel boolean;
  open_holds bigint;
  next_status text;
begin
  select coalesce(bool_or(h.reason <> 'sanctions_potential_match'), false), count(*)
    into counsel, open_holds
    from public.deal_holds h
   where h.deal_id = target and h.released_at is null;
  next_status := case when counsel then 'held_for_counsel' when open_holds > 0 then 'on_hold' else 'active' end;
  -- Won, lost and withdrawn deals keep their status; the record version moves so stale desk forms are refused.
  update public.deals d
     set status = next_status, record_version = d.record_version + 1
   where d.id = target
     and d.status in ('active', 'on_hold', 'held_for_counsel')
     and d.status is distinct from next_status;
  return null;
end;
$$;

drop trigger if exists deal_holds_sync_deal_status on public.deal_holds;
create trigger deal_holds_sync_deal_status after insert or update of released_at on public.deal_holds
  for each row execute function public.deal_holds_sync_deal_status();

revoke execute on function public.deals_status_from_stage(), public.deal_holds_sync_deal_status() from public, anon, authenticated;
