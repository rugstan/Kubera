-- Phase 2 integration · reconcile the deals base table (WS-I, slot 01) with the
-- deal desk (WS-T, slot 02) and link the other Phase 2 / Phase 1 tables to it.
--
-- 1. Stage keys belong to the WS-T stage templates (lib/deals/stages.ts), so
--    the fixed list in deals_stage_check is dropped. Status keeps its check.
-- 2. WS-I named the deal `name` and the amount `loan_amount_usd`; WS-T writes
--    `title` and `loan_amount_cents`. A trigger keeps each pair in step so the
--    pipeline, document viewer and deal desk read the same deal.
-- 3. Foreign keys to deals for the tables that shipped deal_id before deals
--    existed (WS-J notifications, WS-AA construction desk). WS-I already links
--    disclosures and broker_of_record.

-- 1 · stage keys ------------------------------------------------------------------------
alter table public.deals drop constraint if exists deals_stage_check;
alter table public.deals add constraint deals_stage_key check (stage ~ '^[a-z][a-z0-9_]{0,63}$');

-- 2 · name/title and loan amount kept in step ---------------------------------------------
create or replace function public.deals_sync_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.name := coalesce(new.name, new.title);
    new.title := coalesce(new.title, new.name);
    if new.loan_amount_cents is null and new.loan_amount_usd is not null then
      new.loan_amount_cents := round(new.loan_amount_usd * 100)::bigint;
    elsif new.loan_amount_usd is null and new.loan_amount_cents is not null then
      new.loan_amount_usd := new.loan_amount_cents / 100.0;
    end if;
    return new;
  end if;

  if new.title is distinct from old.title and new.name is not distinct from old.name then
    new.name := coalesce(new.title, old.name);
  elsif new.name is distinct from old.name and new.title is not distinct from old.title then
    new.title := new.name;
  end if;
  if new.loan_amount_cents is distinct from old.loan_amount_cents and new.loan_amount_usd is not distinct from old.loan_amount_usd then
    new.loan_amount_usd := new.loan_amount_cents / 100.0;
  elsif new.loan_amount_usd is distinct from old.loan_amount_usd and new.loan_amount_cents is not distinct from old.loan_amount_cents then
    new.loan_amount_cents := round(new.loan_amount_usd * 100)::bigint;
  end if;
  return new;
end;
$$;

-- Named to sort before deals_enforce_term_lock, so the term lock sees both amount columns.
drop trigger if exists deals_a_sync_columns on public.deals;
create trigger deals_a_sync_columns before insert or update on public.deals
  for each row execute function public.deals_sync_columns();

update public.deals set title = name where title is null and name is not null;
update public.deals set loan_amount_cents = round(loan_amount_usd * 100)::bigint
  where loan_amount_cents is null and loan_amount_usd is not null and term_sheet_accepted_at is null;

-- 3 · deal foreign keys -------------------------------------------------------------------
do $$
declare
  link record;
begin
  for link in
    select * from (values
      ('notifications', 'deal_id', 'notifications_deal_fk', 'set null'),
      ('construction_projects', 'deal_id', 'construction_projects_deal_fk', 'restrict'),
      ('construction_takeouts', 'new_deal_id', 'construction_takeouts_new_deal_fk', 'restrict')
    ) as t (tbl, col, conname, on_delete)
  loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = link.tbl and column_name = link.col)
       and not exists (select 1 from pg_constraint where conname = link.conname) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.deals (id) on delete %s',
        link.tbl, link.conname, link.col, link.on_delete
      );
    end if;
  end loop;
end;
$$;
