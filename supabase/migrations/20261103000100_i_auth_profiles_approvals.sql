-- WS-I · Auth & staff dashboard (Phase 2, slot 01).
--
-- roles               role catalog: admin, broker, analyst (staff) · borrower, partner (portal)
-- profiles            one row per auth.users row; staff DRE license fields
-- user_roles          role grants (admin-managed)
-- deals               base deal record (WS-T extends it with its own migration)
-- deal_members        portal users (borrower / partner) attached to a deal
-- approvals           broker approval gate queue (Global rule 2): request →
--                     approved | rejected | expired | cancelled, idempotency key,
--                     timed-out approvals expire and never send
-- approval_templates  templates a broker pre-approved for automatic sending
-- staff_audit_events  append-only log of staff sign-ins, document views and
--                     approval decisions
--
-- Access model. Server code uses the service role. Requests made with a user's
-- JWT (role `authenticated`) are filtered by the policies below:
--   * staff (admin/broker/analyst with an active profile) must hold an MFA
--     session (JWT claim aal = 'aal2') to read deal-desk data;
--   * portal users (borrower/partner) see only their own profile and the deals
--     (and those deals' documents) they are members of;
--   * approval decisions and audit writes go through the server only.
-- Supabase grants every API role full table privileges by default, so each
-- table below revokes them and grants back only what its policies need.

-- Roles ---------------------------------------------------------------------------
create table public.roles (
  role text primary key check (role in ('admin', 'broker', 'analyst', 'borrower', 'partner')),
  label text not null,
  is_staff boolean not null,
  description text not null
);
insert into public.roles (role, label, is_staff, description) values
  ('admin', 'Administrator', true, 'Manages staff accounts, roles and pre-approved templates.'),
  ('broker', 'Broker', true, 'DRE-licensed advisor; approves outbound actions and owns deals.'),
  ('analyst', 'Analyst', true, 'Prepares deal files; read access to the pipeline and documents.'),
  ('borrower', 'Borrower', false, 'Borrower portal user; sees only their own deals.'),
  ('partner', 'Partner', false, 'Referral or lender partner; sees only deals shared with them.');

-- Profiles --------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text not null check (email = lower(email) and length(email) between 3 and 200),
  full_name text check (full_name is null or length(full_name) between 1 and 200),
  title text check (title is null or length(title) <= 120),
  phone text check (phone is null or length(phone) <= 40),
  active boolean not null default true,
  -- California DRE license (staff). Eight digits, leading zeros significant.
  dre_license_number text check (dre_license_number is null or dre_license_number ~ '^\d{8}$'),
  dre_license_type text check (dre_license_type is null or dre_license_type in ('broker', 'salesperson', 'broker_officer')),
  dre_license_expires_on date,
  dre_license_verified_at timestamptz,
  dre_license_verified_by uuid references public.profiles (id) on delete set null,
  nmls_id text check (nmls_id is null or nmls_id ~ '^\d{1,12}$'),
  last_sign_in_at timestamptz,
  constraint profiles_dre_complete check (
    (dre_license_number is null and dre_license_type is null and dre_license_expires_on is null)
    or (dre_license_number is not null and dre_license_type is not null and dre_license_expires_on is not null)
  ),
  constraint profiles_dre_verified_has_license check (dre_license_verified_at is null or dre_license_number is not null)
);
create unique index profiles_email_idx on public.profiles (email);
create index profiles_dre_idx on public.profiles (dre_license_number) where dre_license_number is not null;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Changing a license number or expiry clears its verification stamp.
create or replace function public.profiles_reset_dre_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.dre_license_number, new.dre_license_type, new.dre_license_expires_on)
     is distinct from (old.dre_license_number, old.dre_license_type, old.dre_license_expires_on)
     and new.dre_license_verified_at is not distinct from old.dre_license_verified_at then
    new.dre_license_verified_at := null;
    new.dre_license_verified_by := null;
  end if;
  return new;
end;
$$;
create trigger profiles_reset_dre_verification before update on public.profiles
  for each row execute function public.profiles_reset_dre_verification();

