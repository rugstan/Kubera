# Environments: staging and production separation

Production and staging share **no** data stores, API keys, webhooks or secrets. A staging mistake must never be able to read, change or message production borrowers, lenders or CRM records.

## Matrix

| Concern | Production | Staging (Vercel Preview + a long-lived `staging` branch deployment) |
| --- | --- | --- |
| Vercel | Production environment | Preview environment (and Development for local use) |
| Supabase | Production project | Separate project, own URL, anon key, service-role key, storage buckets |
| Twenty CRM | Production workspace | Separate workspace (or self-hosted instance) with its own API key and webhook secret |
| Anthropic and other model keys | Production keys with production spend limits | Distinct keys with a low monthly spend cap |
| Resend / Zoho Mail | Real domains (`notify.`, `news.`, mailboxes) | Resend sandbox or a dedicated test subdomain; no real mailbox sync |
| Telnyx | Registered 10DLC campaign | Test number or messaging disabled |
| Zoho Sign | Production org | Sandbox / test mode; never send to real recipients |
| Turnstile | Production widget and secret | Cloudflare test keys (always-pass / always-fail) |
| Upstash Redis | Production database | Separate database |
| Sentry | `environment=production` | `environment=preview`; separate DSN optional but recommended |
| `CRON_SECRET`, `LEAD_TOKEN_SECRET`, webhook secrets | Unique per environment | Unique per environment |
| `NEXT_PUBLIC_DRE_CORPORATE_LICENSE` | Real license number (build fails without it) | Real value or an obviously fake one; never printed in ads |
| `EXPRESS_HOSTS` | `kubera.loans,www.kubera.loans` | Include the staging host only if testing the short-domain flow |

## Rules

1. **Scope variables per environment in Vercel.** Never tick "Production, Preview and Development" for a secret that points at a data store. Create each variable once per environment with that environment's value.
2. **Preview deployments never receive production secrets.** In particular the production `SUPABASE_SERVICE_ROLE_KEY`, `TWENTY_API_KEY`, `ANTHROPIC_API_KEY` and `CRON_SECRET`.
3. **Synthetic data only in staging.** No real borrower documents, principal data, SSNs or bank details. Use clearly fake names and `example.com` addresses.
4. **Staging cannot send real messages.** If a staging path ever reaches a real inbox or phone, treat it as a defect and an incident.
5. **Migrations go to staging first** (see [deploy-and-rollback.md](./deploy-and-rollback.md)). Compare schemas before production: `supabase db diff` against both projects should show no drift.
6. **Twenty webhooks:** each workspace has its own webhook pointing at its own environment's `/api/webhooks/twenty` with its own `TWENTY_WEBHOOK_SECRET`.
7. **Storage buckets:** the `deal-documents` bucket is private in both projects. Do not copy objects between projects.

## Standing up staging (checklist)

- [ ] Create the staging Supabase project; run all migrations (`supabase db push`); confirm the `deal-documents` bucket exists and is private.
- [ ] Create the staging Twenty workspace; replicate custom objects and fields (opportunity stages, `person.smsOptOut`, note targets); create an API key and a webhook secret.
- [ ] Add every variable from `.env.example` to the Vercel **Preview** environment with staging values.
- [ ] Generate fresh secrets: `openssl rand -base64 32` for `CRON_SECRET` and `LEAD_TOKEN_SECRET`.
- [ ] Submit a synthetic qualifier lead on a preview URL; confirm rows in staging Supabase and a staging Twenty opportunity.
- [ ] Break Twenty on purpose (wrong key) to confirm `crm_error` is recorded, then fix it and trigger `/api/cron/crm-retry` with the staging `CRON_SECRET` to confirm the retry clears it.

## Auditing for drift (quarterly)

- Compare the variable names in Vercel Production versus Preview; values must differ for every data store and secret.
- Confirm the staging service-role key does not open the production project (and vice versa).
- Confirm staging email, SMS and e-sign credentials are sandbox credentials.
