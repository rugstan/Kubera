import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeDocument } from "@/lib/documents/finalize";
import { createDownloadLink } from "@/lib/documents/lifecycle";
import { mintUpload } from "@/lib/documents/mint";
import { LEAD_ID, PDF_BYTES, TEST_ENV, makeVault } from "@/lib/documents/testing";
import { QUARANTINE_BUCKET, VAULT_BUCKET } from "@/lib/documents/types";
import { EICAR, FakeScanner } from "./fake";
import { scannerFromEnv } from "./index";
import { runScanCycle } from "./worker";

afterEach(() => vi.restoreAllMocks());

async function quarantined(v: ReturnType<typeof makeVault>, bytes: Uint8Array, name = "t12.pdf", contentType = "application/pdf") {
  const m = await mintUpload(v.deps, { leadId: LEAD_ID, kind: "T12", fileName: name, contentType: contentType as "application/pdf", sizeBytes: bytes.byteLength }, TEST_ENV);
  if (!m.ok) throw new Error(m.code);
  v.storage.upload(QUARANTINE_BUCKET, m.path, bytes);
  const f = await finalizeDocument(v.deps, m.documentId, { actor: "borrower" });
  if (!f.ok) throw new Error(`finalize: ${f.code}`);
  return m;
}

// A CSV containing the EICAR test string passes the content sniff (it is plain text), so only
// the scanner can catch it.
const eicarCsv = new TextEncoder().encode(`name,note\nx,${EICAR}\n`);