-- Every new auth user gets a profile (no roles: an admin grants them).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    insert into public.profiles (id, email)
    values (new.id, lower(new.email))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created_profile after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Role grants -------------------------------------------------------------------------
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null references public.roles (role) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles (id) on delete set null,
  primary key (user_id, role)
);
create index user_roles_role_idx on public.user_roles (role);

-- Access helpers (security definer so policies can read roles without
-- recursing through the role table's own policies).
create or replace function public.current_user_roles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(ur.role order by ur.role), '{}')
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.active
$$;

create or replace function public.has_role(wanted text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select wanted = any (public.current_user_roles())
$$;

-- Staff with a multi-factor session. Supabase puts the assurance level in the JWT.
create or replace function public.is_staff_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and public.current_user_roles() && array['admin', 'broker', 'analyst']::text[]
$$;

create or replace function public.is_admin_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' and public.has_role('admin')
$$;

create or replace function public.can_edit_deals()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and public.current_user_roles() && array['admin', 'broker']::text[]
$$;

revoke execute on function public.current_user_roles() from public, anon;
revoke execute on function public.has_role(text) from public, anon;
revoke execute on function public.is_staff_mfa() from public, anon;
revoke execute on function public.is_admin_mfa() from public, anon;
revoke execute on function public.can_edit_deals() from public, anon;
grant execute on function public.current_user_roles(), public.has_role(text), public.is_staff_mfa(), public.is_admin_mfa(), public.can_edit_deals() to authenticated;

-- Deals (base) ------------------------------------------------------------------------------
-- Corin is the broker on every deal (Global rule 1): never the lender,
-- originator of record or trust-deed beneficiary.
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null check (length(name) between 1 and 200),
  lead_id uuid references public.leads (id) on delete set null,
  twenty_opportunity_id uuid unique,
  program text check (program is null or length(program) <= 80),
  asset_type text check (asset_type is null or length(asset_type) <= 80),
  transaction_type text check (transaction_type is null or length(transaction_type) <= 80),
  stage text not null default 'intake',
  status text not null default 'active',
  loan_amount_usd numeric(14, 2) check (loan_amount_usd is null or loan_amount_usd >= 0),
  property_name text check (property_name is null or length(property_name) <= 200),
  property_city text check (property_city is null or length(property_city) <= 120),
  property_state text check (property_state is null or property_state ~ '^[A-Z]{2}$'),
  borrower_entity text check (borrower_entity is null or length(borrower_entity) <= 200),
  owner_id uuid references public.profiles (id) on delete set null,
  analyst_id uuid references public.profiles (id) on delete set null,
  corin_role text not null default 'broker',
  urgency_tier text check (urgency_tier is null or length(urgency_tier) <= 40),
  next_step text check (next_step is null or length(next_step) <= 500),
  last_activity_at timestamptz,
  -- Named constraints so WS-T can replace the stage list with its templates.
  constraint deals_stage_check check (stage in (
    'intake', 'qualifying', 'application', 'packaging', 'lender_outreach',
    'term_sheet', 'underwriting', 'commitment', 'closing', 'closed', 'lost'
  )),
  constraint deals_status_check check (status in ('active', 'on_hold', 'held_for_counsel', 'won', 'lost', 'withdrawn')),
  constraint deals_corin_is_broker check (corin_role = 'broker')
);
create index deals_stage_idx on public.deals (stage) where status = 'active';
create index deals_owner_idx on public.deals (owner_id);
create index deals_lead_idx on public.deals (lead_id) where lead_id is not null;
create index deals_updated_idx on public.deals (updated_at desc);
create trigger deals_touch before update on public.deals
  for each row execute function public.touch_updated_at();

-- The disclosure tables (WS-W) were created before deals existed; link them now.
-- NOT VALID first so a stray legacy id cannot block the deploy; validate when clean.
alter table public.disclosures
  add constraint disclosures_deal_fk foreign key (deal_id) references public.deals (id) on delete restrict not valid;
alter table public.broker_of_record
  add constraint broker_of_record_deal_fk foreign key (deal_id) references public.deals (id) on delete restrict not valid;
