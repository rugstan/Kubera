-- WS-B · Security & AI safety: consent ledger and server-side advisor transcripts.

-- Consent ledger --------------------------------------------------------------
-- Append-only evidence of what a person agreed to, when, and where. Revocations
-- (SMS STOP, unsubscribe) are new rows with event_type = 'revoked'; rows are
-- never edited. text_version points at lib/consent/texts.ts and text_sha256
-- pins the exact wording shown.
create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  occurred_at timestamptz not null default now(),
  event_type text not null default 'granted' check (event_type in ('granted', 'revoked', 'confirmed')),
  form text not null check (form in ('qualifier', 'partner', 'newsletter', 'sms', 'staff')),
  text_version text not null check (length(text_version) between 1 and 80),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  channels text[] not null default '{}'
    check (channels <@ array['phone', 'sms', 'email', 'autodialer']::text[]),
  email text check (email is null or length(email) <= 200),
  phone text check (phone is null or length(phone) <= 40),
  ip text check (ip is null or length(ip) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  page text check (page is null or length(page) <= 512),
  lead_id uuid references public.leads (id) on delete set null,
  partner_id uuid references public.partners (id) on delete set null,
  constraint consent_events_contact_present check (email is not null or phone is not null)
);
create index consent_events_email_idx on public.consent_events (lower(email), occurred_at desc) where email is not null;
create index consent_events_phone_idx on public.consent_events (phone, occurred_at desc) where phone is not null;
create index consent_events_lead_idx on public.consent_events (lead_id) where lead_id is not null;
create index consent_events_partner_idx on public.consent_events (partner_id) where partner_id is not null;

-- Rows are immutable. The only permitted update is the FK cascade that nulls
-- lead_id/partner_id when the parent record is deleted under retention rules.
create or replace function public.consent_events_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.id, new.created_at, new.occurred_at, new.event_type, new.form, new.text_version, new.text_sha256,
      new.channels, new.email, new.phone, new.ip, new.user_agent, new.page)
     is distinct from
     (old.id, old.created_at, old.occurred_at, old.event_type, old.form, old.text_version, old.text_sha256,
      old.channels, old.email, old.phone, old.ip, old.user_agent, old.page)
     or (new.lead_id is not null and new.lead_id is distinct from old.lead_id)
     or (new.partner_id is not null and new.partner_id is distinct from old.partner_id) then
    raise exception 'consent_events is append-only; insert a new event instead';
  end if;
  return new;
end;
$$;

create trigger consent_events_no_update
  before update on public.consent_events
  for each row execute function public.consent_events_immutable();

-- Ask Kubera AI transcripts ---------------------------------------------------------
-- The server is the only writer: browsers send a conversation id and a new
-- message, and the server appends the user turn plus its own reply here.
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  -- Salted hash of the client IP (abuse correlation without storing the address).
  ip_hash text check (ip_hash is null or length(ip_hash) <= 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  page text check (page is null or length(page) <= 512),
  lead_id uuid references public.leads (id) on delete set null,
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  turn_count integer not null default 0 check (turn_count between 0 and 50),
  -- Per-turn lock so concurrent requests cannot interleave a transcript.
  locked_until timestamptz,
  -- Staff review (supervision queue) fields.
  flagged boolean not null default false,
  review_note text
);
create index ai_conversations_created_idx on public.ai_conversations (created_at desc);
create index ai_conversations_flagged_idx on public.ai_conversations (flagged) where flagged;

-- Row Level Security: service role only (no anon/authenticated policies).
alter table public.consent_events enable row level security;
alter table public.ai_conversations enable row level security;

revoke all on public.consent_events from anon, authenticated;
revoke all on public.ai_conversations from anon, authenticated;
revoke execute on function public.consent_events_immutable() from public, anon, authenticated;
