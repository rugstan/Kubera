-- WS-K · Document vault (Phase 2, slot 05).
--
-- Uploads land in a private quarantine bucket and stay `quarantined` until the
-- malware scanner (workers/scan) marks them `clean`; only then are they moved to
-- the `deal-documents` bucket and offered for download. This migration adds:
--
--   documents.*                  lifecycle columns (status, bucket, size, hash, scan result, lease)
--   document_events              append-only audit trail: mint, finalize, scan, download, delete
--   claim_documents_for_scan()   leases a batch of quarantined rows to one scan worker
--   purge_document_events()      the only way to delete audit rows (3-year floor)
--
-- RLS is enabled with no policies: only the service role reads or writes.

-- Quarantine bucket: private, same size and type limits as the vault bucket ------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-documents-quarantine', 'deal-documents-quarantine', false, 52428800,
  array['application/pdf', 'text/csv', 'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg']
)
on conflict (id) do nothing;

-- Document lifecycle ----------------------------------------------------------------------
-- Rows that existed before this migration were never scanned: the default
-- 'quarantined' keeps them undownloadable until the worker has scanned them where
-- they are (bucket = 'deal-documents').
alter table public.documents
  add column status text not null default 'quarantined'
    check (status in ('pending_upload', 'quarantined', 'clean', 'infected', 'rejected', 'scan_failed')),
  add column bucket text not null default 'deal-documents'
    check (bucket in ('deal-documents', 'deal-documents-quarantine')),
  add column declared_size_bytes bigint check (declared_size_bytes is null or declared_size_bytes > 0),
  add column size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  add column sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add column detected_mime text check (detected_mime is null or length(detected_mime) <= 100),
  add column upload_expires_at timestamptz,
  add column finalized_at timestamptz,
  add column reject_reason text check (reject_reason is null or length(reject_reason) <= 500),
  add column scanned_at timestamptz,
  add column scan_engine text check (scan_engine is null or length(scan_engine) <= 100),
  add column scan_signature text check (scan_signature is null or length(scan_signature) <= 200),
  add column scan_attempts integer not null default 0 check (scan_attempts >= 0),
  add column scan_error text check (scan_error is null or length(scan_error) <= 500),
  add column scan_lease_until timestamptz,
  add constraint documents_clean_requires_scan
    check (status <> 'clean' or (scanned_at is not null and bucket = 'deal-documents')),
  add constraint documents_infected_has_signature
    check (status <> 'infected' or scan_signature is not null),
  add constraint documents_pending_in_quarantine
    check (status <> 'pending_upload' or bucket = 'deal-documents-quarantine');

create index documents_scan_queue_idx on public.documents (created_at) where status = 'quarantined';
create index documents_pending_idx on public.documents (created_at) where status = 'pending_upload';
create index documents_status_idx on public.documents (lead_id, status);

-- Scan queue: lease a batch so concurrent workers never scan the same file ---------------
create or replace function public.claim_documents_for_scan(batch_size integer, lease_seconds integer)
returns setof public.documents
language plpgsql
set search_path = ''
as $$
begin
  return query
  with picked as (
    select d.id
    from public.documents d
    where d.status = 'quarantined'
      and (d.scan_lease_until is null or d.scan_lease_until < now())
    order by d.created_at
    limit greatest(batch_size, 0)
    for update skip locked
  )
  update public.documents d
     set scan_lease_until = now() + make_interval(secs => greatest(lease_seconds, 1)),
         scan_attempts = d.scan_attempts + 1
    from picked
   where d.id = picked.id
  returning d.*;
end;
$$;
revoke execute on function public.claim_documents_for_scan(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_documents_for_scan(integer, integer) to service_role;

-- Audit trail ------------------------------------------------------------------------------
-- document_id / lead_id are plain columns (no foreign keys): the trail must outlive
-- the document it describes, including a deletion request. It holds ids, an actor
-- label and a salted IP hash only, never file names or contents.
create table public.document_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  document_id uuid,
  lead_id uuid,
  event text not null check (event in (
    'upload_minted', 'upload_finalized', 'upload_rejected', 'upload_expired',
    'scan_clean', 'scan_infected', 'scan_error', 'scan_failed',
    'download', 'download_denied', 'deleted'
  )),
  actor text not null check (length(actor) between 1 and 200),
  ip_hash text check (ip_hash is null or length(ip_hash) <= 64),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index document_events_document_idx on public.document_events (document_id, occurred_at);
create index document_events_lead_idx on public.document_events (lead_id, occurred_at) where lead_id is not null;
create index document_events_event_idx on public.document_events (event, occurred_at);

create or replace function public.refuse_document_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('kubera.purge_document_events', true), '') = 'on' then
    return old;
  end if;
  raise exception 'document_events is append-only (% refused)', tg_op using errcode = 'check_violation';
end;
$$;
revoke execute on function public.refuse_document_event_change() from public, anon, authenticated;

create trigger document_events_append_only
  before update or delete on public.document_events
  for each row execute function public.refuse_document_event_change();
create trigger document_events_no_truncate
  before truncate on public.document_events
  for each statement execute function public.refuse_document_event_change();

-- The one sanctioned deletion path: events older than three years (same horizon as the
-- MLDS and broker-of-record files, B&P §10148; VERIFY with counsel). A younger cutoff is refused.
create or replace function public.purge_document_events(cutoff timestamptz)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  removed bigint;
begin
  if cutoff > now() - interval '3 years' then
    raise exception 'document_events are kept for 3 years; cutoff % is too recent', cutoff using errcode = 'check_violation';
  end if;
  perform set_config('kubera.purge_document_events', 'on', true);
  delete from public.document_events where occurred_at < cutoff;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke execute on function public.purge_document_events(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_document_events(timestamptz) to service_role;

alter table public.document_events enable row level security;