do $$
begin
  alter table public.disclosures validate constraint disclosures_deal_fk;
  alter table public.broker_of_record validate constraint broker_of_record_deal_fk;
exception
  when foreign_key_violation then
    raise notice 'deal foreign keys left NOT VALID (legacy rows reference unknown deals): %', sqlerrm;
end;
$$;

-- Portal membership ----------------------------------------------------------------------------
create table public.deal_members (
  deal_id uuid not null references public.deals (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null check (member_role in ('borrower', 'partner')),
  created_at timestamptz not null default now(),
  invited_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  primary key (deal_id, user_id)
);
create index deal_members_user_idx on public.deal_members (user_id) where revoked_at is null;

create or replace function public.is_deal_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.deal_members m
    join public.profiles p on p.id = m.user_id
    where m.deal_id = target and m.user_id = auth.uid() and m.revoked_at is null and p.active
  )
$$;
revoke execute on function public.is_deal_member(uuid) from public, anon;
grant execute on function public.is_deal_member(uuid) to authenticated;

-- Approvals (Global rule 2) ------------------------------------------------------------------------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,47}$'),
  -- Same logical action → same key → at most one approval and one send.
  idempotency_key text not null check (length(idempotency_key) between 8 and 300),
  summary text not null check (length(summary) between 1 and 500),
  template_id text check (template_id is null or length(template_id) between 1 and 120),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by text not null check (length(requested_by) between 1 and 200),
  requested_by_user uuid references public.profiles (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_label text check (decided_by_label is null or length(decided_by_label) <= 200),
  decided_by_dre text check (decided_by_dre is null or decided_by_dre ~ '^\d{8}$'),
  decision_reason text check (decision_reason is null or length(decision_reason) <= 1000),
  auto_approved boolean not null default false,
  -- Set exactly once by the executor that performed the send.
  executed_at timestamptz,
  execution_ref text check (execution_ref is null or length(execution_ref) <= 300),
  constraint approvals_idempotency_unique unique (idempotency_key),
  constraint approvals_expiry_after_create check (expires_at > created_at),
  constraint approvals_decided_shape check (
    (status = 'pending' and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  ),
  constraint approvals_approved_by check (
    status <> 'approved'
    or (auto_approved and template_id is not null)
    or (not auto_approved and decided_by is not null and decided_by_dre is not null)
  ),
  constraint approvals_rejected_reason check (status <> 'rejected' or decision_reason is not null),
  constraint approvals_executed_only_approved check (executed_at is null or status = 'approved')
);
create index approvals_pending_idx on public.approvals (expires_at) where status = 'pending';
create index approvals_deal_idx on public.approvals (deal_id) where deal_id is not null;
create index approvals_created_idx on public.approvals (created_at desc);

-- Lifecycle guard: requested fields are immutable, decisions are final, an
-- approval cannot be granted after it expired, and execution is recorded once.
create or replace function public.approvals_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.created_at, new.kind, new.idempotency_key, new.summary, new.template_id, new.payload,
      new.payload_sha256, new.requested_by, new.expires_at)
     is distinct from
     (old.id, old.created_at, old.kind, old.idempotency_key, old.summary, old.template_id, old.payload,
      old.payload_sha256, old.requested_by, old.expires_at) then
    raise exception 'approval % request fields are immutable', old.id using errcode = 'check_violation';
  end if;

  if old.status <> 'pending' then
    if new.status is distinct from old.status
       or (new.decided_at, new.decided_by, new.decided_by_label, new.decided_by_dre, new.decision_reason, new.auto_approved)
          is distinct from (old.decided_at, old.decided_by, old.decided_by_label, old.decided_by_dre, old.decision_reason, old.auto_approved) then
      raise exception 'approval % is already %', old.id, old.status using errcode = 'check_violation';
    end if;
    -- Executed once; the executor may attach its external reference afterwards, once.
    if old.executed_at is not null and (new.executed_at is distinct from old.executed_at
        or (old.execution_ref is not null and new.execution_ref is distinct from old.execution_ref)) then
      raise exception 'approval % was already executed', old.id using errcode = 'check_violation';
    end if;
    if old.executed_at is null and new.execution_ref is not null and new.executed_at is null then
      raise exception 'approval % has no execution to reference', old.id using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.executed_at is not null and new.status <> 'approved' then
    raise exception 'approval % cannot execute while %', old.id, new.status using errcode = 'check_violation';
  end if;
  if new.status = 'approved' and now() >= old.expires_at then
    raise exception 'approval % expired at %', old.id, old.expires_at using errcode = 'check_violation';
  end if;
  if new.status = 'expired' and now() < old.expires_at then
    raise exception 'approval % has not reached its expiry', old.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
