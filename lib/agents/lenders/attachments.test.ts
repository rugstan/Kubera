import { describe, expect, it } from "vitest";
import { INJECTION_WARNING, extractDocument } from "@/lib/agents/documents/pipeline";
import { harness } from "@/lib/agents/documents/testing";
import type { ExtractedField } from "@/lib/agents/documents/types";
import { DOCUMENT_INJECTION_WARNING, extractionFromDocument, mergeTermSheetExtractions, termSheetAttachments, vaultTermSheetAttachments } from "./attachments";
import { parseTermSheetByRules } from "./term-sheet";

const field = (value: ExtractedField["value"], confidence = 0.92): ExtractedField => ({ value, confidence, source: "rules" });

describe("term-sheet attachments", () => {
  it("reports each filed document's scan and extraction state", async () => {
    const h = harness({ claudeConfigured: false });
    const source = vaultTermSheetAttachments({ documents: h.documents, extractions: h.store });
    const quarantined = await h.addDocument(new TextEncoder().encode("Lender,X\n"), { kind: "TERM_SHEET", contentType: "text/csv", status: "quarantined" });
    expect(await source.attachmentState(quarantined)).toEqual({ state: "pending" });
    expect(await source.attachmentState("00000000-0000-4000-8000-00000000dead")).toMatchObject({ state: "unreadable", reason: "document not found" });

    // Clean but unreadable bytes: the document agent records a failed run, which ends the wait.
    const garbage = await h.addDocument(new Uint8Array([0, 1, 2, 3]), { kind: "TERM_SHEET", contentType: "application/octet-stream" });
    expect(await source.attachmentState(garbage)).toEqual({ state: "pending" });
    const out = await extractDocument(h.deps, { source: "vault_document", documentId: garbage });
    expect(out.extraction.status).toBe("failed");
    expect(await source.attachmentState(garbage)).toMatchObject({ state: "unreadable", reason: "extraction failed" });
  });

  it("maps the document agent's TERM_SHEET fields onto quote terms", () => {
    const e = extractionFromDocument({
      lenderName: field("Summit Debt Fund"),
      loanAmount: field(8_000_000),
      interestRatePct: field(8.55),
      rateType: field("Floating"),
      spreadBps: field(425),
      amortizationYears: field(0),
      termMonths: field(24),
      originationFeePct: field(0.01),
      exitFeePct: field(0.005),
      maxLtv: field(0.7, 0.6),
      minDebtYield: field(0.08),
      prepayment: field("6 months minimum interest"),
      recourse: field("Full recourse"),
    });
    expect(e).toMatchObject({ lenderName: "Summit Debt Fund", loanAmount: 8_000_000, ratePct: 8.55, rateType: "floating", interestOnlyFullTerm: true, amortizationMonths: null, originationFeePct: 1, exitFeePct: 0.5, maxLtvPct: 70, minDebtYieldPct: 8, prepayKind: "minimum_interest", prepayMonths: 6, recourse: "full" });
    expect(e.confidence).toMatchObject({ ratePct: 0.92, maxLtvPct: 0.6, termMonths: 0.92, minDscr: 0 });
    expect(extractionFromDocument({ prepayment: field("10-year lockout"), recourse: field("Non-recourse") })).toMatchObject({ prepayKind: "lockout", prepayMonths: 120, recourse: "non_recourse" });
    // Out-of-range values are dropped, as for a parsed email.
    expect(extractionFromDocument({ interestRatePct: field(625) })).toMatchObject({ ratePct: null, confidence: expect.objectContaining({ ratePct: 0 }) });
  });

  it("keeps the better-supported value of the body and the attachment", () => {
    const body = parseTermSheetByRules("Interest rate 6.75%. Processing fee $5,000.");
    const doc = extractionFromDocument({ interestRatePct: field(6.25), termMonths: field(120) });
    const merged = mergeTermSheetExtractions(body, doc);
    expect(merged).toMatchObject({ ratePct: 6.25, termMonths: 120, lenderFees: 5_000 });
    expect(merged.confidence).toMatchObject({ ratePct: 0.92, lenderFees: 0.6 });
  });

  it("reads TERM_SHEET documents from a stored attachments array", () => {
    expect(
      termSheetAttachments([
        { attachmentId: "a", fileName: "terms.pdf", status: "registered", kind: "TERM_SHEET", documentId: "d1" },
        { attachmentId: "b", fileName: "logo.png", status: "stored", kind: null, documentId: null },
        { attachmentId: "c", fileName: "t12.pdf", status: "registered", kind: "T12", documentId: "d2" },
      ]),
    ).toEqual([{ documentId: "d1", fileName: "terms.pdf" }]);
    expect(termSheetAttachments(null)).toEqual([]);
    expect(DOCUMENT_INJECTION_WARNING).toBe(INJECTION_WARNING);
  });
});
