import { describe, expect, it } from "vitest";
import { DEAL_SUMMARY_KIND, PackageCopyError, checkSummaryCopy, dealSummaryPackageItem, defaultAssetClass, sha256Hex, summaryStoragePath } from "./package";

// The deal summary itself (spec, PDF bytes, determinism) is tested in
// lib/deals/submission/summary.test.ts; these are the shared package helpers.

describe("summary copy rules", () => {
  it("blocks overclaiming copy", () => {
    for (const bad of ["Loan is approved by the lender", "Borrower qualifies for HUD", "Guaranteed closing in 30 days", "This loan is usury-exempt", "We will close within 21 days", "Fees protected"]) {
      expect(() => checkSummaryCopy([bad])).toThrow(PackageCopyError);
    }
    expect(() => checkSummaryCopy(["Many close in 10–21 days after a complete file, subject to lender review; not guaranteed."])).not.toThrow();
    expect(() => checkSummaryCopy(["Lender review is pending."])).not.toThrow();
  });

  it("defaults the asset class from the program", () => {
    expect(defaultAssetClass("HOTEL_CMBS")).toBe("HOSPITALITY");
    expect(defaultAssetClass("SBA_7A")).toBeNull();
  });
});

describe("the deal summary's manifest entry", () => {
  it("is content-addressed: the same bytes give the same path and document id", () => {
    const sha = sha256Hex(new TextEncoder().encode("summary bytes"));
    const item = dealSummaryPackageItem("d1", sha);
    expect(item).toEqual({ documentId: `deal-summary-${sha.slice(0, 24)}`, label: "Deal summary (Corin)", kind: DEAL_SUMMARY_KIND, storagePath: `packages/d1/deal-summary-${sha.slice(0, 16)}.pdf`, sha256: sha });
    expect(summaryStoragePath("d1", sha)).toBe(item.storagePath);
    expect(item.documentId.length).toBeLessThanOrEqual(100);
  });
});
