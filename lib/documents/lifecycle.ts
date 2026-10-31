// Operations on documents that already exist: expiring abandoned uploads,
// deleting a document together with its storage objects, and issuing audited
// download links.

import { finalizeDocument } from "./finalize";
import { fail, type Failure, type VaultDeps } from "./mint";
import { recordQuietly } from "./store";
import { QUARANTINE_BUCKET, VAULT_BUCKET } from "./types";

type Actor = { actor: string; ipHash?: string };

// --- Deletion ----------------------------------------------------------------------

export type DeleteSuccess = { ok: true; documentId: string };

/**
 * Deletes a document's storage objects (both buckets, since a move may have
 * been interrupted) and then its row. Storage goes first so a failed Storage
 * call leaves the row in place for a retry instead of orphaning a file. A
 * document under legal hold is never deleted.
 */
export async function deleteDocument(deps: VaultDeps, documentId: string, who: Actor & { reason?: string }): Promise<DeleteSuccess | Failure> {
  const row = await deps.store.get(documentId);
  if (!row) return fail(404, "not_found", "Document not found");
  if (row.legal_hold) return fail(423, "legal_hold", "This document is under legal hold and cannot be deleted.");

  for (const bucket of [row.bucket, row.bucket === VAULT_BUCKET ? QUARANTINE_BUCKET : VAULT_BUCKET]) {
    const removed = await deps.storage.remove(bucket, [row.storage_path]);
    if (removed.error) {
      console.error(`[documents] storage delete failed for ${row.id}:`, removed.error);
      return fail(502, "storage_error", "Could not delete the stored file; nothing was removed from the record.");
    }
  }
  let removedRow: boolean;
  try {
    removedRow = await deps.store.remove(row.id);
  } catch (err) {
    console.error(`[documents] row delete failed for ${row.id}:`, err instanceof Error ? err.message : err);
    return fail(409, "delete_refused", "The record could not be deleted (is it under legal hold?).");
  }
  if (removedRow) {
    await recordQuietly(deps.events, {
      event: "deleted",
      document_id: row.id,
      lead_id: row.lead_id,
      actor: who.actor,
      ip_hash: who.ipHash ?? null,
      detail: { status: row.status, ...(who.reason ? { reason: who.reason.slice(0, 200) } : {}) },
    });
  }
  return { ok: true, documentId };
}

export type LeadDeleteReport = { deleted: number; blocked: { documentId: string; code: string }[] };

export async function deleteLeadDocuments(deps: VaultDeps, leadId: string, who: Actor & { reason?: string }): Promise<LeadDeleteReport> {
  const report: LeadDeleteReport = { deleted: 0, blocked: [] };
  for (const row of await deps.store.listForLead(leadId)) {
    const res = await deleteDocument(deps, row.id, who);
    if (res.ok) report.deleted++;
    else report.blocked.push({ documentId: row.id, code: res.code });
  }
  return report;
}

// --- Abandoned uploads -----------------------------------------------------------------

/** A signed upload URL is good for two hours; a row older than this with no object is abandoned. */
export const PENDING_GRACE_SECONDS = 3 * 60 * 60;

export type SweepReport = { finalized: number; rejected: number; expired: number; waiting: number; errors: number };

/**
 * Handles `pending_upload` rows that nobody finalized: a file that did arrive
 * (the browser closed or an older client never called finalize) goes through
 * the same finalize checks; a row whose file never arrived is deleted once the
 * upload URL can no longer be used.
 */
export async function sweepPendingUploads(deps: VaultDeps, opts: { minAgeSeconds?: number; graceSeconds?: number; limit?: number } = {}): Promise<SweepReport> {
  const now = deps.clock();
  const minAge = opts.minAgeSeconds ?? 30;
  const grace = opts.graceSeconds ?? PENDING_GRACE_SECONDS;
  const report: SweepReport = { finalized: 0, rejected: 0, expired: 0, waiting: 0, errors: 0 };
  const stale = await deps.store.listStalePending(new Date(now.getTime() - minAge * 1000), opts.limit ?? 100);

  for (const row of stale) {
    try {
      const present = await deps.storage.stat(QUARANTINE_BUCKET, row.storage_path);
      if (present) {
        const res = await finalizeDocument(deps, row.id, { actor: "system" });
        if (res.ok) report.finalized++;
        else if (res.code === "not_uploaded") report.waiting++;
        else report.rejected++;
        continue;
      }
      if (now.getTime() - new Date(row.created_at).getTime() < grace * 1000) {
        report.waiting++;
        continue;
      }
      if (await deps.store.remove(row.id)) {
        report.expired++;
        await recordQuietly(deps.events, { event: "upload_expired", document_id: row.id, lead_id: row.lead_id, actor: "system", detail: {} });
      }
    } catch (err) {
      report.errors++;
      console.error(`[documents] sweep failed for ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return report;
}

// --- Downloads ----------------------------------------------------------------------------

export type DownloadSuccess = { ok: true; url: string; fileName: string; contentType: string; expiresInSeconds: number };

export type DownloadRequest = Actor & { documentId: string; purpose?: string };

/**
 * Issues a short-lived signed URL for a `clean` document. The audit event is
 * written BEFORE the URL is created: if the audit trail is unavailable the
 * download is refused. Refusals are audited too.
 */
export async function createDownloadLink(deps: VaultDeps, req: DownloadRequest): Promise<DownloadSuccess | Failure> {
  const row = await deps.store.get(req.documentId);
  const base = { document_id: row?.id ?? null, lead_id: row?.lead_id ?? null, actor: req.actor, ip_hash: req.ipHash ?? null };

  const deny = async (status: number, code: string, message: string, detail: Record<string, string | number | boolean | null> = {}) => {
    await recordQuietly(deps.events, { ...base, event: "download_denied", detail: { code, requested: req.documentId, ...detail } });
    return fail(status, code, message);
  };

  if (!row) return deny(404, "not_found", "Document not found");
  if (row.status !== "clean") return deny(409, "not_available", "This document is not available for download yet.", { status: row.status });
  if (row.bucket !== VAULT_BUCKET) return deny(409, "not_available", "This document is not available for download yet.", { bucket: row.bucket });

  try {
    await deps.events.record({
      ...base,
      event: "download",
      detail: { kind: row.kind, ...(req.purpose ? { purpose: req.purpose.slice(0, 200) } : {}) },
    });
  } catch (err) {
    console.error("[documents] audit write failed; refusing download:", err instanceof Error ? err.message : err);
    return fail(503, "audit_unavailable", "Downloads are temporarily unavailable.");
  }

  const signed = await deps.storage.createSignedDownloadUrl(VAULT_BUCKET, row.storage_path, deps.limits.downloadTtlSeconds, row.file_name);
  if ("error" in signed) {
    console.error(`[documents] could not sign download for ${row.id}:`, signed.error);
    return fail(502, "storage_error", "Could not prepare the download.");
  }
  return { ok: true, url: signed.url, fileName: row.file_name, contentType: row.content_type, expiresInSeconds: deps.limits.downloadTtlSeconds };
}
