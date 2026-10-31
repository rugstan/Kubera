import { describe, expect, it, vi } from "vitest";
import { finalizeDocument, finalizeWithToken } from "./finalize";
import { createDownloadLink, deleteDocument, deleteLeadDocuments, sweepPendingUploads } from "./lifecycle";
import { mintUpload, type MintInput, type MintSuccess } from "./mint";
import { CSV_BYTES, LEAD_ID, OTHER_LEAD_ID, PDF_BYTES, PNG_BYTES, TEST_ENV, makeVault } from "./testing";
import { signUploadToken } from "./token";
import { QUARANTINE_BUCKET, VAULT_BUCKET } from "./types";

const input = (over: Partial<MintInput> = {}): MintInput => ({ leadId: LEAD_ID, kind: "T12", fileName: "t12.pdf", contentType: "application/pdf", sizeBytes: PDF_BYTES.byteLength, ...over });

async function mint(v: ReturnType<typeof makeVault>, over: Partial<MintInput> = {}): Promise<MintSuccess> {
  const res = await mintUpload(v.deps, input(over), TEST_ENV);
  if (!res.ok) throw new Error(`mint failed: ${res.code}`);
  return res;
}

/** Mint + browser upload to the signed URL. */
async function uploaded(v: ReturnType<typeof makeVault>, bytes: Uint8Array, over: Partial<MintInput> = {}) {
  const m = await mint(v, { sizeBytes: bytes.byteLength, ...over });
  v.storage.upload(QUARANTINE_BUCKET, m.path, bytes);
  return m;
}

