import { describe, expect, it } from "vitest";
import { decideWithRules } from "@/lib/ai/jev";
import { intakeSchema } from "@/lib/validation";
import { FALLBACK_BENCHMARKS as rates, HUD, SBA } from "./assumptions";
import { debtConstant, monthlyPayment } from "./finance";
import { pickBestFit, sizeHospitality, sizeMultifamily, sizeSenior } from "./programs";

describe("finance", () => {
  it("matches the standard amortization formula", () => {
    // $1M at 6% over 30 years = $5,995.51/mo.
    expect(monthlyPayment(1_000_000, 6, 30)).toBeCloseTo(5995.51, 1);
  });
  it("treats amortYears 0 as interest-only", () => {
    expect(debtConstant(8, 0)).toBe(0.08);
  });
});

const senior = {
  facilityType: "ASSISTED_LIVING" as const,
  beds: 96,
  occupancyPct: 91,
  loanAmount: 16_800_000,
  noi: 2_100_000,
  value: 24_000_000,
  transaction: "REFINANCE" as const,
  nonRecourseOnly: false,
  green: false,
};

describe("senior living sizer", () => {
  it("never exceeds HUD 232/223(f) leverage or coverage limits", () => {
    const hud = sizeSenior(senior, rates).quotes.find((q) => q.id === "HUD_232_223F")!;
    expect(hud.ltv).toBeLessThanOrEqual(HUD.section232.refi.maxLtv + 1e-9);
    expect(hud.dscr).toBeGreaterThanOrEqual(HUD.section232.refi.minDscr - 0.01);
    expect(hud.annualAudit).toBe(HUD.annualAuditCost);
    expect(hud.annualFee.amount).toBeCloseTo(hud.loanAmount * HUD.section232.refi.annualMip, 0);
  });

  it("shows SBA with no audit cost and a separate guarantee-fee line", () => {
    const sba = sizeSenior({ ...senior, loanAmount: 2_500_000, noi: 420_000, value: 3_200_000, beds: 58 }, rates).quotes.find((q) => q.id.startsWith("SBA_"))!;
    expect(sba.annualAudit).toBe(0);
    expect(sba.annualFee.amount).toBeGreaterThan(0);
    expect(sba.tranches.map((t) => t.label)).toEqual(["Bank 1st lien", "SBA 504 CDC 2nd (25-yr fixed)"]);
  });

  it("marks SBA ineligible when the borrower requires non-recourse", () => {
    const sba = sizeSenior({ ...senior, nonRecourseOnly: true }, rates).quotes.find((q) => q.id.startsWith("SBA_"))!;
    expect(sba.eligible).toBe(false);
  });

  it("does not apply Green MIP to Section 232", () => {
    const hud = sizeSenior({ ...senior, green: true }, rates).quotes.find((q) => q.id === "HUD_232_223F")!;
    expect(hud.annualFee.amount).toBeCloseTo(hud.loanAmount * HUD.section232.refi.annualMip, 0);
  });
});

describe("hospitality sizer", () => {
  const hotel = {
    keys: 110,
    tier: "PREMIUM_FLAG" as const,
    loanAmount: 20_000_000,
    noi: 2_900_000,
    adr: 189,
    occupancyPct: 76,
    pipBudget: 3_000_000,
    value: 22_000_000,
    transaction: "PURCHASE" as const,
    nonRecourseOnly: false,
    green: true,
  };

  it("stacks 7(a) on the 504 when the CDC cap binds, within the combined SBA cap", () => {
    const sba = sizeHospitality(hotel, rates).quotes.find((q) => q.id.startsWith("SBA_"))!;
    expect(sba.id).toBe("SBA_504_PLUS_7A_10M_STACK");
    const cdc = sba.tranches[1]!.amount;
    const sevenA = sba.tranches[2]!.amount;
    expect(cdc).toBeLessThanOrEqual(SBA.cdcCapGreen);
    expect(cdc + sevenA).toBeLessThanOrEqual(SBA.combinedExposureCap);
    expect(sevenA).toBeGreaterThan(0);
    expect(sba.loanAmount).toBeLessThanOrEqual((hotel.value + hotel.pipBudget) * 0.85 + 1);
  });

  it("requires $5M+ for CMBS", () => {
    const cmbs = sizeHospitality({ ...hotel, loanAmount: 4_000_000 }, rates).quotes.find((q) => q.id === "HOSPITALITY_CMBS_NON_RECOURSE")!;
    expect(cmbs.eligible).toBe(false);
  });
});

describe("multifamily sizer", () => {
  it("charges the flat 0.25% MIP on HUD 223(f) whether or not the asset is green", () => {
    const r = sizeMultifamily(
      { assetType: "MULTIFAMILY", units: 120, sqft: 0, loanAmount: 20_000_000, noi: 1_700_000, value: 29_000_000, transaction: "REFINANCE", affordable: false, green: true },
      rates,
    );
    const hud = r.quotes.find((q) => q.id === "HUD_221D4_223F_MULTIFAMILY")!;
    expect(hud.annualFee.amount).toBeCloseTo(hud.loanAmount * HUD.multifamily.mip.annual, 0);
    expect(hud.annualFee.label).not.toMatch(/Green/);
  });

  it("keeps HUD and agency off commercial assets", () => {
    const r = sizeMultifamily(
      { assetType: "COMMERCIAL", units: 0, sqft: 40_000, loanAmount: 6_000_000, noi: 620_000, value: 9_000_000, transaction: "PURCHASE", affordable: false, green: false },
      rates,
    );
    expect(r.quotes.filter((q) => q.eligible).map((q) => q.id)).toEqual(["WHITE_LABEL_CRE_BRIDGE"]);
    expect(pickBestFit(r.quotes)).toBe("WHITE_LABEL_CRE_BRIDGE");
  });
});

