-- Inbound mail can come from Mailflare (self-hosted, JMAP) as well as Zoho Mail.
-- lib/mail/mailflare.ts stores provider = 'mailflare'; the provider is chosen
-- from env in lib/mail/provider.ts. Rows already stored keep their value.

alter table public.mail_messages drop constraint if exists mail_messages_provider_check;
alter table public.mail_messages
  add constraint mail_messages_provider_check check (provider in ('zoho', 'mailflare', 'fake'));
