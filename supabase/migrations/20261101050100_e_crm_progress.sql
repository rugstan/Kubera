-- WS-E (Platform): resumable Twenty pushes.
-- A push is a chain of creates (company, person, opportunity, note, note
-- target). `crm_progress` stores the ids created so far, so when a later step
-- fails the retry cron resumes from the checkpoint instead of creating a second
-- company and opportunity for the same submission. The twenty_* columns are
-- still written only after a full push succeeds.

alter table public.leads
  add column crm_progress jsonb not null default '{}'::jsonb;

alter table public.partners
  add column crm_progress jsonb not null default '{}'::jsonb;