-- Expiry sweep on the database clock (the guard compares against now()).
create or replace function public.expire_due_approvals()
returns setof public.approvals
language sql
volatile
security definer
set search_path = ''
as $$
  update public.approvals
     set status = 'expired', decided_at = now(), decided_by_label = 'system:expiry'
   where status = 'pending' and expires_at <= now()
  returning *
$$;

create trigger approvals_guard before update on public.approvals
  for each row execute function public.approvals_guard();
create trigger approvals_touch before update on public.approvals
  for each row execute function public.touch_updated_at();

-- Decided approvals are evidence for the broker-of-record file; keep them.
create or replace function public.approvals_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'approval % is % and cannot be deleted', old.id, old.status using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;
create trigger approvals_no_delete before delete on public.approvals
  for each row execute function public.approvals_no_delete();

-- Pre-approved templates ------------------------------------------------------------------------------
create table public.approval_templates (
  template_id text primary key check (template_id ~ '^[a-z0-9][a-z0-9_.-]{1,119}$'),
  created_at timestamptz not null default now(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,47}$'),
  description text not null check (length(description) between 1 and 500),
  -- Hash of the exact template body the broker reviewed; a changed body needs a new approval.
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by uuid not null references public.profiles (id) on delete restrict,
  approved_by_dre text not null check (approved_by_dre ~ '^\d{8}$'),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null
);

-- Staff audit trail -------------------------------------------------------------------------------------
create table public.staff_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_label text not null check (length(actor_label) between 1 and 200),
  action text not null check (action ~ '^[a-z]+(\.[a-z_]+)+$'),
  target_type text check (target_type is null or length(target_type) <= 60),
  target_id text check (target_id is null or length(target_id) <= 200),
  ip_hash text check (ip_hash is null or length(ip_hash) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index staff_audit_events_target_idx on public.staff_audit_events (target_type, target_id, occurred_at desc);
create index staff_audit_events_actor_idx on public.staff_audit_events (actor_id, occurred_at desc);

create or replace function public.staff_audit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Profile deletion nulls actor_id through the foreign key; nothing else may change.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and (new.id, new.occurred_at, new.actor_label, new.action, new.target_type, new.target_id, new.ip_hash, new.user_agent, new.detail)
         is not distinct from (old.id, old.occurred_at, old.actor_label, old.action, old.target_type, old.target_id, old.ip_hash, old.user_agent, old.detail)
     and new.actor_id is null then
    return new;
  end if;
  raise exception 'staff_audit_events is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger staff_audit_events_append_only before update or delete on public.staff_audit_events
  for each row execute function public.staff_audit_events_append_only();

revoke execute on function public.expire_due_approvals() from public, anon, authenticated;
grant execute on function public.expire_due_approvals() to service_role;
revoke execute on function public.approvals_guard(), public.approvals_no_delete(), public.staff_audit_events_append_only(),
  public.profiles_reset_dre_verification() from public, anon, authenticated;

-- Row Level Security ------------------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.deals enable row level security;
alter table public.deal_members enable row level security;
alter table public.approvals enable row level security;
alter table public.approval_templates enable row level security;
alter table public.staff_audit_events enable row level security;

revoke all on public.roles, public.profiles, public.user_roles, public.deals, public.deal_members,
  public.approvals, public.approval_templates, public.staff_audit_events from anon, authenticated;

-- roles: the catalog is readable by any signed-in user.
grant select on public.roles to authenticated;
create policy roles_read on public.roles for select to authenticated using (true);

-- profiles: own row; staff (MFA) read all; admins (MFA) update. Users may edit
-- only their own name, title and phone (license fields are admin-verified).
grant select on public.profiles to authenticated;
grant update (full_name, title, phone, active, dre_license_number, dre_license_type, dre_license_expires_on,
  dre_license_verified_at, dre_license_verified_by, nmls_id) on public.profiles to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_read_staff on public.profiles for select to authenticated using (public.is_staff_mfa());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin_mfa()) with check (public.is_admin_mfa());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- A non-admin editing their own row may only touch the self-service columns.
