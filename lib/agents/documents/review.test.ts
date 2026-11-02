import { describe, expect, it } from "vitest";
import { loadDocumentEvals, sourceBytes } from "@/evals/documents/load";
import { extractDocument } from "./pipeline";
import { applyCorrections, correctAndApprove, listReviewQueue, rejectExtraction, ReviewError, toResult } from "./review";
import { harness } from "./testing";

const golden = (id: string) => sourceBytes(loadDocumentEvals().suites.flatMap((s) => s.suite.cases).find((c) => c.id === id)!);

async function queued(caseId: string, docType: "PFS" | "CONSTRUCTION_BUDGET") {
  const h = harness({ claudeConfigured: false });
  const src = golden(caseId);
  const out = await extractDocument(h.deps, { source: "manual", bytes: src.bytes, contentType: src.contentType, fileName: src.fileName, docType });
  return { h, rec: out.extraction, review: { store: h.store, events: h.events, budgets: h.budgets } };
}

describe("review queue", () => {
  it("lists what needs a human", async () => {
    const { h, rec } = await queued("pfs-mismatch-xlsx", "PFS");
    expect(rec.status).toBe("needs_review");
    expect((await listReviewQueue(h.store)).map((r) => r.id)).toEqual([rec.id]);
  });

  it("will not approve while figures still disagree", async () => {
    const { rec, review } = await queued("pfs-mismatch-xlsx", "PFS");
    await expect(correctAndApprove(review, rec.id, { reviewer: "analyst@corin" })).rejects.toThrow(/assets_mismatch/);
  });

  it("approves after a correction: reviewer values, events with field names only", async () => {
    const { h, rec, review } = await queued("pfs-mismatch-xlsx", "PFS");
    const approved = await correctAndApprove(review, rec.id, { reviewer: "analyst@corin", corrections: { scalars: { totalAssets: "1,900,000", netWorth: 1_500_000 } }, notes: "Statement total was a typo." });
    expect(approved).toMatchObject({ status: "approved", reviewed_by: "analyst@corin", low_confidence_fields: [] });
    expect(approved.fields.scalars.totalAssets).toMatchObject({ value: 1_900_000, confidence: 1, source: "reviewer" });
    const ev = h.events.events.filter((e) => e.extraction_id === rec.id);
    expect(ev.map((e) => e.event_type)).toEqual(["extracted", "queued_for_review", "corrected", "approved"]);
    expect(ev[2]!.detail).toEqual({ fields: ["totalAssets", "netWorth"] });
    expect(JSON.stringify(ev)).not.toContain("1900000");
    await expect(correctAndApprove(review, rec.id, { reviewer: "b" })).rejects.toMatchObject({ code: "not_reviewable" });
  });

  it("validates corrections and requires the required fields", async () => {
    const { rec, review } = await queued("pfs-mismatch-xlsx", "PFS");
    await expect(correctAndApprove(review, rec.id, { reviewer: "a", corrections: { scalars: { bogus: 1 } } })).rejects.toThrow(/unknown field/);
    await expect(correctAndApprove(review, rec.id, { reviewer: "a", corrections: { scalars: { totalAssets: "lots" } } })).rejects.toThrow(/invalid value/);
    await expect(correctAndApprove(review, rec.id, { reviewer: "a", corrections: { scalars: { asOfDate: null, totalAssets: 1_900_000 } } })).rejects.toMatchObject({ code: "required_missing" });
    await expect(correctAndApprove(review, rec.id, { reviewer: " " })).rejects.toBeInstanceOf(ReviewError);
  });

  it("edits, drops and adds budget lines, then updates the construction budget row", async () => {
    const { h, rec, review } = await queued("budget-pip-pdf", "CONSTRUCTION_BUDGET");
    expect(rec.status).toBe("needs_review");
    const preview = applyCorrections(toResult(rec), { rows: [{ index: 1, values: { category: "Hard" } }], removeRows: [3], addRows: [{ description: "Design fees", category: "soft", amount: "150,000" }] });
    expect(preview.changed).toEqual(["lineItems[1]", "lineItems:removed:1", "lineItems:added"]);
    expect(preview.result.rows).toHaveLength(5);
    const approved = await correctAndApprove(review, rec.id, { reviewer: "analyst@corin", corrections: { rows: [{ index: 1, values: { category: "hard" } }] } });
    expect(approved.status).toBe("approved");
    expect((await h.budgets.get(rec.id))?.status).toBe("approved");
  });

  it("rejects with a reason", async () => {
    const { h, rec, review } = await queued("pfs-mismatch-xlsx", "PFS");
    await expect(rejectExtraction(review, rec.id, { reviewer: "a", reason: "" })).rejects.toBeInstanceOf(ReviewError);
    const r = await rejectExtraction(review, rec.id, { reviewer: "a", reason: "Wrong borrower's statement." });
    expect(r).toMatchObject({ status: "rejected", review_notes: "Wrong borrower's statement." });
    expect(await listReviewQueue(h.store)).toEqual([]);
  });
});
