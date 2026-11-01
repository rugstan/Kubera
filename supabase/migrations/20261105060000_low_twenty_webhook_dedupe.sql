-- Replay protection for the Twenty webhook: a SHA-256 of the signed delivery
-- (timestamp + signature). A replayed delivery hits the unique index and is a no-op.
alter table public.crm_events add column dedupe_key text;
create unique index crm_events_dedupe_key_key on public.crm_events (dedupe_key) where dedupe_key is not null;
