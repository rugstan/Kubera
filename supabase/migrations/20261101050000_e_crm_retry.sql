-- WS-E (Platform): bookkeeping for the CRM retry cron (/api/cron/crm-retry).
-- Leads and partners whose Twenty push failed carry `crm_error`; the cron
-- re-pushes them with exponential backoff and gives up after a bounded number
-- of attempts so a poisoned row cannot loop forever.

alter table public.leads
  add column crm_attempts integer not null default 0,
  add column crm_last_attempt_at timestamptz;

alter table public.partners
  add column crm_attempts integer not null default 0,
  add column crm_last_attempt_at timestamptz;

-- Rows the cron should look at: failed pushes that never got a CRM id.
create index leads_crm_retry_idx on public.leads (crm_last_attempt_at)
  where crm_error is not null and twenty_person_id is null;
create index partners_crm_retry_idx on public.partners (crm_last_attempt_at)
  where crm_error is not null and twenty_company_id is null;
