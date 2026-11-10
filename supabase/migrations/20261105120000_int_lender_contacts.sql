-- Lender contacts: lender-level contact info on lender_panel, the people Corin
-- deals with at each lender (lender_contacts, at most one primary), and the
-- account numbers a lender assigns Corin (lender_accounts).
--
-- Account numbers are restricted data (Global rule 8): the app seals them with
-- AES-256-GCM (lib/privacy/crypto.ts, context "lender_accounts:<id>.number")
-- before the write, and the column only accepts that envelope, so neither the
-- table nor any copy of it ever holds the plain number. Corin is a broker and
-- never moves money (Global rule 1): portal passwords, wire instructions and
-- bank account / routing numbers are never stored here.
--
-- Contact persons are personal information (CCPA). Their audit rows go through
-- audit_row_change_redacted(), which keeps who changed what (the changed[]
-- column list) but never the values, so a deletion request can be honoured
-- even though audit_log is append-only.
--
-- The legacy lender_panel.contact_name / contact_email columns stay (the
-- historical seed migrations insert into them), but their data moves here:
-- a named person becomes a primary contact, an inbox with no name becomes the
-- lender's submission_email. The app never writes the legacy columns again.

-- 1. Lender-level contact info (business data, fully audited by lender_panel_audit)
alter table public.lender_panel
  add column main_phone text
    check (main_phone is null or main_phone ~ '^\+[1-9][0-9]{7,14}$'),
  add column main_phone_ext text
    check (main_phone_ext is null or main_phone_ext ~ '^[0-9]{1,6}$'),
  add column general_email text
    check (general_email is null or (length(general_email) <= 254
      and general_email ~ '^[^@[:space:][:cntrl:]<>",;]{1,64}@[^@[:space:][:cntrl:]<>",;]+\.[^@[:space:][:cntrl:]<>",;]+$')),
  add column submission_email text
    check (submission_email is null or (length(submission_email) <= 254
      and submission_email ~ '^[^@[:space:][:cntrl:]<>",;]{1,64}@[^@[:space:][:cntrl:]<>",;]+\.[^@[:space:][:cntrl:]<>",;]+$')),
  add column website_url text
    check (website_url is null or (length(website_url) <= 2048
      and website_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:][:cntrl:]<>"]*)?$')),
  add column portal_url text
    check (portal_url is null or (length(portal_url) <= 2048
      and portal_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:][:cntrl:]<>"?#]*)?$')),
  add column address_line1 text
    check (address_line1 is null or (length(address_line1) between 1 and 200 and address_line1 !~ '[[:cntrl:]]')),
  add column address_line2 text
    check (address_line2 is null or (length(address_line2) between 1 and 200 and address_line2 !~ '[[:cntrl:]]')),
  add column city text
    check (city is null or (length(city) between 1 and 100 and city !~ '[[:cntrl:]]')),
  add column address_state text
    check (address_state is null or address_state ~ '^[A-Z]{2}$'),
  add column postal_code text
    check (postal_code is null or postal_code ~ '^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$'),
  add column country text not null default 'US'
    check (country ~ '^[A-Z]{2}$'),
  add column nmls_id text
    check (nmls_id is null or nmls_id ~ '^[0-9]{1,10}$'),
  add column submission_instructions text
    check (submission_instructions is null or length(submission_instructions) between 1 and 4000),
  add column credentials_location text
    check (credentials_location is null or (length(credentials_location) between 1 and 200 and credentials_location !~ '[[:cntrl:]]')),
  add column contact_verified_at timestamptz,
  add column contact_verified_by text
    check (contact_verified_by is null or length(contact_verified_by) between 1 and 200),
  add column contact_info_version integer not null default 1
    check (contact_info_version > 0),
  add constraint lender_panel_us_postal_code
    check (postal_code is null or country <> 'US' or postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  add constraint lender_panel_phone_ext_needs_phone
    check (main_phone_ext is null or main_phone is not null),
  add constraint lender_panel_contact_verified
    check ((contact_verified_at is null) = (contact_verified_by is null));

comment on column public.lender_panel.contact_name is
  'Deprecated by 20261105120000_int_lender_contacts: people live in lender_contacts. Kept so the historical seed migrations apply; the app never writes it.';
comment on column public.lender_panel.contact_email is
  'Deprecated by 20261105120000_int_lender_contacts: use lender_contacts.email or submission_email. Kept so the historical seed migrations apply; the app never writes it.';
comment on column public.lender_panel.credentials_location is
  'Where the portal password is kept (for example the password manager vault and item). Never the password itself.';

-- 2. Contact persons ------------------------------------------------------------------------------
-- on delete cascade: a contact means nothing without its lender, the app never
-- deletes lenders, and the restrict FKs from outreach, share links, credit
-- boxes and quotes already block deleting any lender with history. Cascading
-- keeps a removed lender from leaving personal information behind.
create table public.lender_contacts (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references public.lender_panel (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text not null check (length(created_by) between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or length(updated_by) between 1 and 200),
  record_version integer not null default 1 check (record_version > 0),
  full_name text not null check (length(full_name) between 1 and 120 and full_name = btrim(full_name) and full_name !~ '[[:cntrl:]]'),
  title text check (title is null or (length(title) between 1 and 120 and title !~ '[[:cntrl:]]')),
  role text not null default 'other' check (role in (
    'account_executive', 'regional_manager', 'scenario_desk', 'underwriter', 'processor', 'closer',
    'servicing', 'compliance_legal', 'lender_counsel', 'sba_bdo', 'other'
  )),
  email text check (email is null or (length(email) <= 254
    and email ~ '^[^@[:space:][:cntrl:]<>",;]{1,64}@[^@[:space:][:cntrl:]<>",;]+\.[^@[:space:][:cntrl:]<>",;]+$')),
  phone_direct text check (phone_direct is null or phone_direct ~ '^\+[1-9][0-9]{7,14}$'),
  phone_ext text check (phone_ext is null or phone_ext ~ '^[0-9]{1,6}$'),
  phone_mobile text check (phone_mobile is null or phone_mobile ~ '^\+[1-9][0-9]{7,14}$'),
  preferred_channel text check (preferred_channel is null or preferred_channel in ('email', 'phone', 'mobile')),
  territory text check (territory is null or (length(territory) between 1 and 200 and territory !~ '[[:cntrl:]]')),
  notes text check (notes is null or length(notes) between 1 and 2000),
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active', 'left')),
  left_at timestamptz,
  source text not null default 'staff' check (source in ('staff', 'directory_import', 'business_card', 'email_signature', 'lender_website', 'referral')),
  verified_at timestamptz,
  verified_by text check (verified_by is null or length(verified_by) between 1 and 200),
  constraint lender_contacts_left check (
    (status = 'active' and left_at is null) or (status = 'left' and left_at is not null and not is_primary)
  ),
  constraint lender_contacts_ext_needs_phone check (phone_ext is null or phone_direct is not null),
  constraint lender_contacts_channel_has_value check (
    preferred_channel is null
    or (preferred_channel = 'email' and email is not null)
    or (preferred_channel = 'phone' and phone_direct is not null)
    or (preferred_channel = 'mobile' and phone_mobile is not null)
  ),
  constraint lender_contacts_verified check ((verified_at is null) = (verified_by is null))
);
-- At most one primary per lender (a contact who left is never primary, by the check above).
create unique index lender_contacts_one_primary on public.lender_contacts (lender_id) where is_primary;
create index lender_contacts_lender_idx on public.lender_contacts (lender_id, status);

-- 3. Account numbers the lender assigns Corin ---------------------------------------------------
-- id has no default on purpose: the app generates it before sealing, because
-- the ciphertext is bound to "lender_accounts:<id>.number". An insert without
-- an id fails instead of storing a value that could never be opened.
create table public.lender_accounts (
  id uuid primary key,
  lender_id uuid not null references public.lender_panel (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text not null check (length(created_by) between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or length(updated_by) between 1 and 200),
  record_version integer not null default 1 check (record_version > 0),
  kind text not null check (kind in ('broker_id', 'client_account', 'portal_username', 'other')),
  label text not null check (length(label) between 1 and 80 and label = btrim(label) and label !~ '[[:cntrl:]]'),
  number_enc text not null check (number_enc ~ '^pii1\.\d{1,5}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$'),
  -- Up to the last four letters or digits, fewer for short values (lib/deals/lender-accounts.ts maskHint); not secret.
  number_last4 text check (number_last4 is null or number_last4 ~ '^[A-Za-z0-9]{2,4}$'),
  notes text check (notes is null or length(notes) between 1 and 500),
  unique (lender_id, kind, label)
);

-- 4. Audit without personal values -------------------------------------------------------------------
-- Same as audit_row_change() (actor, changed[] list, append-only audit_log),
-- except that the columns named in the trigger arguments are replaced by
-- "[redacted]" (or stay null) in old_row / new_row. changed[] is computed
-- before redaction, so it still says which of them changed.
create or replace function public.audit_row_change_redacted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  who text;
  diff text[];
  col text;
begin
  who := coalesce(
    nullif(r ->> 'updated_by', ''),
    nullif(r ->> 'created_by', ''),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''),
    nullif(current_setting('app.actor', true), ''),
    current_user::text
  );
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into diff
    from jsonb_object_keys(n) as k
    where (n -> k) is distinct from (o -> k) and k not in ('updated_at');
    if cardinality(diff) = 0 then
      return new;
    end if;
  end if;
  foreach col in array tg_argv loop
    if o is not null and o ? col and jsonb_typeof(o -> col) <> 'null' then
      o := jsonb_set(o, array[col], to_jsonb('[redacted]'::text));
    end if;
    if n is not null and n ? col and jsonb_typeof(n -> col) <> 'null' then
      n := jsonb_set(n, array[col], to_jsonb('[redacted]'::text));
    end if;
  end loop;
  insert into public.audit_log (table_name, row_id, deal_id, action, actor, changed, old_row, new_row)
  values (tg_table_name, r ->> 'id', null, tg_op, who, coalesce(diff, '{}'), o, n);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.audit_row_change_redacted() from public, anon, authenticated;

create trigger lender_contacts_audit after insert or update or delete on public.lender_contacts
  for each row execute function public.audit_row_change_redacted('full_name', 'title', 'email', 'phone_direct', 'phone_ext', 'phone_mobile', 'territory', 'notes');
create trigger lender_accounts_audit after insert or update or delete on public.lender_accounts
  for each row execute function public.audit_row_change_redacted('number_enc', 'notes');

create trigger lender_contacts_touch before update on public.lender_contacts
  for each row execute function public.touch_updated_at();
create trigger lender_accounts_touch before update on public.lender_accounts
  for each row execute function public.touch_updated_at();

-- 5. Primary switch in one transaction ------------------------------------------------------------
-- Locks the lender row (FOR NO KEY UPDATE, so child-row FK checks are not
-- blocked) to serialize primary changes per lender, clears the current primary
-- and sets the new one, so the partial unique index never sees two. Returns
-- no row when the contact is not an active contact of that lender; returns
-- the row unchanged when it already is the primary.
create or replace function public.set_lender_primary_contact(p_lender_id uuid, p_contact_id uuid, p_actor text)
returns setof public.lender_contacts
language plpgsql
set search_path = ''
as $$
declare
  was_primary boolean;
begin
  perform 1 from public.lender_panel where id = p_lender_id for no key update;
  select c.is_primary into was_primary from public.lender_contacts c
   where c.id = p_contact_id and c.lender_id = p_lender_id and c.status = 'active'
   for update;
  if not found then
    return;
  end if;
  if not was_primary then
    update public.lender_contacts
       set is_primary = false, updated_by = p_actor, record_version = record_version + 1
     where lender_id = p_lender_id and is_primary and id <> p_contact_id;
    update public.lender_contacts
       set is_primary = true, updated_by = p_actor, record_version = record_version + 1
     where id = p_contact_id;
  end if;
  return query select * from public.lender_contacts where id = p_contact_id;
end;
$$;
revoke execute on function public.set_lender_primary_contact(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_lender_primary_contact(uuid, uuid, text) to service_role;

-- 6. RLS: service role only, like the rest of the deal desk ---------------------------------------
alter table public.lender_contacts enable row level security;
alter table public.lender_accounts enable row level security;
revoke all on public.lender_contacts, public.lender_accounts from anon, authenticated;

-- 7. Backfill from the legacy columns -------------------------------------------------------------
-- Named people become contacts ("A; B" becomes two); the first one listed is
-- primary and keeps the legacy email when it is a valid address. Directory
-- (seed) rows are marked directory_import and stay unverified.
insert into public.lender_contacts (lender_id, full_name, email, role, is_primary, source, created_by)
select n.lender_id,
       n.full_name,
       case when n.rank = 1 and length(n.email) <= 254
              and n.email ~ '^[^@[:space:][:cntrl:]<>",;]{1,64}@[^@[:space:][:cntrl:]<>",;]+\.[^@[:space:][:cntrl:]<>",;]+$'
            then n.email end,
       'other',
       n.rank = 1,
       case when n.updated_by like 'seed:lender-directory%' then 'directory_import' else 'staff' end,
       'migration:20261105120000_int_lender_contacts'
  from (
    select l.id as lender_id,
           btrim(left(btrim(regexp_replace(part.name, '[[:cntrl:]]', '', 'g')), 120)) as full_name,
           row_number() over (partition by l.id order by part.ord) as rank,
           nullif(btrim(l.contact_email), '') as email,
           l.updated_by
      from public.lender_panel l
     cross join lateral regexp_split_to_table(l.contact_name, ';') with ordinality as part(name, ord)
     where btrim(regexp_replace(part.name, '[[:cntrl:]]', '', 'g')) <> ''
  ) n;

-- An inbox with no name becomes the submission inbox; website and main phone
-- come from the directory notes ("| Website: https://… | Phone: 424.346.6100 |")
-- only when they parse cleanly (annotated numbers stay in the notes for a
-- broker to confirm). One UPDATE per lender, so one audit row. Seeded rows keep
-- their updated_by (lib/agents/lenders/directory-seed.test.ts and later
-- seed rounds recognise them by it); every other row is attributed to this
-- migration.
with parsed as (
  select l.id,
         nullif(regexp_replace(coalesce(l.contact_name, ''), '[;[:space:][:cntrl:]]', '', 'g'), '') as legacy_name,
         nullif(btrim(l.contact_email), '') as legacy_email,
         substring(l.appetite_notes from 'Website: (https://[^[:space:]|]+)') as site,
         btrim(substring(l.appetite_notes from 'Phone: ([^|]*)')) as phone
    from public.lender_panel l
), checked as (
  select p.id, p.legacy_name, p.legacy_email,
         coalesce(length(p.legacy_email) <= 254
           and p.legacy_email ~ '^[^@[:space:][:cntrl:]<>",;]{1,64}@[^@[:space:][:cntrl:]<>",;]+\.[^@[:space:][:cntrl:]<>",;]+$', false) as email_ok,
         case when length(p.site) <= 2048 and p.site ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:][:cntrl:]<>"]*)?$' then p.site end as site,
         case when p.phone ~ '^(\+?1[ .-]?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})[ .-]?[0-9]{3}[ .-][0-9]{4}$'
              then case length(regexp_replace(p.phone, '[^0-9]', '', 'g'))
                     when 10 then '+1' || regexp_replace(p.phone, '[^0-9]', '', 'g')
                     when 11 then '+' || regexp_replace(p.phone, '[^0-9]', '', 'g')
                   end
         end as phone
    from parsed p
)
update public.lender_panel l
   set submission_email = case when c.legacy_name is null and c.email_ok and l.submission_email is null then c.legacy_email else l.submission_email end,
       contact_name = null,
       contact_email = case when c.email_ok or c.legacy_email is null then null else l.contact_email end,
       website_url = coalesce(l.website_url, c.site),
       main_phone = coalesce(l.main_phone, c.phone),
       updated_by = case when l.updated_by like 'seed:lender-directory%' then l.updated_by
                         else 'migration:20261105120000_int_lender_contacts' end
  from checked c
 where c.id = l.id
   and (l.contact_name is not null or l.contact_email is not null
        or (l.website_url is null and c.site is not null)
        or (l.main_phone is null and c.phone is not null));
