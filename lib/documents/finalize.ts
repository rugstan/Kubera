// Step 2 of an upload: after the browser has PUT the file into the quarantine
// bucket, finalize checks the stored object (size, declared type vs. magic
// bytes, lead quota) before the document is allowed into the scan queue.
//
// Anything that fails is deleted from storage and the row is kept as
// `rejected`, so there is a record of what was refused and why.

import { fail, type Failure, type VaultDeps } from "./mint";
import { SNIFF_BYTES, sniffContent } from "./magic";
import { recordQuietly } from "./store";
import { verifyUploadToken } from "./token";
import { ALLOWED_CONTENT_TYPES, QUARANTINE_BUCKET, type AllowedContentType, type DocumentRow } from "./types";

export type FinalizeSuccess = { ok: true; documentId: string; status: DocumentRow["status"]; alreadyFinalized: boolean };

type Actor = { actor: string; ipHash?: string };

function isAllowedType(value: string): value is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

async function reject(deps: VaultDeps, row: DocumentRow, code: string, message: string, who: Actor): Promise<Failure> {
  const removed = await deps.storage.remove(QUARANTINE_BUCKET, [row.storage_path]);
  if (removed.error) console.error(`[documents] could not delete rejected upload ${row.id}:`, removed.error);
  await deps.store.update(row.id, { status: "rejected", reject_reason: message.slice(0, 500), scan_lease_until: null }, "pending_upload");
  await recordQuietly(deps.events, {
    event: "upload_rejected",
    document_id: row.id,
    lead_id: row.lead_id,
    actor: who.actor,
    ip_hash: who.ipHash ?? null,
    detail: { code },
  });
  return fail(422, code, message);
}

/**
 * Verifies the uploaded object and queues it for scanning. Idempotent: a document
 * that is already past this step reports its status instead of failing.
 */
export async function finalizeDocument(deps: VaultDeps, documentId: string, who: Actor): Promise<FinalizeSuccess | Failure> {
  const { store, storage, limits } = deps;
  const row = await store.get(documentId);
  if (!row) return fail(404, "not_found", "Unknown upload");

  if (row.status === "quarantined" || row.status === "clean") return { ok: true, documentId, status: row.status, alreadyFinalized: true };
  if (row.status === "rejected") return fail(422, "rejected", row.reject_reason ?? "This upload was rejected.");
  if (row.status !== "pending_upload") return fail(409, "wrong_state", "This upload cannot be finalized.");

  const info = await storage.stat(QUARANTINE_BUCKET, row.storage_path);
  if (!info) return fail(409, "not_uploaded", "We have not received the file yet. Upload it, then try again.");

  const declaredType = row.content_type;
  if (!isAllowedType(declaredType)) return reject(deps, row, "type_not_allowed", "This file type is not accepted.", who);
  if (info.size === 0) return reject(deps, row, "empty", "The file is empty.", who);
  if (info.size > limits.maxFileBytes) {
    return reject(deps, row, "file_too_large", `Files can be at most ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB.`, who);
  }
  if (row.declared_size_bytes != null && info.size > row.declared_size_bytes) {
    return reject(deps, row, "size_mismatch", "The uploaded file is larger than the size it was announced with.", who);
  }

  // Quota with real sizes: this row is counted at its declared size, so swap that for the actual one.
  const usage = await store.usageForLead(row.lead_id);
  const others = usage.bytes - Number(row.declared_size_bytes ?? 0);
  if (others + info.size > limits.maxBytesPerLead) {
    return reject(deps, row, "quota_bytes", "This loan file has reached its storage limit. Email your advisor to add more documents.", who);
  }

  const head = await storage.readHead(QUARANTINE_BUCKET, row.storage_path, SNIFF_BYTES);
  if (!head) return fail(409, "not_uploaded", "We have not received the file yet. Upload it, then try again.");
  const verdict = sniffContent(declaredType, head, head.byteLength >= info.size);
  if (!verdict.ok) return reject(deps, row, "content_mismatch", verdict.reason, who);

  const updated = await store.update(
    row.id,
    { status: "quarantined", size_bytes: info.size, detected_mime: verdict.detected, finalized_at: deps.clock().toISOString() },
    "pending_upload",
  );
  if (!updated) {
    // Another finalize (or the sweep) won the race; report where the document is now.
    const current = await store.get(row.id);
    return current && (current.status === "quarantined" || current.status === "clean")
      ? { ok: true, documentId, status: current.status, alreadyFinalized: true }
      : fail(409, "wrong_state", "This upload cannot be finalized.");
  }
  await recordQuietly(deps.events, {
    event: "upload_finalized",
    document_id: row.id,
    lead_id: row.lead_id,
    actor: who.actor,
    ip_hash: who.ipHash ?? null,
    detail: { size_bytes: info.size, detected_mime: verdict.detected },
  });
  return { ok: true, documentId, status: "quarantined", alreadyFinalized: false };
}

/** The HTTP path: the browser presents the token minted with the upload. */
export async function finalizeWithToken(
  deps: VaultDeps,
  input: { documentId: string; token: string; ipHash?: string },
  env: Record<string, string | undefined> = process.env,
): Promise<FinalizeSuccess | Failure> {
  const verdict = verifyUploadToken(input.token, deps.clock(), env);
  if (!verdict.ok) {
    if (verdict.reason === "expired") return fail(401, "token_expired", "This upload link has expired. Please start the upload again.");
    if (verdict.reason === "not_configured") return fail(503, "not_configured", "Document vault not configured");
    return fail(401, "invalid_token", "Unauthorized");
  }
  if (verdict.claims.documentId !== input.documentId) return fail(401, "invalid_token", "Unauthorized");
  // The token also pins the lead; a row for a different lead is never finalized with it.
  const row = await deps.store.get(input.documentId);
  if (row && row.lead_id !== verdict.claims.leadId) return fail(401, "invalid_token", "Unauthorized");
  return finalizeDocument(deps, input.documentId, { actor: "borrower", ipHash: input.ipHash });
}
