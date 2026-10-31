// Long-running scan worker for deployments with a container (instead of the
// /api/documents/scan cron route). Polls the database queue; documents are
// leased, so several workers can run side by side.
//
//   npm run scan:worker            # loop until SIGTERM
//   npm run scan:worker -- --once  # one cycle, then exit (for a scheduler)
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and a scanner (CLAMAV_REST_URL).

import { checklistDeps, deskServices } from "@/lib/checklists/server";
import { settlePortalDocument } from "@/lib/checklists/service";
import { documentServices } from "@/lib/documents/server";
import { announceDocumentClean, runScanCycle, scannerFromEnv } from "./index";

async function main(): Promise<void> {
  const deps = documentServices();
  if (!deps) throw new Error("Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
  const scanner = scannerFromEnv();
  const once = process.argv.includes("--once");
  // Portal uploads: a settled scan moves the checklist file (clean → item received; infected → rejected).
  const desk = deskServices();
  const onSettled = desk ? async (documentId: string) => void (await settlePortalDocument(checklistDeps(desk), documentId)) : undefined;
  const intervalMs = Math.max(1, Number(process.env.SCAN_POLL_SECONDS) || 15) * 1000;

  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => (stopping = true));

  do {
    const report = await runScanCycle(deps, scanner, { batchSize: 10, onSettled, onClean: announceDocumentClean });
    if (report.claimed || report.sweep?.finalized || report.sweep?.expired) console.log(JSON.stringify({ at: new Date().toISOString(), ...report }));
    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (!stopping);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
