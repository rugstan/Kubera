// One scan cycle: settle abandoned uploads, lease a batch of quarantined
// documents, scan each, and either release it to the vault (clean), destroy it
// (infected) or retry / park it (scanner error).
//
// Fail-closed throughout: a document only becomes `clean` after a scanner
// explicitly says so, and only then is its object moved out of quarantine.

import { createHash } from "node:crypto";
import { sweepPendingUploads, type SweepReport } from "@/lib/documents/lifecycle";
import type { VaultDeps } from "@/lib/documents/mint";
import { recordQuietly } from "@/lib/documents/store";
import { QUARANTINE_BUCKET, VAULT_BUCKET, type DocumentRow, type VaultBucket } from "@/lib/documents/types";
import type { MalwareScanner } from "./scanner";
import { sendWorkflowEvent } from "@/lib/workflows/client";
import { EVENTS } from "@/lib/workflows/events";

export type ScanReport = {
  skipped?: "scanner-not-configured";
  sweep?: SweepReport;
  claimed: number;
  clean: number;
  infected: number;
  retrying: number;
  failed: number;
};

const empty = (): ScanReport => ({ claimed: 0, clean: 0, infected: 0, retrying: 0, failed: 0 });

const other = (b: VaultBucket): VaultBucket => (b === VAULT_BUCKET ? QUARANTINE_BUCKET : VAULT_BUCKET);

/** The object normally sits in row.bucket; a move that was interrupted can leave it in the other one. */
async function locate(deps: VaultDeps, row: DocumentRow): Promise<{ bucket: VaultBucket; bytes: Uint8Array } | null> {
  for (const bucket of [row.bucket, other(row.bucket)]) {
    const bytes = await deps.storage.read(bucket, row.storage_path, deps.limits.maxFileBytes);
    if (bytes) return { bucket, bytes };
  }
  return null;
}

async function recordFailure(deps: VaultDeps, row: DocumentRow, engine: string, message: string, report: ScanReport): Promise<void> {
  const attempts = row.scan_attempts;
  const now = deps.clock();
  if (attempts >= deps.limits.maxScanAttempts) {
    await deps.store.update(row.id, { status: "scan_failed", scan_error: message.slice(0, 500), scan_engine: engine, scan_lease_until: null }, "quarantined");
    await recordQuietly(deps.events, { event: "scan_failed", document_id: row.id, lead_id: row.lead_id, actor: "scanner", detail: { attempts, engine, error: message.slice(0, 200) } });
    console.error(`[scan] document ${row.id} parked as scan_failed after ${attempts} attempts: ${message}`);
    report.failed++;
    return;
  }
  // Back off: 1, 2, 3... minutes (capped), so a scanner outage is not hammered.
  const retryAt = new Date(now.getTime() + Math.min(attempts, 15) * 60_000);
  await deps.store.update(row.id, { scan_error: message.slice(0, 500), scan_engine: engine, scan_lease_until: retryAt.toISOString() }, "quarantined");
  await recordQuietly(deps.events, { event: "scan_error", document_id: row.id, lead_id: row.lead_id, actor: "scanner", detail: { attempts, engine, error: message.slice(0, 200) } });
  report.retrying++;
}

/** Called once a document's scan is settled (clean, infected or parked as scan_failed). */
export type ScanSettledHook = (documentId: string) => Promise<void>;

