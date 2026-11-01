-- Final fixes round 6 (data integrations): one crm_events row per Twenty delivery.
--
-- Twenty retries a webhook until it gets a 2xx, and every retry used to insert
-- another row. The route (app/api/webhooks/twenty/route.ts) now stores
-- sha256("<timestamp>:<raw body>") of the signed delivery here and inserts with
-- on conflict do nothing. Rows written before this migration keep a null key
-- (nulls are distinct, so they never collide).

alter table public.crm_events add column if not exists dedupe_key text;
create unique index if not exists crm_events_dedupe_key_key on public.crm_events (dedupe_key);
