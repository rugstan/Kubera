// Step 1 of an upload: check quotas, record a `pending_upload` row and hand the
// browser a signed URL into the QUARANTINE bucket plus an expiring upload token.

import { randomUUID } from "node:crypto";
import { extensionMatches, sanitizeFileName } from "./magic";
import type { VaultStorage } from "./storage";
import type { DocumentEventLog, DocumentStore } from "./store";
import { recordQuietly } from "./store";
import { signUploadToken } from "./token";
import { QUARANTINE_BUCKET, type AllowedContentType, type Clock, type DocumentKind, type VaultLimits } from "./types";

export type VaultDeps = {
  store: DocumentStore;
  events: DocumentEventLog;
  storage: VaultStorage;
  clock: Clock;
  limits: VaultLimits;
};

export type Failure = { ok: false; status: number; code: string; message: string };
export const fail = (status: number, code: string, message: string): Failure => ({ ok: false, status, code, message });

export type MintInput = {
  leadId: string;
  kind: DocumentKind;
  fileName: string;
  contentType: AllowedContentType;
  /** Exact byte size of the file the browser is about to send. Optional for older clients; then the per-file cap is reserved. */
  sizeBytes?: number;
  ipHash?: string;
};

export type MintSuccess = {
  ok: true;
  documentId: string;
  uploadUrl: string;
  path: string;
  uploadToken: string;
  expiresAt: string;
  maxBytes: number;
};

export type ReservedUpload = Omit<MintSuccess, "uploadToken">;

/**
 * Step 1 for a caller that finalizes server-side under its own session (the
 * borrower portal): the same checks, row and quarantine upload URL as
 * mintUpload, without the bearer upload token.
 */
export async function reserveUpload(deps: VaultDeps, input: MintInput): Promise<ReservedUpload | Failure> {
  const { store, events, storage, clock, limits } = deps;
  const fileName = sanitizeFileName(input.fileName);
  if (!extensionMatches(fileName, input.contentType)) {
    return fail(400, "extension_mismatch", "The file extension does not match the file type. Rename the file or choose another type.");
  }
  const declared = input.sizeBytes ?? limits.maxFileBytes;
  if (!Number.isInteger(declared) || declared <= 0) return fail(400, "invalid_size", "The file is empty.");
  if (declared > limits.maxFileBytes) {
    return fail(413, "file_too_large", `Files can be at most ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB. Split it into smaller files or email it to your advisor.`);
  }

  // Quotas. Re-checked with real sizes at finalize, which is the authoritative gate.
  const usage = await store.usageForLead(input.leadId);
  if (usage.files + 1 > limits.maxFilesPerLead) {
    return fail(429, "quota_files", "This loan file has reached its upload limit. Email your advisor to add more documents.");
  }
  if (usage.bytes + declared > limits.maxBytesPerLead) {
    return fail(413, "quota_bytes", "This loan file has reached its storage limit. Email your advisor to add more documents.");
  }

  const now = clock();
  const expiresAt = new Date(now.getTime() + limits.uploadTtlSeconds * 1000);
  const path = `${input.leadId}/${input.kind}/${randomUUID()}-${fileName}`;

  const row = await store.insert({
    lead_id: input.leadId,
    kind: input.kind,
    storage_path: path,
    file_name: fileName,
    content_type: input.contentType,
    declared_size_bytes: declared,
    upload_expires_at: expiresAt.toISOString(),
  });

  const signed = await storage.createSignedUploadUrl(QUARANTINE_BUCKET, path);
  if ("error" in signed) {
    await store.remove(row.id).catch(() => false);
    console.error("[documents] could not create upload URL:", signed.error);
    return fail(500, "upload_url", "Could not create upload");
  }

  await recordQuietly(events, {
    event: "upload_minted",
    document_id: row.id,
    lead_id: input.leadId,
    actor: "borrower",
    ip_hash: input.ipHash ?? null,
    detail: { kind: input.kind, declared_size_bytes: declared, content_type: input.contentType },
  });

  return { ok: true, documentId: row.id, uploadUrl: signed.url, path, expiresAt: expiresAt.toISOString(), maxBytes: declared };
}

export async function mintUpload(deps: VaultDeps, input: MintInput, env: Record<string, string | undefined> = process.env): Promise<MintSuccess | Failure> {
  const reserved = await reserveUpload(deps, input);
  if (!reserved.ok) return reserved;
  return { ...reserved, uploadToken: signUploadToken({ documentId: reserved.documentId, leadId: input.leadId, expiresAt: new Date(reserved.expiresAt) }, env) };
}
