import { describe, expect, it } from "vitest";
import type { CreditBox } from "@/lib/agents/lenders/types";
import { lenderInput, toPanelEntry } from "../test-fixtures";
import type { NewLender } from "../types";
import { assetClassFor, lenderFit, submissionDealProfile, tailorDealFrom, type TailorDeal } from "./tailor";
import { stubSubmissionMetrics } from "./test-metrics";
import { submissionFixture } from "./test-fixtures";

const bridge = () => {
  const ctx = submissionFixture("bridge");
  return { ctx, deal: tailorDealFrom(ctx), metrics: stubSubmissionMetrics(ctx).metrics };
};
const lender = (over: Partial<NewLender> = {}) => toPanelEntry(lenderInput({ programs: ["PRIVATE_BRIDGE"], loanTypes: ["bridge"], minLoanCents: 200_000_000, maxLoanCents: 2_500_000_000, states: ["CA", "AZ"], assetTypes: ["multifamily"], verifiedAt: "2026-10-01T00:00:00.000Z", ...over }), "lender-1");

const box = (over: Partial<CreditBox> = {}): CreditBox => ({
  id: "box-1",
  lenderId: "lender-1",
  partnerId: null,
  label: "Bridge",
  programs: ["PRIVATE_BRIDGE"],
  assetClasses: ["MULTIFAMILY"],
  states: [],
  minLoanCents: 200_000_000,
  maxLoanCents: 2_500_000_000,
  maxLtvPct: 75,
  maxLtcPct: 80,
  minDscr: 0.9,
  minDebtYieldPct: 8,
  lienPositions: ["first"],
  recourse: "non_recourse",
  maxTermMonths: 36,
  maxAmortizationMonths: null,
  maxIoMonths: null,
  rateMinPct: null,
  rateMaxPct: null,
  originationFeePct: null,
  brokerCompensationPct: null,
  typicalCloseDays: 30,
  franchiseRequirements: null,
  notes: null,
  source: "staff",
  status: "approved",
  verifiedAt: "2026-10-20T00:00:00.000Z",
  verifiedBy: "broker:ana",
  reviewedAt: "2026-10-20T00:00:00.000Z",
  reviewedBy: "broker:ana",
  reviewNote: null,
  recordVersion: 1,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  updatedBy: null,
  ...over,
});

describe("lenderFit", () => {
  it("lists what fits a lender's recorded appetite", () => {
    const { deal, metrics } = bridge();
    const fit = lenderFit(lender(), [box()], deal, metrics);
    expect(fit.lenderId).toBe("lender-1");
    expect(fit.matches).toEqual(expect.arrayContaining(["Bridge", "$2M–$25M covers $8.4M", "Lends in CA", "Lends on multifamily", "LTV 68% within your 75% maximum", "DSCR 0.96x meets your 0.90x minimum", "Debt yield 9.1% meets your 8% minimum", "LTC 59.6% within your 80% maximum"]));
    expect(fit.exceptions).toEqual([]);
    expect(fit.staleness.stale).toBe(false);
    expect(fit.score).toBeGreaterThan(0);
  });

  it("states each fact outside the box plainly", () => {
    const { deal, metrics } = bridge();
    const fit = lenderFit(lender({ loanTypes: ["construction"], minLoanCents: 1_000_000_000, states: ["AZ"], assetTypes: ["senior_housing"] }), [box({ maxLtvPct: 65, minDscr: 1.25, lienPositions: ["second"], recourse: "full", maxTermMonths: 12, typicalCloseDays: 90 })], deal, metrics);
    expect(fit.exceptions).toEqual([
      "Bridge is not among your recorded loan types (Construction)",
      "$8.4M is below your $10M minimum",
      "CA is outside your recorded states (AZ)",
      "Multifamily is not among your recorded asset types (senior housing)",
      "LTV 68% vs 65% maximum",
      "DSCR 0.96x vs 1.25x minimum",
      "Non-recourse requested; this credit box is full recourse",
      "First lien requested; this credit box lends second lien",
      "24-month term vs 12-month maximum",
      "Target close in 56 days vs your typical 90",
    ]);
  });

  it("names the dimensions the lender has not recorded", () => {
    const { deal, metrics } = bridge();
    const fit = lenderFit(lender({ loanTypes: [], minLoanCents: null, maxLoanCents: null, states: [], assetTypes: [] }), [], deal, metrics);
    expect(fit.unknown).toEqual(["loan types", "loan size range", "asset types", "credit box (leverage and coverage limits)"]);
    expect(fit.matches).toEqual(["Lends nationwide"]);
    expect(fit.score).toBeNull();
    const partial = lenderFit(lender(), [box({ maxLtvPct: null, minDscr: null })], deal, metrics);
    expect(partial.unknown).toEqual(["maximum LTV", "minimum DSCR"]);
  });

  it("reads only the lender's own approved boxes for the program, and reports the best one", () => {
    const { deal, metrics } = bridge();
    const others = [box({ id: "b-other", lenderId: "someone-else", maxLtvPct: 10 }), box({ id: "b-pending", status: "pending_review", maxLtvPct: 10 }), box({ id: "b-hotel", programs: ["HOTEL_CMBS"], maxLtvPct: 10 })];
    expect(lenderFit(lender(), others, deal, metrics).unknown).toContain("credit box (leverage and coverage limits)");
    const fit = lenderFit(lender(), [box({ id: "b-tight", maxLtvPct: 60 }), box({ id: "b-loose", maxLtvPct: 80 })], deal, metrics);
    expect(fit.exceptions).toEqual([]);
    expect(fit.matches).toContain("LTV 68% within your 80% maximum");
  });

  it("flags a stale lender", () => {
    const { deal, metrics } = bridge();
    expect(lenderFit(lender({ verifiedAt: "2025-01-01T00:00:00.000Z" }), [], deal, metrics).staleness.stale).toBe(true);
  });

  it("reads deal facts only: the input type carries nothing personal", () => {
    const { ctx } = bridge();
    const deal: TailorDeal = tailorDealFrom(ctx);
    expect(Object.keys(deal).sort()).toEqual(["assetType", "dealId", "franchise", "lienPosition", "loanAmountCents", "now", "playbook", "program", "propertyState", "recourse", "requestedTermMonths", "targetCloseDate"]);
    // Changing every principal and sponsor fact changes nothing.
    const before = lenderFit(lender(), [box()], deal, stubSubmissionMetrics(ctx).metrics);
    ctx.principals = [];
    ctx.sponsor = null;
    expect(lenderFit(lender(), [box()], tailorDealFrom(ctx), stubSubmissionMetrics(ctx).metrics)).toEqual(before);
  });

  it("builds the matcher profile from computed metrics", () => {
    const { deal, metrics } = bridge();
    const profile = submissionDealProfile(deal, metrics);
    expect(profile).toMatchObject({ program: "PRIVATE_BRIDGE", assetClass: "MULTIFAMILY", lienPosition: "first", requiresNonRecourse: true, targetCloseDays: 56 });
    expect(profile.ltvPct).toBeCloseTo(68.02, 1);
    expect(assetClassFor("construction", "MULTIFAMILY")).toBe("CONSTRUCTION");
    expect(assetClassFor("hud_232", "ASSISTED_LIVING")).toBe("SENIOR_LIVING");
    expect(assetClassFor("hotel_cmbs", "HOTEL_FLAGGED")).toBe("HOSPITALITY");
  });
});