describe("closing timelines (Global rule 4)", () => {
  it("qualifies every quote's timeline as after a complete file and not guaranteed", () => {
    const seniorTx = ["PURCHASE", "REFINANCE", "NEW_CONSTRUCTION"] as const;
    const hotelTx = ["PURCHASE", "REFINANCE", "CONSTRUCTION"] as const;
    const mfTx = ["PURCHASE", "REFINANCE", "CONSTRUCTION"] as const;
    const quotes = [
      ...seniorTx.flatMap((transaction) => [
        ...sizeSenior({ ...senior, transaction }, rates).quotes,
        ...sizeSenior({ ...senior, transaction, loanAmount: 2_500_000, noi: 420_000, value: 3_200_000, beds: 58, occupancyPct: 72 }, rates).quotes,
      ]),
      ...hotelTx.flatMap(
        (transaction) =>
          sizeHospitality({ keys: 110, tier: "PREMIUM_FLAG", loanAmount: 20_000_000, noi: 2_900_000, adr: 189, occupancyPct: 76, pipBudget: 3_000_000, value: 22_000_000, transaction, nonRecourseOnly: false, green: false }, rates).quotes,
      ),
      ...mfTx.flatMap(
        (transaction) =>
          sizeMultifamily({ assetType: "MULTIFAMILY", units: 120, sqft: 0, loanAmount: 20_000_000, noi: 1_700_000, value: 29_000_000, totalCost: 24_000_000, transaction, affordable: false, green: false }, rates).quotes,
      ),
    ];
    expect(new Set(quotes.map((q) => q.id)).size).toBeGreaterThanOrEqual(8);
    for (const q of quotes) {
      expect(q.closeTimeline, q.id).toMatch(/after a complete file/);
      expect(q.closeTimeline, q.id).toMatch(/not guaranteed/);
    }
  });
});

describe("Jev rules engine", () => {
  const base = intakeSchema.parse({ assetType: "ASSISTED_LIVING", transaction: "REFINANCE", loanAmount: 2_500_000, noi: 420_000, value: 3_200_000, unitCount: 58, occupancyPct: 92 });

  it("routes small care-facility loans to SBA 504 to avoid HUD costs", () => {
    const { decision } = decideWithRules(base);
    expect(decision.primaryProgramFit).toBe("SBA_504_STANDARD");
    expect(decision.sizingOptimizationFlag).toBe("LOAN_UNDER_3_5M_USE_SBA_504_TO_AVOID_HUD_COSTS");
    expect(decision.recommendedWholesaleLenders).toContain("TMC_FINANCING_CDC");
  });

  it("flags low-census facilities for a bridge first", () => {
    const { decision } = decideWithRules({ ...base, loanAmount: 16_800_000, noi: 1_500_000, value: 24_000_000, unitCount: 96, occupancyPct: 72, nonRecourseOnly: true });
    expect(decision.primaryProgramFit).toBe("BRIDGE_TO_HUD_232");
    expect(decision.sizingOptimizationFlag).toBe("NEEDS_STABILIZATION_OR_PIP_BRIDGE_FIRST");
  });

  it("marks large, well-covered deals Tier 1 and calls immediately", () => {
    const { decision } = decideWithRules({ ...base, loanAmount: 18_000_000, noi: 2_400_000, value: 27_000_000, unitCount: 120, timelineDays: 60 });
    expect(decision.leadUrgencyTier).toBe("TIER_1_INSTITUTIONAL_HOT");
    expect(decision.requiresImmediateBrokerCall).toBe(true);
    expect(decision.estimatedBrokerCommissionUsd).toBeGreaterThan(0);
  });

  it("disqualifies requests the income can't support", () => {
    const { decision } = decideWithRules({ ...base, loanAmount: 10_000_000, noi: 150_000, value: 3_000_000 });
    expect(decision.leadUrgencyTier).toBe("UNQUALIFIED");
    expect(decision.estimatedBrokerCommissionUsd).toBe(0);
  });

  it("no longer treats HUD multifamily as a green MIP candidate", () => {
    const mf = intakeSchema.parse({ assetType: "MULTIFAMILY", transaction: "REFINANCE", loanAmount: 20_000_000, noi: 1_700_000, value: 29_000_000, unitCount: 120, occupancyPct: 95, green: true, nonRecourseOnly: true });
    const { decision } = decideWithRules(mf);
    expect(decision.greenMipOrGreen504Candidate).toBe(false);
  });

  it("decides in well under 200ms", () => {
    const t = performance.now();
    for (let i = 0; i < 100; i++) decideWithRules(base);
    expect((performance.now() - t) / 100).toBeLessThan(5);
  });
});
