# Kubera Commercial

AI-first commercial debt advisory platform for **kuberacommercial.com** and the **kubera.loans** express funnel. It covers senior living and healthcare (HUD 232, SBA 504, Bridge-to-HUD), hospitality (SBA 504 + 7(a) stacks, CMBS, PIP bridge), and multifamily/CRE (HUD 223(f)/221(d)(4), Agency, private bridge and hard money).

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router, React Server Components, Cache Components = stable Partial Prerendering), TypeScript |
| Design | Tailwind CSS 4, Motion (Framer Motion), Inter / SF Pro |
| System One | `lib/ai/jev.ts`: typed, deterministic decision engine (<1 ms), with an optional hosted Jev endpoint under a 180 ms budget |
| System Two | Claude via `@anthropic-ai/sdk` (model set in `lib/ai/advisor.ts`), streaming, with RAG over Supabase `kb_chunks` |
| CRM | Twenty CRM REST (people, companies, opportunities, notes) plus a signed webhook |
| Data | Supabase Postgres + pgvector + private `deal-documents` storage bucket |

## What's where

```
app/(site)/page.tsx          Homepage: hero, AI loan sizer, bento, rate board, structures
app/(site)/partners          Lender / referral / operator / vendor portal
app/express                  60-second qualifier (served at kubera.loans/ by proxy.ts)
app/api/qualify              Intake → Jev → Supabase → Twenty (after response)
app/api/ask                  Streaming Claude advisor + term sheets
app/api/partners             Partner registration → Supabase → Twenty
app/api/documents            Signed upload URLs into the private document vault
app/api/cron/rates           15-min cron: refresh rate cache, snapshot to Supabase
app/api/webhooks/twenty      HMAC-verified Twenty webhook → crm_events
lib/sizing/assumptions.ts    Every spread, MIP, cap, and fee assumption in one file
lib/sizing/programs.ts       Program sizing (LTV/LTC/DSCR/debt-yield constrained)
lib/ai/jev.ts                JevLoanDecisionSchema + rules engine + remote refinement
lib/ai/lenders.ts            Program → wholesale lender routing table
supabase/migrations          Schema, RLS, hybrid search function, storage bucket
proxy.ts                     Host routing for kubera.loans (Next 16 name for middleware.ts)
```

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in what you have; everything degrades gracefully
npm run dev
npm test                     # sizing + Jev unit tests
```

Without credentials, the sizer and qualifier still work: rates fall back to indicative values, leads return a decision but aren't persisted, and Ask Kubera AI returns 503.

### Supabase

Apply `supabase/migrations/20261031000000_init.sql` (`supabase db push`, or paste it into the SQL editor). Every table has RLS enabled with no policies, so only the server's service-role key can read or write. Load the knowledge base with `npm run kb:ingest` after adding sources to `knowledge/`.

### Twenty CRM

Create an API key, then set `TWENTY_API_URL` and `TWENTY_API_KEY`. Leads create (or reuse by email) a Person, an optional Company, an Opportunity at stage `QUALIFICATION` with amount, expected revenue, and probability by tier, and a note holding the full Jev decision and intake. For the webhook, point it at `/api/webhooks/twenty` and set `TWENTY_WEBHOOK_SECRET`.

### Domains (Vercel)

Add both `kuberacommercial.com` and `kubera.loans` to the same project. `proxy.ts` rewrites `kubera.loans/` to `/express`, passes `/api/*` through, and 308-redirects every other path to the main site.

## Jev decision engine

`decide(intake)` returns the `JevLoanDecisionSchema` from the spec, validated with Zod. Two additions keep it complete for multifamily:

- `primaryProgramFit` also allows `HUD_221D4_223F_MULTIFAMILY` and `AGENCY_FANNIE_FREDDIE`
- `sizingOptimizationFlag` also allows `OPTIMAL_AS_STRUCTURED` (non-HUD structures already optimal)

The rules engine runs the same sizing code the public sizer uses, so CRM numbers and on-screen numbers always match. If `JEV_API_URL` is set, the hosted model may refine the classification, but the commission figure always comes from the sizer. Borrowers only ever see `publicSummary()`; tier, commission, and lender routing stay internal.

## Before launch

- [ ] Confirm DRE license #01522444 (the license of record in `lib/site.ts`) and set `NEXT_PUBLIC_DRE_OFFICER_LICENSE` for the designated officer.
- [ ] Have the designated officer review `lib/sizing/assumptions.ts`, especially the items marked **VERIFY** (2026 SBA combined cap, Green MIP scope).
- [ ] Confirm lender routing in `lib/ai/lenders.ts` matches signed correspondent / fee agreements.
- [ ] Have counsel review the TCPA consent copy, referral-fee language (B&P § 10137), and the illustrative structures.
- [ ] Put a shared rate limiter (Vercel WAF or Upstash) in front of `/api/ask` and `/api/qualify`; the built-in limiter is per-instance.
