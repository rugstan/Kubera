# Deploy and rollback

Production is a Vercel project built from the `main` branch. Every pull request gets a preview deployment pointed at the **staging** backends (see [environments.md](./environments.md)).

## Release gates (all automatic in CI)

`.github/workflows/ci.yml` must be green before merge:

1. `npm run typecheck`, `npm run lint`, `npm test`
2. `npm run test:migrations` (every file in `supabase/migrations/` applies to PGlite and every public table has RLS)
3. `npm run build` (the production build fails if `NEXT_PUBLIC_DRE_CORPORATE_LICENSE` is empty)
4. Playwright e2e on Chromium against a production build

## Pre-deploy checklist

- [ ] CI green on the merge commit; no skipped or disabled tests.
- [ ] New environment variables exist in Vercel **Production** and **Preview** (different values per environment) and are listed in `.env.example`.
- [ ] If the release has a migration: it is additive and backward compatible with the currently deployed code (see "Database changes" below), and it has been applied to staging first.
- [ ] Legal copy: if `NEXT_PUBLIC_LEGAL_APPROVED` is not `"true"`, the draft-pending-counsel banner is expected on legal pages. Do not set it to `"true"` without written counsel sign-off.
- [ ] Loan advertising still shows the DRE license line (spot check the footer on `/` and `/express`).
- [ ] Someone who can approve a rollback is available for the next hour.
- [ ] Phase 2 integrations, when first enabled: work through [workflows-and-messaging.md](./workflows-and-messaging.md) (Inngest sync, Zoho Mail tokens, Langfuse, Telnyx STOP/HELP, crons, `CSLB_LOOKUP_ENABLED` / `CSLB_LOOKUP_BASE_URL`).

## Deploy

1. Merge the pull request to `main`. Vercel builds and promotes automatically.
2. Watch the deployment in Vercel until it is **Ready**. If the build fails, production keeps serving the previous deployment; nothing to roll back.
3. Run the post-deploy checks below.

## Post-deploy verification (5 minutes)

- [ ] `https://kuberacommercial.com/` loads; the rate ticker and loan sizer render.
- [ ] `https://kuberacommercial.com/express` loads and the qualifier reaches the contact step.
- [ ] `https://kubera.loans/` serves the qualifier and `https://kubera.loans/anything-else` redirects to the main site.
- [ ] A synthetic qualifier submission from staging (never production) creates a lead and a Twenty record.
- [ ] Vercel runtime logs and Sentry show no new error class in the first 15 minutes.
- [ ] Cron jobs registered: Vercel project, **Settings, Cron Jobs** lists the daily floors (`/api/cron/rates`, `/api/cron/crm-retry`, ...), and the Inngest dashboard lists the `cron-*` functions from `lib/workflows/cron-relay.ts`.

## Rollback: Vercel Instant Rollback

Use rollback first and debug second. It re-points the production domains at an earlier, already-built deployment in seconds without a rebuild.

**Rollback triggers** (any one is enough): error rate or latency clearly worse than before the release, borrower-facing form or sizer broken, a legal or licensing line missing from a page, a security issue introduced by the release.

Dashboard:

1. Vercel project, **Deployments**.
2. Find the last known-good **Production** deployment.
3. Open its menu and choose **Instant Rollback**, then confirm.

CLI (same effect):

```bash
vercel rollback                 # roll back to the previous production deployment
vercel rollback <deployment-url-or-id>
```

After a rollback:

- **VERIFY:** Vercel stops auto-assigning new production deployments to your domains after a rollback until you promote a deployment or re-enable auto-assignment. Merging a fix will not go live by itself; promote it explicitly in the dashboard once it is verified.
- Environment variable changes only apply to new deployments. If the bad release was a configuration change, fix the variable and redeploy; rolling back alone will not undo it.
- The rolled-back deployment keeps its own `vercel.json`, so cron schedules revert with it.
- Re-run the post-deploy verification list against the rolled-back deployment.
- Open an incident ticket (see [incident-response.md](./incident-response.md)) if borrower data or availability was affected.

## Database changes

Rollback does not roll the database back. Write migrations so the **previous** release still works against the **new** schema (expand, then contract):

1. **Expand:** add tables, columns (nullable or with defaults) and indexes. Never rename or drop in the same release that stops using them.
2. Ship the code that uses the new shape.
3. **Contract:** drop the unused objects in a later release, after the old code can no longer be rolled back to.

Process:

1. Add a new file `supabase/migrations/<timestamp>_<workstream>_<name>.sql`. Never edit an applied migration.
2. `npm run test:migrations` locally.
3. Apply to the **staging** Supabase project (`supabase db push --db-url "$STAGING_DB_URL"`), smoke test, then apply to production **before** merging code that depends on it.
4. Every new table enables row level security in the same migration.
5. Before a risky migration on production, take a manual backup (Supabase dashboard, **Database, Backups**) and note the time.

If a migration itself is the problem, fix forward with a new migration. Restoring a backup discards data written since; treat it as an incident and involve the incident commander.

## Hotfix path

Branch from `main`, make the smallest possible change, open a pull request, wait for CI, merge. Do not bypass CI. If production is down and CI is the blocker, roll back first.