async function scanOne(deps: VaultDeps, scanner: MalwareScanner, row: DocumentRow, report: ScanReport): Promise<boolean> {
  let found: Awaited<ReturnType<typeof locate>>;
  try {
    found = await locate(deps, row);
  } catch (err) {
    await recordFailure(deps, row, scanner.name, `could not read the stored file: ${err instanceof Error ? err.message : String(err)}`, report);
    return false;
  }
  if (!found) {
    await recordFailure(deps, row, scanner.name, "stored file not found", report);
    return false;
  }

  const sha256 = createHash("sha256").update(found.bytes).digest("hex");
  const verdict = await scanner.scan(found.bytes, row.file_name).catch((err) => ({
    status: "error" as const,
    engine: scanner.name,
    message: err instanceof Error ? err.message : String(err),
  }));

  if (verdict.status === "error") {
    await recordFailure(deps, row, verdict.engine, verdict.message, report);
    return false;
  }

  const now = deps.clock().toISOString();
  if (verdict.status === "infected") {
    // Destroy the object first; the row stays as the record of what happened.
    const removed = await deps.storage.remove(found.bucket, [row.storage_path]);
    const removedOther = removed.error ? removed : await deps.storage.remove(other(found.bucket), [row.storage_path]);
    if (removedOther.error) {
      // Still record the detection (the object is unreachable: only `clean` rows download). The
      // leftover is noted in scan_error and removed by deleteDocument / the retention run.
      console.error(`[scan] could not delete infected object for ${row.id}: ${removedOther.error}`);
    }
    await deps.store.update(
      row.id,
      { status: "infected", sha256, scanned_at: now, scan_engine: verdict.engine, scan_signature: verdict.signature, scan_error: removedOther.error ? `infected object not deleted: ${removedOther.error}`.slice(0, 500) : null, scan_lease_until: null },
      "quarantined",
    );
    await recordQuietly(deps.events, { event: "scan_infected", document_id: row.id, lead_id: row.lead_id, actor: "scanner", detail: { signature: verdict.signature, engine: verdict.engine, size_bytes: found.bytes.byteLength } });
    console.error(`[scan] malware detected in document ${row.id} (lead ${row.lead_id}): ${verdict.signature}`);
    report.infected++;
    return true;
  }

  // Clean: release to the vault bucket, then record it. If the row update fails after the
  // move, locate() finds the object in the vault bucket on the next attempt.
  if (found.bucket !== VAULT_BUCKET) {
    const moved = await deps.storage.move(found.bucket, VAULT_BUCKET, row.storage_path);
    if (moved.error) {
      await recordFailure(deps, row, verdict.engine, `could not release the file to the vault: ${moved.error}`, report);
      return false;
    }
  }
  const updated = await deps.store.update(
    row.id,
    { status: "clean", bucket: VAULT_BUCKET, sha256, scanned_at: now, scan_engine: verdict.engine, scan_signature: null, scan_error: null, scan_lease_until: null },
    "quarantined",
  );
  if (updated) {
    await recordQuietly(deps.events, { event: "scan_clean", document_id: row.id, lead_id: row.lead_id, actor: "scanner", detail: { engine: verdict.engine, size_bytes: found.bytes.byteLength } });
    report.clean++;
  }
  return Boolean(updated);
}

/**
 * Announces a newly clean document to the workflows (the document agent's
 * `corin/document.clean` trigger). The event id makes a re-announcement a no-op.
 */
export const announceDocumentClean: ScanSettledHook = async (documentId) => {
  await sendWorkflowEvent({ name: EVENTS.documentClean, id: `document-clean:${documentId}`, data: { documentId } });
};

export async function runScanCycle(
  deps: VaultDeps,
  scanner: MalwareScanner | null,
  opts: { batchSize?: number; onSettled?: ScanSettledHook; onClean?: ScanSettledHook } = {},
): Promise<ScanReport> {
  const report = empty();
  report.sweep = await sweepPendingUploads(deps);
  if (!scanner) {
    report.skipped = "scanner-not-configured";
    return report;
  }
  const batch = await deps.store.claimForScan(opts.batchSize ?? 10, deps.limits.scanLeaseSeconds);
  report.claimed = batch.length;
  for (const row of batch) {
    try {
      const failedBefore = report.failed;
      const cleanBefore = report.clean;
      const settled = (await scanOne(deps, scanner, row, report)) || report.failed > failedBefore;
      if (report.clean > cleanBefore && opts.onClean) {
        // A failed announcement never undoes the release; the scan cron does not retry it.
        await opts.onClean(row.id).catch((err) => console.error(`[scan] clean hook failed for ${row.id}:`, err instanceof Error ? err.message : err));
      }
      if (settled && opts.onSettled) {
        // Downstream (the checklist item behind a portal upload) must never undo the scan result.
        await opts.onSettled(row.id).catch((err) => console.error(`[scan] settle hook failed for ${row.id}:`, err instanceof Error ? err.message : err));
      }
    } catch (err) {
      console.error(`[scan] unexpected failure on ${row.id}:`, err instanceof Error ? err.message : err);
      report.retrying++;
    }
  }
  return report;
}
