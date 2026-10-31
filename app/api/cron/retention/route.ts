import { NextResponse } from "next/server";
import { processDeletionRequests, runRetention } from "@/lib/privacy/retention";
import { privacyServices } from "@/lib/privacy/server";
import { logRetentionRun } from "@/lib/privacy/supabase";
import { safeEqual } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 300;

// Daily retention run (Vercel Cron, `Authorization: Bearer $CRON_SECRET`):
// first works verified deletion requests from the compliance queue, then
// applies every retention policy in lib/privacy/retention.ts. Storage objects
// are deleted with their rows; legal holds are never touched.
// `?dryRun=1` counts what would be deleted without deleting anything.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const services = privacyServices();
  if (!services) {
    console.warn("retention skipped: Supabase is not configured");
    return NextResponse.json({ ok: true, skipped: "supabase-not-configured" });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  try {
    const deps = { db: services.retention, storage: services.storage };
    const deletionRequests = dryRun ? undefined : await processDeletionRequests({ ...deps, requests: services.requests });
    const summary = { ...(await runRetention({ ...deps, dryRun })), ...(deletionRequests ? { deletionRequests } : {}) };
    if (deletionRequests?.errors.length) summary.ok = false;

    const db = supabaseAdmin();
    if (db) await logRetentionRun(db, summary);
    if (!summary.ok) console.error("retention run finished with errors", JSON.stringify(summary.policies.filter((p) => p.errors.length || p.failed)));
    return NextResponse.json(summary);
  } catch (err) {
    console.error("retention run failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "retention run failed" }, { status: 500 });
  }
}
