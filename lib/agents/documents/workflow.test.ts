import { describe, expect, it } from "vitest";
import { loadDocumentEvals, sourceBytes } from "@/evals/documents/load";
import { harness } from "./testing";
import { DOCUMENT_EVENTS, documentCleanHandler } from "./workflow";

const src = sourceBytes(loadDocumentEvals().suites.flatMap((s) => s.suite.cases).find((c) => c.id === "t12-annual-csv")!);

describe("document.clean workflow handler", () => {
  it("extracts and emits document.extracted", async () => {
    const h = harness();
    const id = await h.addDocument(src.bytes, { kind: "T12", contentType: src.contentType });
    const r = await documentCleanHandler({ documentId: id }, h.deps);
    expect(r.skipped).toBe(false);
    if (r.skipped) return;
    expect(r.emit).toEqual({ name: DOCUMENT_EVENTS.documentExtracted, data: expect.objectContaining({ extractionId: r.outcome.extraction.id, documentId: id, docType: "T12", status: "extracted" }) });
  });

  it("is idempotent per document content; force re-runs", async () => {
    const h = harness();
    const id = await h.addDocument(src.bytes, { kind: "T12", contentType: src.contentType });
    await documentCleanHandler({ documentId: id }, h.deps);
    expect(await documentCleanHandler({ documentId: id }, h.deps)).toEqual({ skipped: true, reason: "already_extracted" });
    expect((await documentCleanHandler({ documentId: id, force: true }, h.deps)).skipped).toBe(false);
    expect(h.store.rows.size).toBe(2);
  });

  it("skips documents that are not clean and rejects bad payloads", async () => {
    const h = harness();
    const id = await h.addDocument(src.bytes, { kind: "T12", status: "quarantined" });
    const r = await documentCleanHandler({ documentId: id }, h.deps);
    expect(r).toMatchObject({ skipped: true });
    await expect(documentCleanHandler({ documentId: "nope" }, h.deps)).rejects.toThrow();
  });
});