describe("mintUpload", () => {
  it("records a pending row in quarantine and returns a signed URL plus an expiring token", async () => {
    const v = makeVault();
    const m = await mint(v);
    const row = (await v.store.get(m.documentId))!;
    expect(row).toMatchObject({ status: "pending_upload", bucket: QUARANTINE_BUCKET, lead_id: LEAD_ID, declared_size_bytes: PDF_BYTES.byteLength, content_type: "application/pdf" });
    expect(m.path).toMatch(new RegExp(`^${LEAD_ID}/T12/[0-9a-f-]{36}-t12\\.pdf$`));
    expect(m.uploadUrl).toContain(QUARANTINE_BUCKET);
    expect(m.expiresAt).toBe(new Date(v.clock.now().getTime() + 15 * 60_000).toISOString());
    expect(v.events.names()).toEqual(["upload_minted"]);
  });

  it("refuses a file name whose extension does not match the type, and sanitizes the stored name", async () => {
    const v = makeVault();
    const bad = await mintUpload(v.deps, input({ fileName: "payload.exe" }), TEST_ENV);
    expect(bad).toMatchObject({ ok: false, status: 400, code: "extension_mismatch" });
    const m = await mint(v, { fileName: "../../T-12 <final>.pdf" });
    expect((await v.store.get(m.documentId))!.file_name).toBe("T-12 _final_.pdf");
  });

  it("refuses oversized and zero-byte declarations", async () => {
    const v = makeVault();
    expect(await mintUpload(v.deps, input({ sizeBytes: 51 * 1024 * 1024 }), TEST_ENV)).toMatchObject({ ok: false, status: 413, code: "file_too_large" });
    expect(await mintUpload(v.deps, input({ sizeBytes: 0 }), TEST_ENV)).toMatchObject({ ok: false, status: 400, code: "invalid_size" });
  });

  it("enforces per-lead file-count and byte quotas, per lead", async () => {
    const v = makeVault({ maxFilesPerLead: 2, maxBytesPerLead: 1000 });
    await mint(v, { sizeBytes: 400 });
    await mint(v, { sizeBytes: 400 });
    expect(await mintUpload(v.deps, input({ sizeBytes: 100 }), TEST_ENV)).toMatchObject({ ok: false, status: 429, code: "quota_files" });
    expect(await mintUpload(v.deps, input({ leadId: OTHER_LEAD_ID, sizeBytes: 1001 }), TEST_ENV)).toMatchObject({ ok: false, status: 413, code: "quota_bytes" });
    // A different lead is unaffected.
    expect((await mintUpload(v.deps, input({ leadId: OTHER_LEAD_ID, sizeBytes: 900 }), TEST_ENV)).ok).toBe(true);
  });

  it("rolls the row back when no upload URL can be created", async () => {
    const v = makeVault();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(v.storage, "createSignedUploadUrl").mockResolvedValue({ error: "storage down" });
    expect(await mintUpload(v.deps, input(), TEST_ENV)).toMatchObject({ ok: false, status: 500 });
    expect(v.store.rows.size).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("finalizeWithToken", () => {
  it("moves a valid upload to quarantined and records size and detected type", async () => {
    const v = makeVault();
    const m = await uploaded(v, PDF_BYTES);
    const res = await finalizeWithToken(v.deps, { documentId: m.documentId, token: m.uploadToken }, TEST_ENV);
    expect(res).toEqual({ ok: true, documentId: m.documentId, status: "quarantined", alreadyFinalized: false });
    expect(await v.store.get(m.documentId)).toMatchObject({ status: "quarantined", size_bytes: PDF_BYTES.byteLength, detected_mime: "application/pdf", bucket: QUARANTINE_BUCKET });
    // Still in quarantine storage, never in the vault bucket yet.
    expect(v.storage.has(QUARANTINE_BUCKET, m.path)).toBe(true);
    expect(v.storage.has(VAULT_BUCKET, m.path)).toBe(false);
    expect(v.events.names()).toEqual(["upload_minted", "upload_finalized"]);
  });

  it("is idempotent", async () => {
    const v = makeVault();
    const m = await uploaded(v, PDF_BYTES);
    await finalizeWithToken(v.deps, { documentId: m.documentId, token: m.uploadToken }, TEST_ENV);
    expect(await finalizeWithToken(v.deps, { documentId: m.documentId, token: m.uploadToken }, TEST_ENV)).toMatchObject({ ok: true, alreadyFinalized: true });
    expect(v.events.names().filter((n) => n === "upload_finalized")).toHaveLength(1);
  });

  it("rejects an expired token and leaves the upload pending", async () => {
    const v = makeVault();
    const m = await uploaded(v, PDF_BYTES);
    v.clock.advance(16 * 60);
    expect(await finalizeWithToken(v.deps, { documentId: m.documentId, token: m.uploadToken }, TEST_ENV)).toMatchObject({ ok: false, status: 401, code: "token_expired" });
    expect((await v.store.get(m.documentId))!.status).toBe("pending_upload");
  });

  it("rejects a forged token, a token for another document, and a token for another lead", async () => {
    const v = makeVault();
    const a = await uploaded(v, PDF_BYTES);
    const b = await uploaded(v, PDF_BYTES);
    expect(await finalizeWithToken(v.deps, { documentId: a.documentId, token: "v1.e30.AAAA" }, TEST_ENV)).toMatchObject({ ok: false, status: 401 });
    expect(await finalizeWithToken(v.deps, { documentId: a.documentId, token: b.uploadToken }, TEST_ENV)).toMatchObject({ ok: false, status: 401, code: "invalid_token" });
    const wrongLead = signUploadToken({ documentId: a.documentId, leadId: OTHER_LEAD_ID, expiresAt: new Date(v.clock.now().getTime() + 60_000) }, TEST_ENV);
    expect(await finalizeWithToken(v.deps, { documentId: a.documentId, token: wrongLead }, TEST_ENV)).toMatchObject({ ok: false, status: 401, code: "invalid_token" });
    expect((await v.store.get(a.documentId))!.status).toBe("pending_upload");
  });

  it("asks the browser to retry when the file has not arrived", async () => {
    const v = makeVault();
    const m = await mint(v);
    expect(await finalizeWithToken(v.deps, { documentId: m.documentId, token: m.uploadToken }, TEST_ENV)).toMatchObject({ ok: false, status: 409, code: "not_uploaded" });
    expect((await v.store.get(m.documentId))!.status).toBe("pending_upload");
  });
});

describe("finalizeDocument content checks", () => {
  it("rejects wrong magic bytes, deletes the object and keeps a rejected row", async () => {
    const v = makeVault();
    const m = await uploaded(v, PNG_BYTES, { fileName: "t12.pdf", contentType: "application/pdf" }); // a PNG renamed to .pdf
    const res = await finalizeWithToken(v.deps, { documentId: m.documentId, token: m.uploadToken }, TEST_ENV);
    expect(res).toMatchObject({ ok: false, status: 422, code: "content_mismatch" });
    expect(v.storage.has(QUARANTINE_BUCKET, m.path)).toBe(false);
    expect(await v.store.get(m.documentId)).toMatchObject({ status: "rejected", reject_reason: "The file is not a valid PDF." });
    expect(v.events.names()).toContain("upload_rejected");
    // A retry reports the same refusal.
    expect(await finalizeDocument(v.deps, m.documentId, { actor: "borrower" })).toMatchObject({ ok: false, code: "rejected" });
  });

  it("rejects an executable labelled as a spreadsheet", async () => {
    const v = makeVault();
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04]);
    const m = await uploaded(v, exe, { fileName: "rent-roll.xls", contentType: "application/vnd.ms-excel" });
    expect(await finalizeDocument(v.deps, m.documentId, { actor: "borrower" })).toMatchObject({ ok: false, code: "content_mismatch" });
  });

  it("rejects empty files and files larger than they were announced", async () => {
    const v = makeVault();
    const empty = await uploaded(v, new Uint8Array(0), { sizeBytes: 10 });
    expect(await finalizeDocument(v.deps, empty.documentId, { actor: "borrower" })).toMatchObject({ ok: false, code: "empty" });

    const liar = await mint(v, { sizeBytes: 20 });
    v.storage.upload(QUARANTINE_BUCKET, liar.path, PDF_BYTES); // 60+ bytes, announced as 20
    expect(await finalizeDocument(v.deps, liar.documentId, { actor: "borrower" })).toMatchObject({ ok: false, code: "size_mismatch" });
    expect(v.storage.has(QUARANTINE_BUCKET, liar.path)).toBe(false);
  });

  it("rejects an upload that would push the lead over its byte quota (racing mints)", async () => {
    const v = makeVault({ maxBytesPerLead: 200 });
    const b = await mint(v, { sizeBytes: 100 });
    v.storage.upload(QUARANTINE_BUCKET, b.path, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array<number>(95).fill(0x41)]));
    // A concurrent mint that passed its own check just before b was recorded.
    await v.store.insert({ lead_id: LEAD_ID, kind: "OTHER", storage_path: "x/y", file_name: "y.pdf", content_type: "application/pdf", declared_size_bytes: 150, upload_expires_at: v.clock.now().toISOString() });
    expect(await finalizeDocument(v.deps, b.documentId, { actor: "borrower" })).toMatchObject({ ok: false, code: "quota_bytes" });
    expect(v.storage.has(QUARANTINE_BUCKET, b.path)).toBe(false);
  });

  it("accepts a CSV declared as text/csv", async () => {
    const v = makeVault();
    const m = await uploaded(v, CSV_BYTES, { fileName: "t12.csv", contentType: "text/csv" });
    expect(await finalizeDocument(v.deps, m.documentId, { actor: "borrower" })).toMatchObject({ ok: true, status: "quarantined" });
  });
});

