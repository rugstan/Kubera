-- Final fixes r1 (data integrations): inbound mail that fails is retried.
--
-- A message whose processing fails is stored as a mail_messages row with
-- status 'failed' and the error; the poller re-enqueues failed rows with an
-- attempt-scoped event id and idempotency key (Inngest drops duplicate ids
-- for 24 h) until `attempts` reaches the cap, and a later successful attempt
-- overwrites the row. `attempts` counts failed processing attempts.

alter table public.mail_messages
  add column attempts integer not null default 0 check (attempts between 0 and 100);

-- Failed rows carry an error.
alter table public.mail_messages
  add constraint mail_messages_failed_has_error check (status <> 'failed' or error is not null);

create index mail_messages_failed_idx on public.mail_messages (mailbox, processed_at) where status = 'failed';
