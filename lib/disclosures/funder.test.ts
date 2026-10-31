import { describe, expect, it } from "vitest";
import { funderDocument, reviewFunderDisclosure } from "./funder";
import { sampleFunderInput } from "./test-fixtures";

describe("funder disclosure", () => {
  it("passes review when an independent lender funds through escrow", () => {
    expect(reviewFunderDisclosure(sampleFunderInput)).toEqual({ ok: true, heldForCounsel: false, reasons: [] });
  });

  it.each([
    [{ lenderOfRecord: { name: "Kubera Commercial, Inc.", category: "PRIVATE_NON_EXEMPT" as const } }, /lender of record/],
    [{ beneficiaryName: "Kubera Commercial, Inc." }, /beneficiary/],
    [{ escrowAgent: "Kubera Escrow" }, /independent escrow agent/],
    [{ tableFunded: true, beneficiaryName: "Kubera Commercial, Inc." }, /Table funding/],
  ])("holds for counsel when Kubera is named (%o)", (over, reason) => {
    const r = reviewFunderDisclosure({ ...sampleFunderInput, ...over });
    expect(r.ok).toBe(false);
    expect(r.heldForCounsel).toBe(true);
    expect(r.reasons.join(" ")).toMatch(reason);
  });

  it("refuses to render a disclosure that must be held", () => {
    expect(() => funderDocument({ ...sampleFunderInput, beneficiaryName: "Kubera Commercial" })).toThrow(/held for counsel/);
  });

  it("states the broker-only role and funds flow", () => {
    const doc = funderDocument(sampleFunderInput, { approved: true });
    const text = JSON.stringify(doc);
    expect(text).toContain("It is not the lender");
    expect(text).toContain("does not receive, hold, transfer or disburse loan funds");
    expect(text).toContain("no role in construction draws");
    expect(text).toContain("$42,500.00");
    expect(doc.notice).toEqual([]);
    expect(funderDocument(sampleFunderInput, { approved: false }).notice[0]).toMatch(/DRAFT/);
  });
});
