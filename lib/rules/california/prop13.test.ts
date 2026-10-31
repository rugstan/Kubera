import { describe, expect, it } from "vitest";
import { estimateReassessment, fiscalYearOf, monthsRemainingInFiscalYear } from "./prop13";

const deal = { purchasePrice: 5_000_000, currentAssessedValue: 2_450_000, totalLevyRatePct: 1.2, eventDate: "2026-10-15" };

describe("fiscal year helpers", () => {
  it("labels the July-June fiscal year", () => {
    expect(fiscalYearOf("2026-10-15")).toBe("2026-27");
    expect(fiscalYearOf("2027-03-10")).toBe("2026-27");
    expect(fiscalYearOf("2027-07-01")).toBe("2027-28");
    expect(fiscalYearOf("2099-12-31")).toBe("2099-00");
  });

  it("counts whole months from the month after the event through June", () => {
    expect(monthsRemainingInFiscalYear("2026-10-15")).toBe(8);
    expect(monthsRemainingInFiscalYear("2026-12-31")).toBe(6);
    expect(monthsRemainingInFiscalYear("2027-03-10")).toBe(3);
    expect(monthsRemainingInFiscalYear("2027-06-15")).toBe(0);
    expect(monthsRemainingInFiscalYear("2026-07-01")).toBe(11);
  });
});

describe("estimateReassessment", () => {
  it("resets the assessed value to the price and recomputes the tax", () => {
    const r = estimateReassessment(deal);
    expect(r).toMatchObject({
      reassessed: true,
      assessedValueBefore: 2_450_000,
      assessedValueAfter: 5_000_000,
      assessedValueIncrease: 2_550_000,
      annualTaxBefore: 29_400,
      annualTaxAfter: 60_000,
      annualTaxIncrease: 30_600,
      totalLevyRatePct: 1.2,
    });
  });

  it("bills one prorated supplemental for a fall closing", () => {
    const r = estimateReassessment(deal);
    expect(r.supplementalBills).toEqual([{ fiscalYear: "2026-27", months: 8, amount: 20_400 }]);
    expect(r.supplementalTotal).toBe(20_400);
  });

  it("bills two supplementals for a closing between January and May", () => {
    const r = estimateReassessment({ ...deal, eventDate: "2027-03-10" });
    expect(r.supplementalBills).toEqual([
      { fiscalYear: "2026-27", months: 3, amount: 7_650 },
      { fiscalYear: "2027-28", months: 12, amount: 30_600 },
    ]);
    expect(r.flags.map((f) => f.code)).toContain("two_supplemental_bills");
  });

  it("bills one full-year supplemental for a June closing", () => {
    const r = estimateReassessment({ ...deal, eventDate: "2027-06-15" });
    expect(r.supplementalBills).toEqual([{ fiscalYear: "2027-28", months: 12, amount: 30_600 }]);
    expect(r.flags.map((f) => f.code)).not.toContain("two_supplemental_bills");
  });

  it("projects the first full fiscal year at the new value, then grows by 2%", () => {
    const r = estimateReassessment({ ...deal, projectionYears: 3 });
    expect(r.projection).toEqual([
      { fiscalYear: "2027-28", assessedValue: 5_000_000, annualTax: 60_000 },
      { fiscalYear: "2028-29", assessedValue: 5_100_000, annualTax: 61_200 },
      { fiscalYear: "2029-30", assessedValue: 5_202_000, annualTax: 62_424 },
    ]);
  });

  it("caps assumed growth at the Prop 13 maximum", () => {
    const r = estimateReassessment({ ...deal, annualIncreasePct: 7, projectionYears: 2 });
    expect(r.projection[1]!.assessedValue).toBe(5_100_000);
    const slower = estimateReassessment({ ...deal, annualIncreasePct: 1, projectionYears: 2 });
    expect(slower.projection[1]!.assessedValue).toBe(5_050_000);
  });

  it("excludes personal property from the new base and adds special assessments flat", () => {
    const r = estimateReassessment({ ...deal, purchasePrice: 5_200_000, nonRealPropertyValue: 200_000, specialAssessmentsAnnual: 4_000 });
    expect(r.assessedValueAfter).toBe(5_000_000);
    expect(r.annualTaxAfter).toBe(64_000);
    expect(r.annualTaxBefore).toBe(33_400);
    expect(r.projection[0]!.annualTax).toBe(64_000);
  });

  it("does nothing when ownership does not change", () => {
    const r = estimateReassessment({ ...deal, changeOfOwnership: "none" });
    expect(r).toMatchObject({ reassessed: false, assessedValueAfter: 2_450_000, annualTaxIncrease: 0, supplementalTotal: 0 });
    expect(r.flags.map((f) => f.code)).toContain("no_reassessment");
  });

  it("reassesses the whole property when more than half of an entity changes hands, a share otherwise", () => {
    const majority = estimateReassessment({ ...deal, changeOfOwnership: "legal_entity_transfer", percentTransferred: 60 });
    expect(majority.assessedValueAfter).toBe(5_000_000);
    const minority = estimateReassessment({ ...deal, changeOfOwnership: "legal_entity_transfer", percentTransferred: 30 });
    expect(minority.assessedValueAfter).toBe(3_215_000);
    expect(minority.flags.map((f) => f.code)).toContain("legal_entity_transfer_review");
    expect(estimateReassessment({ ...deal, changeOfOwnership: "legal_entity_transfer", percentTransferred: 0 }).reassessed).toBe(false);
  });

  it("never lowers taxes through a supplemental and flags a price below the assessment", () => {
    const r = estimateReassessment({ ...deal, purchasePrice: 2_000_000 });
    expect(r.assessedValueAfter).toBe(2_000_000);
    expect(r.supplementalBills).toEqual([]);
    expect(r.flags.map((f) => f.code)).toContain("assessed_above_price");
  });

  it("defaults the levy rate with a flag and records the assumptions", () => {
    const { totalLevyRatePct: _omit, ...noRate } = deal;
    const r = estimateReassessment(noRate);
    expect(r.totalLevyRatePct).toBe(1.2);
    expect(r.flags.map((f) => f.code)).toContain("default_levy_rate_used");
    expect(r.assumptions.length).toBeGreaterThan(2);
  });

  it("always notes that family exclusions do not apply to investment property", () => {
    expect(estimateReassessment(deal).flags.map((f) => f.code)).toContain("parent_child_exclusion_not_applicable");
  });

  it("rejects impossible inputs", () => {
    expect(() => estimateReassessment({ ...deal, purchasePrice: 0 })).toThrow(RangeError);
    expect(() => estimateReassessment({ ...deal, currentAssessedValue: -1 })).toThrow(RangeError);
    expect(() => estimateReassessment({ ...deal, totalLevyRatePct: 9 })).toThrow(RangeError);
    expect(() => estimateReassessment({ ...deal, eventDate: "soon" })).toThrow(RangeError);
  });
});
