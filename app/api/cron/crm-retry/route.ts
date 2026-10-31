import { NextResponse } from "next/server";
import { twentyConfigured } from "@/lib/crm/twenty";
import { smsConsentLookup, SupabaseConsentReader } from "@/lib/notify/consent";
import { optOutSinkFromEnv, supabaseKnownPersonIds } from "@/lib/notify/optout";
import { supabaseOptOutSyncQueue } from "@/lib/notify/optout-sync";
import { getMarketSnapshot } from "@/lib/rates";
import { safeEqual } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runCrmRetry } from "./retry";
import { rebuildJevFactory, supabaseRetryStore, twentyPusher } from "./wiring";

export const maxDuration = 60;

// Vercel Cron hits this every 30 minutes (vercel.json) with
// `Authorization: Bearer $CRON_SECRET`. It re-pushes leads and partners whose
// Twenty sync failed (rows carrying `crm_error`); see ./retry.ts.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!twentyConfigured()) {
    console.warn("crm-retry skipped: Twenty CRM is not configured");
    return NextResponse.json({ ok: true, skipped: "twenty-not-configured" });
  }
  const db = supabaseAdmin();
  if (!db) {
    console.warn("crm-retry skipped: Supabase is not configured");
    return NextResponse.json({ ok: true, skipped: "supabase-not-configured" });
  }

  try {
    const { benchmarks } = await getMarketSnapshot();
    const sink = optOutSinkFromEnv(supabaseKnownPersonIds(db));
    const summary = await runCrmRetry({
      store: supabaseRetryStore(db),
      crm: twentyPusher,
      rebuildJev: rebuildJevFactory(benchmarks),
      smsConsent: smsConsentLookup(new SupabaseConsentReader(db)),
      optOuts: sink ? { queue: supabaseOptOutSyncQueue(db), sink } : null,
    });
    const exhausted = summary.leads.exhausted + summary.partners.exhausted + (summary.optOuts?.exhausted ?? 0);
    // Surfaces in logs and Sentry: someone has to enter these by hand.
    if (exhausted > 0) console.error(`crm-retry: ${exhausted} row(s) exhausted retries and need manual CRM entry`);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("crm-retry failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "crm-retry failed" }, { status: 500 });
  }
}