describe("sweepPendingUploads", () => {
  it("finalizes files whose browser never called finalize and expires rows whose file never arrived", async () => {
    const v = makeVault();
    const arrived = await uploaded(v, PDF_BYTES);
    const never = await mint(v);
    const badFile = await uploaded(v, PNG_BYTES, { fileName: "x.pdf", contentType: "application/pdf" });
    expect(await sweepPendingUploads(v.deps)).toMatchObject({ finalized: 0 }); // too fresh

    v.clock.advance(60);
    expect(await sweepPendingUploads(v.deps)).toMatchObject({ finalized: 1, rejected: 1, waiting: 1, expired: 0 });
    expect((await v.store.get(arrived.documentId))!.status).toBe("quarantined");
    expect((await v.store.get(badFile.documentId))!.status).toBe("rejected");
    expect((await v.store.get(never.documentId))!.status).toBe("pending_upload");

    v.clock.advance(3 * 60 * 60);
    expect(await sweepPendingUploads(v.deps)).toMatchObject({ expired: 1 });
    expect(await v.store.get(never.documentId)).toBeNull();
    expect(v.events.names()).toContain("upload_expired");
  });
});

async function cleanDoc(v: ReturnType<typeof makeVault>, bytes = PDF_BYTES) {
  const m = await uploaded(v, bytes);
  await finalizeDocument(v.deps, m.documentId, { actor: "borrower" });
  // What the scan worker does for a clean verdict.
  await v.storage.move(QUARANTINE_BUCKET, VAULT_BUCKET, m.path);
  await v.store.update(m.documentId, { status: "clean", bucket: VAULT_BUCKET, scanned_at: v.clock.now().toISOString(), sha256: "a".repeat(64) });
  return m;
}