create or replace function public.profiles_self_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and not public.is_admin_mfa()
     and (new.active, new.dre_license_number, new.dre_license_type, new.dre_license_expires_on,
          new.dre_license_verified_at, new.dre_license_verified_by, new.nmls_id, new.email, new.last_sign_in_at)
         is distinct from
         (old.active, old.dre_license_number, old.dre_license_type, old.dre_license_expires_on,
          old.dre_license_verified_at, old.dre_license_verified_by, old.nmls_id, old.email, old.last_sign_in_at) then
    raise exception 'only an administrator can change account status or license fields' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_self_update_guard() from public, anon, authenticated;
create trigger profiles_self_update_guard before update on public.profiles
  for each row execute function public.profiles_self_update_guard();

-- user_roles: own grants; admins (MFA) manage.
grant select, insert, delete on public.user_roles to authenticated;
create policy user_roles_read_own on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy user_roles_read_admin on public.user_roles for select to authenticated using (public.is_admin_mfa());
create policy user_roles_insert_admin on public.user_roles for insert to authenticated with check (public.is_admin_mfa());
create policy user_roles_delete_admin on public.user_roles for delete to authenticated using (public.is_admin_mfa());

-- deals: staff (MFA) read; brokers/admins (MFA) write; portal members read their own.
grant select, insert, update on public.deals to authenticated;
create policy deals_read_staff on public.deals for select to authenticated using (public.is_staff_mfa());
create policy deals_read_member on public.deals for select to authenticated using (public.is_deal_member(id));
create policy deals_insert_broker on public.deals for insert to authenticated with check (public.can_edit_deals());
create policy deals_update_broker on public.deals for update to authenticated
  using (public.can_edit_deals()) with check (public.can_edit_deals());

-- deal_members: staff (MFA) read; brokers/admins (MFA) manage; members see their own rows.
grant select, insert, update on public.deal_members to authenticated;
create policy deal_members_read_staff on public.deal_members for select to authenticated using (public.is_staff_mfa());
create policy deal_members_read_own on public.deal_members for select to authenticated using (user_id = auth.uid());
create policy deal_members_insert_broker on public.deal_members for insert to authenticated with check (public.can_edit_deals());
create policy deal_members_update_broker on public.deal_members for update to authenticated
  using (public.can_edit_deals()) with check (public.can_edit_deals());

-- approvals / templates: staff (MFA) read; decisions go through the server.
grant select on public.approvals, public.approval_templates to authenticated;
create policy approvals_read_staff on public.approvals for select to authenticated using (public.is_staff_mfa());
create policy approval_templates_read_staff on public.approval_templates for select to authenticated using (public.is_staff_mfa());

-- staff_audit_events: admins (MFA) read; written by the server only.
grant select on public.staff_audit_events to authenticated;
create policy staff_audit_events_read_admin on public.staff_audit_events for select to authenticated using (public.is_admin_mfa());

-- documents (vault): staff (MFA) read metadata; portal members read their deal's
-- documents. Files themselves are served only through short-lived signed URLs
-- minted by the server after the same check.
revoke all on public.documents from anon;
revoke insert, update, delete, truncate, references, trigger on public.documents from authenticated;
grant select on public.documents to authenticated;
create policy documents_read_staff on public.documents for select to authenticated using (public.is_staff_mfa());
create policy documents_read_member on public.documents for select to authenticated using (
  exists (select 1 from public.deals d where d.lead_id = documents.lead_id and public.is_deal_member(d.id))
);
