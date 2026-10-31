-- WS-P · Growth (Phase 4, slot 01).
--
-- newsletter_subscribers  one row per email address on the Resend Broadcasts newsletter.
--                         Double opt-in: a signup creates a 'pending' row and emails a
--                         confirmation link; only a click on that link makes it 'confirmed'
--                         and adds the address to the Resend audience. Every step is also
--                         written to the append-only consent ledger (consent_events,
--                         form = 'newsletter'): 'granted' at signup, 'confirmed' on the click,
--                         'revoked' on unsubscribe. This table holds delivery state only; the
--                         ledger is the evidence of consent.
--
-- RLS is enabled with no policies: only the service role reads or writes.

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 200 and email = lower(email)),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  -- Same-site path of the form the person used, e.g. /insights.
  source_page text check (source_page is null or length(source_page) <= 512),
  -- Version id of the consent wording shown at signup (lib/newsletter/consent.ts).
  consent_text_version text not null check (length(consent_text_version) between 1 and 80),
  signup_consent_event_id uuid references public.consent_events (id) on delete set null,
  confirmed_consent_event_id uuid references public.consent_events (id) on delete set null,
  -- Confirmation email bookkeeping: throttles resends so the form cannot be used to mail-bomb an address.
  confirmation_sent_at timestamptz,
  confirmation_count integer not null default 0 check (confirmation_count >= 0),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  -- Resend audience sync. audience_error is set when the last sync failed and is retried on the next change.
  resend_contact_id text check (resend_contact_id is null or length(resend_contact_id) <= 200),
  audience_synced_at timestamptz,
  audience_error text check (audience_error is null or length(audience_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint newsletter_confirmed_has_timestamp check (status <> 'confirmed' or confirmed_at is not null),
  constraint newsletter_unsubscribed_has_timestamp check (status <> 'unsubscribed' or unsubscribed_at is not null)
);

create unique index newsletter_subscribers_email_key on public.newsletter_subscribers (email);
create index newsletter_subscribers_status_idx on public.newsletter_subscribers (status, created_at desc);
create index newsletter_subscribers_audience_retry_idx on public.newsletter_subscribers (updated_at)
  where audience_error is not null;

create or replace function public.newsletter_subscribers_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.newsletter_subscribers_touch() from public, anon, authenticated;

create trigger newsletter_subscribers_touch
  before update on public.newsletter_subscribers
  for each row execute function public.newsletter_subscribers_touch();

alter table public.newsletter_subscribers enable row level security;
revoke all on public.newsletter_subscribers from anon, authenticated;