describe("runScanCycle", () => {
  it("releases a clean document to the vault bucket and makes it downloadable", async () => {
    const v = makeVault();
    const scanner = new FakeScanner();
    const m = await quarantined(v, PDF_BYTES);

    // Before the scan: nothing can be downloaded.
    expect(await createDownloadLink(v.deps, { documentId: m.documentId, actor: "staff:pat" })).toMatchObject({ ok: false, code: "not_available" });

    const report = await runScanCycle(v.deps, scanner);
    expect(report).toMatchObject({ claimed: 1, clean: 1, infected: 0 });
    expect(scanner.calls).toEqual([{ fileName: "t12.pdf", size: PDF_BYTES.byteLength }]);
    expect(await v.store.get(m.documentId)).toMatchObject({
      status: "clean",
      bucket: VAULT_BUCKET,
      scan_engine: "fake",
      sha256: createHash("sha256").update(PDF_BYTES).digest("hex"),
      scan_lease_until: null,
    });
    expect(v.storage.has(VAULT_BUCKET, m.path)).toBe(true);
    expect(v.storage.has(QUARANTINE_BUCKET, m.path)).toBe(false);
    expect(v.events.names()).toContain("scan_clean");
    expect(await createDownloadLink(v.deps, { documentId: m.documentId, actor: "staff:pat" })).toMatchObject({ ok: true });
  });

  it("quarantines an infected (EICAR) file for good: object destroyed, never downloadable", async () => {
    const v = makeVault();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await quarantined(v, eicarCsv, "export.csv", "text/csv");

    const report = await runScanCycle(v.deps, new FakeScanner());
    expect(report).toMatchObject({ claimed: 1, clean: 0, infected: 1 });
    expect(await v.store.get(m.documentId)).toMatchObject({ status: "infected", scan_signature: "Eicar-Test-Signature", bucket: QUARANTINE_BUCKET });
    expect(v.storage.has(QUARANTINE_BUCKET, m.path)).toBe(false);
    expect(v.storage.has(VAULT_BUCKET, m.path)).toBe(false);
    expect(v.events.events.find((e) => e.event === "scan_infected")?.detail).toMatchObject({ signature: "Eicar-Test-Signature" });
    expect(await createDownloadLink(v.deps, { documentId: m.documentId, actor: "staff:pat" })).toMatchObject({ ok: false, code: "not_available" });

    // An infected document is not scanned again.
    expect(await runScanCycle(v.deps, new FakeScanner())).toMatchObject({ claimed: 0 });
  });

  it("keeps documents quarantined when no scanner is configured", async () => {
    const v = makeVault();
    const m = await quarantined(v, PDF_BYTES);
    const report = await runScanCycle(v.deps, null);
    expect(report).toMatchObject({ skipped: "scanner-not-configured", claimed: 0 });
    expect((await v.store.get(m.documentId))!.status).toBe("quarantined");
    expect(v.storage.has(QUARANTINE_BUCKET, m.path)).toBe(true);
  });

  it("retries on scanner errors with backoff, then parks the document as scan_failed", async () => {
    const v = makeVault({ maxScanAttempts: 3 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const scanner = new FakeScanner();
    scanner.failNext = 99;
    const m = await quarantined(v, PDF_BYTES);

    expect(await runScanCycle(v.deps, scanner)).toMatchObject({ claimed: 1, retrying: 1 });
    expect(await v.store.get(m.documentId)).toMatchObject({ status: "quarantined", scan_attempts: 1, scan_error: "simulated scanner outage" });
    // Still inside the backoff window: not claimed again.
    expect(await runScanCycle(v.deps, scanner)).toMatchObject({ claimed: 0 });

    v.clock.advance(61);
    expect(await runScanCycle(v.deps, scanner)).toMatchObject({ claimed: 1, retrying: 1 });
    v.clock.advance(121);
    expect(await runScanCycle(v.deps, scanner)).toMatchObject({ claimed: 1, failed: 1 });
    expect(await v.store.get(m.documentId)).toMatchObject({ status: "scan_failed", scan_attempts: 3 });
    expect(v.storage.has(QUARANTINE_BUCKET, m.path)).toBe(true);
    expect(v.events.names().filter((n) => n === "scan_error")).toHaveLength(2);
    expect(v.events.names()).toContain("scan_failed");

    // The scanner recovers, but a parked document is left for staff review.
    scanner.failNext = 0;
    expect(await runScanCycle(v.deps, scanner)).toMatchObject({ claimed: 0 });
  });

  it("recovers after a scanner outage once the scanner is back", async () => {
    const v = makeVault();
    const scanner = new FakeScanner();
    scanner.failNext = 1;
    const m = await quarantined(v, PDF_BYTES);
    await runScanCycle(v.deps, scanner);
    v.clock.advance(61);
    expect(await runScanCycle(v.deps, scanner)).toMatchObject({ clean: 1 });
    expect((await v.store.get(m.documentId))!.status).toBe("clean");
  });

  it("does not release a file whose move to the vault fails", async () => {
    const v = makeVault();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await quarantined(v, PDF_BYTES);
    v.storage.failMoveOn.add(m.path);
    expect(await runScanCycle(v.deps, new FakeScanner())).toMatchObject({ clean: 0, retrying: 1 });
    expect((await v.store.get(m.documentId))!.status).toBe("quarantined");
    expect(v.storage.has(QUARANTINE_BUCKET, m.path)).toBe(true);
  });

  it("finishes a release that was interrupted after the move", async () => {
    const v = makeVault();
    const m = await quarantined(v, PDF_BYTES);
    await v.storage.move(QUARANTINE_BUCKET, VAULT_BUCKET, m.path); // the move happened, the row update did not
    expect(await runScanCycle(v.deps, new FakeScanner())).toMatchObject({ clean: 1 });
    expect(await v.store.get(m.documentId)).toMatchObject({ status: "clean", bucket: VAULT_BUCKET });
  });

  it("scans documents that predate the vault migration where they are", async () => {
    const v = makeVault();
    v.storage.seed(VAULT_BUCKET, `${LEAD_ID}/T12/legacy.pdf`, PDF_BYTES);
    const legacy = v.store.seedLegacy({ lead_id: LEAD_ID, storage_path: `${LEAD_ID}/T12/legacy.pdf` });
    expect(await createDownloadLink(v.deps, { documentId: legacy.id, actor: "staff:pat" })).toMatchObject({ ok: false });
    expect(await runScanCycle(v.deps, new FakeScanner())).toMatchObject({ clean: 1 });
    expect(await v.store.get(legacy.id)).toMatchObject({ status: "clean", bucket: VAULT_BUCKET });
  });

  it("settles abandoned uploads on every cycle", async () => {
    const v = makeVault();
    const m = await mintUpload(v.deps, { leadId: LEAD_ID, kind: "T12", fileName: "t12.pdf", contentType: "application/pdf", sizeBytes: PDF_BYTES.byteLength }, TEST_ENV);
    if (!m.ok) throw new Error();
    v.storage.upload(QUARANTINE_BUCKET, m.path, PDF_BYTES); // browser never called finalize
    v.clock.advance(60);
    const report = await runScanCycle(v.deps, new FakeScanner());
    expect(report.sweep).toMatchObject({ finalized: 1 });
    expect(report).toMatchObject({ claimed: 1, clean: 1 });
  });
});

describe("scannerFromEnv", () => {
  it("is null (with one warning) when nothing is configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(scannerFromEnv({})).toBeNull();
    expect(scannerFromEnv({})).toBeNull();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("selects ClamAV when its URL is set and the fake only outside production", () => {
    expect(scannerFromEnv({ CLAMAV_REST_URL: "https://clamav.internal:9000" })?.name).toBe("clamav-rest");
    expect(scannerFromEnv({ SCANNER_PROVIDER: "fake" })?.name).toBe("fake");
    expect(() => scannerFromEnv({ SCANNER_PROVIDER: "fake", NODE_ENV: "production", VERCEL_ENV: "production" })).toThrow(/not allowed in production/);
  });
});
