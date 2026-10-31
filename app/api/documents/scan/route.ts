import { NextResponse } from "next/server";
import { checklistDeps, deskServices } from "@/lib/checklists/server";
import { settlePortalDocument } from "@/lib/checklists/service";
import { NO_STORE } from "@/lib/documents/http";
import { documentServices } from "@/lib/documents/server";
import { safeEqual } from "@/lib/security";
import { announceDocumentClean, runScanCycle, scannerFromEnv } from "@/workers/scan";

export const maxDuration = 300;

// Scan trigger for deployments without a long-running worker (Vercel Cron or any
// scheduler; `Authorization: Bearer $CRON_SECRET`). One call settles abandoned
// uploads and scans one batch of quarantined documents. A container can run
// `npm run scan:worker` instead. Idempotent and safe to run concurrently:
// documents are leased in the database.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const deps = documentServices();
  if (!deps) {
    console.warn("document scan skipped: Supabase is not configured");
    return NextResponse.json({ ok: true, skipped: "supabase-not-configured" }, { headers: NO_STORE });
  }
  try {
    // Portal uploads: a settled scan moves the checklist file (clean → item received; infected → rejected).
    const desk = deskServices();
    const onSettled = desk ? async (documentId: string) => void (await settlePortalDocument(checklistDeps(desk), documentId)) : undefined;
    const report = await runScanCycle(deps, scannerFromEnv(), { batchSize: 20, onSettled, onClean: announceDocumentClean });
    return NextResponse.json({ ok: true, ...report }, { headers: NO_STORE });
  } catch (err) {
    console.error("document scan failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "scan failed" }, { status: 500, headers: NO_STORE });
  }
}

export const GET = run;
export const POST = run;