describe("createDownloadLink", () => {
  it("audits first, then issues a short-lived link for a clean document", async () => {
    const v = makeVault();
    const m = await cleanDoc(v);
    const res = await createDownloadLink(v.deps, { documentId: m.documentId, actor: "staff:pat", ipHash: "abc", purpose: "underwriting" });
    expect(res).toMatchObject({ ok: true, fileName: "t12.pdf", expiresInSeconds: 60 });
    expect(v.storage.downloadUrls).toEqual([{ bucket: VAULT_BUCKET, path: m.path, ttlSeconds: 60, downloadName: "t12.pdf" }]);
    expect(v.events.events.at(-1)).toMatchObject({ event: "download", document_id: m.documentId, lead_id: LEAD_ID, actor: "staff:pat", ip_hash: "abc", detail: { kind: "T12", purpose: "underwriting" } });
  });

  it("refuses every non-clean status and audits the refusal", async () => {
    const v = makeVault();
    const m = await uploaded(v, PDF_BYTES);
    expect(await createDownloadLink(v.deps, { documentId: m.documentId, actor: "staff:pat" })).toMatchObject({ ok: false, status: 409, code: "not_available" });
    await finalizeDocument(v.deps, m.documentId, { actor: "borrower" });
    expect(await createDownloadLink(v.deps, { documentId: m.documentId, actor: "staff:pat" })).toMatchObject({ ok: false, code: "not_available" });
    for (const status of ["infected", "rejected", "scan_failed"] as const) {
      await v.store.update(m.documentId, { status });
      expect(await createDownloadLink(v.deps, { documentId: m.documentId, actor: "staff:pat" })).toMatchObject({ ok: false, code: "not_available" });
    }
    expect(await createDownloadLink(v.deps, { documentId: "00000000-0000-4000-8000-000000000000", actor: "staff:pat" })).toMatchObject({ ok: false, status: 404 });
    expect(v.events.names().filter((n) => n === "download_denied")).toHaveLength(6);
    expect(v.events.names()).not.toContain("download");
    expect(v.storage.downloadUrls).toHaveLength(0);
  });

  it("fails closed when the audit trail cannot be written", async () => {
    const v = makeVault();
    const m = await cleanDoc(v);
    vi.spyOn(console, "error").mockImplementation(() => {});
    v.events.failWith = "audit table unavailable";
    expect(await createDownloadLink(v.deps, { documentId: m.documentId, actor: "staff:pat" })).toMatchObject({ ok: false, status: 503, code: "audit_unavailable" });
    expect(v.storage.downloadUrls).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe("deleteDocument", () => {
  it("removes the stored file (whichever bucket) and then the row, and audits it", async () => {
    const v = makeVault();
    const clean = await cleanDoc(v);
    const pending = await uploaded(v, PDF_BYTES);
    expect(await deleteDocument(v.deps, clean.documentId, { actor: "staff:pat", reason: "borrower request" })).toEqual({ ok: true, documentId: clean.documentId });
    expect(await deleteDocument(v.deps, pending.documentId, { actor: "staff:pat" })).toMatchObject({ ok: true });
    expect(v.storage.paths(VAULT_BUCKET)).toEqual([]);
    expect(v.storage.paths(QUARANTINE_BUCKET)).toEqual([]);
    expect(v.store.rows.size).toBe(0);
    expect(v.events.events.filter((e) => e.event === "deleted").map((e) => e.detail)).toEqual([{ status: "clean", reason: "borrower request" }, { status: "pending_upload" }]);
  });

  it("keeps the row when storage deletion fails, so a retry can finish the job", async () => {
    const v = makeVault();
    const m = await cleanDoc(v);
    vi.spyOn(console, "error").mockImplementation(() => {});
    v.storage.failRemoveOn.add(m.path);
    expect(await deleteDocument(v.deps, m.documentId, { actor: "staff:pat" })).toMatchObject({ ok: false, status: 502, code: "storage_error" });
    expect(await v.store.get(m.documentId)).not.toBeNull();
    expect(v.storage.has(VAULT_BUCKET, m.path)).toBe(true);
    v.storage.failRemoveOn.clear();
    expect(await deleteDocument(v.deps, m.documentId, { actor: "staff:pat" })).toMatchObject({ ok: true });
    vi.restoreAllMocks();
  });

  it("never deletes a document under legal hold", async () => {
    const v = makeVault();
    const m = await cleanDoc(v);
    v.store.rows.get(m.documentId)!.legal_hold = true;
    expect(await deleteDocument(v.deps, m.documentId, { actor: "staff:pat" })).toMatchObject({ ok: false, status: 423, code: "legal_hold" });
    expect(v.storage.has(VAULT_BUCKET, m.path)).toBe(true);
    expect(v.events.names()).not.toContain("deleted");
  });

  it("deletes every document of a lead and reports the ones it had to leave", async () => {
    const v = makeVault();
    const a = await cleanDoc(v);
    const b = await cleanDoc(v);
    await cleanDoc(v);
    v.store.rows.get(b.documentId)!.legal_hold = true;
    const report = await deleteLeadDocuments(v.deps, LEAD_ID, { actor: "system", reason: "retention" });
    expect(report.deleted).toBe(2);
    expect(report.blocked).toEqual([{ documentId: b.documentId, code: "legal_hold" }]);
    expect(v.store.rows.has(a.documentId)).toBe(false);
  });
});
