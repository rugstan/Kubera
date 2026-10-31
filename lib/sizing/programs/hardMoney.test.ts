// Hard money box: three hand-built term sheets, then rules.
// Benchmarks are irrelevant to the hard money note (fixed grid rates) and only
// feed the exit tests: 10-yr 4.25%, so the agency take-out rate is 4.25 + 1.65 = 5.90%.

import { describe, expect, it } from "vitest";
import { HARD_MONEY } from "./assumptions";
import { hardMoneyBreakdown, hardMoneyTier, sizeHardMoney, type HardMoneyInputs } from "./hardMoney";
import { TEST_RATES as rates, quoteOf } from "./test-helpers";

const flipExperienced: HardMoneyInputs = {
  strategy: "FIX_AND_FLIP",
  purpose: "PURCHASE",
  propertyType: "RESIDENTIAL_1_4",
  units: 1,
  purchasePrice: 400_000,
  asIsValue: 400_000,
  rehabBudget: 100_000,
  arv: 650_000,
  loanAmount: 500_000,
  completedProjects: 6,
  termMonths: 12,
  holdMonths: 8,
  interestReserveMonths: 0,
  interestBasis: "OUTSTANDING",
};

describe("hard money term sheet 1 — experienced fix-and-flip, LTC binds", () => {
  // Experienced grid: 9.50%, 1 point, 90% of price, 100% of rehab, 90% LTC, 75% LTARV, 3 mo min interest, 0.50% exit.
  // Limits: advance 0.90 × 400,000 + 100,000 = 460,000; LTC 0.90 × 500,000 = 450,000;
  //         LTARV 0.75 × 650,000 = 487,500; request 500,000  →  450,000 (LTC).
  const b = hardMoneyBreakdown(flipExperienced);

  it("sizes the commitment, holdback and initial advance", () => {
    expect(b.tier).toBe("EXPERIENCED");
    expect(b.loanAmount).toBe(450_000);
    expect(b.binding).toBe("LTC");
    expect(b.rehabHoldback).toBe(100_000);
    expect(b.initialAdvance).toBe(350_000);
    expect(b.interestReserve).toBe(0);
  });

  it("prices points, closing costs and interest", () => {
    // Points 4,500 + lender fees 2,500 + third party 7,500 + Kubera 1% 4,500 = 19,000.
    expect(b.points).toBe(4_500);
    expect(b.closingCosts).toBe(19_000);
    // Non-Dutch: average balance 350,000 + 100,000 / 2 = 400,000 × 9.5% × 8/12 = 25,333.33 (> 3-mo minimum 8,312.50).
    expect(b.interestCharged).toBeCloseTo(25_333.33, 2);
    expect(b.minimumInterest).toBeCloseTo(8_312.5, 2);
    expect(b.extensions).toBe(0);
    expect(b.exitFee).toBe(2_250);
  });

  it("computes equity and the sale exit", () => {
    // 400,000 + 100,000 + 19,000 − 350,000 − 100,000.
    expect(b.equityRequired).toBe(69_000);
    // Net sale 650,000 × 0.94 = 611,000; all-in 500,000 + 19,000 + 25,333.33 + 2,250 = 546,583.33.
    expect(b.netSaleProceeds).toBe(611_000);
    expect(b.profit).toBeCloseTo(64_416.67, 2);
    expect(b.returnOnCash).toBeCloseTo(64_416.67 / 94_333.33, 4);
    const q = quoteOf(sizeHardMoney(flipExperienced, rates), "HARD_MONEY");
    // 9.9% of ARV is under the 10% margin lenders like: marginal, not a pass.
    expect(q.exit?.result).toBe("MARGINAL");
    expect(q.ratePct).toBe(9.5);
    expect(q.ltv).toBeCloseTo(0.9, 6);
  });
});

describe("hard money term sheet 2 — first flip with an interest reserve, Dutch interest", () => {
  const i: HardMoneyInputs = {
    ...flipExperienced,
    purchasePrice: 300_000,
    asIsValue: 320_000,
    rehabBudget: 80_000,
    arv: 480_000,
    loanAmount: 400_000,
    completedProjects: 0,
    termMonths: 12,
    holdMonths: 14,
    interestReserveMonths: 6,
    interestBasis: "FULL_COMMITMENT",
  };
  // New-sponsor grid: 12.50%, 3 points, 80% of price, 90% of rehab, 80% LTC, 65% LTARV, 6 mo min, 1% exit, 1.5% extension.
  // Reserve share k = 6 × 12.5% / 12 = 6.25%. Advance (240,000 + 72,000) / 0.9375 = 332,800;
  // LTC 0.80 × 380,000 = 304,000; LTARV 0.65 × 480,000 = 312,000  →  304,000 (LTC).
  const b = hardMoneyBreakdown(i);

  it("carves the reserve and holdback out of the commitment", () => {
    expect(b.tier).toBe("NEW");
    expect(b.loanAmount).toBe(304_000);
    expect(b.binding).toBe("LTC");
    expect(b.interestReserve).toBeCloseTo(19_000, 6);
    expect(b.rehabHoldback).toBe(72_000);
    expect(b.initialAdvance).toBeCloseTo(213_000, 6);
    expect(b.asIsLtv).toBeCloseTo(0.665625, 6);
  });

  it("charges Dutch interest, an extension and the exit fee", () => {
    // Points 9,120 + 2,500 + 7,500 + Kubera 3,040 = 22,160.
    expect(b.closingCosts).toBeCloseTo(22_160, 6);
    // 304,000 × 12.5% × 14/12 = 44,333.33; reserve covers 19,000.
    expect(b.interestCharged).toBeCloseTo(44_333.33, 2);
    expect(b.interestOutOfPocket).toBeCloseTo(25_333.33, 2);
    // 14-month hold on a 12-month term: one 6-month extension at 1.5% = 4,560.
    expect(b.extensions).toBe(1);
    expect(b.extensionFees).toBeCloseTo(4_560, 6);
    expect(b.exitFee).toBeCloseTo(3_040, 6);
    // 300,000 + 80,000 + 22,160 − 213,000 − 72,000.
    expect(b.equityRequired).toBeCloseTo(117_160, 6);
  });

  it("fails the sale exit: the flip loses money after financing costs", () => {
    // 480,000 × 0.94 = 451,200 − (380,000 + 22,160 + 44,333.33 + 4,560 + 3,040) = −2,893.33.
    expect(b.profit).toBeCloseTo(-2_893.33, 2);
    const q = quoteOf(sizeHardMoney(i, rates), "HARD_MONEY");
    expect(q.exit?.result).toBe("FAIL");
    expect(q.warnings.some((w) => /Sale exit fails/.test(w))).toBe(true);
    expect(q.warnings.some((w) => /First-time sponsors/.test(w))).toBe(true);
  });
});

describe("hard money term sheet 3 — value-add bridge refinance on 12 units", () => {
  const i: HardMoneyInputs = {
    strategy: "BRIDGE",
    purpose: "REFINANCE",
    propertyType: "MULTIFAMILY",
    units: 12,
    purchasePrice: 2_000_000,
    rehabBudget: 200_000,
    arv: 2_600_000,
    loanAmount: 1_900_000,
    completedProjects: 2,
    termMonths: 24,
    holdMonths: 18,
    interestReserveMonths: 0,
    interestBasis: "OUTSTANDING",
    existingPayoff: 1_200_000,
    stabilizedNoi: 210_000,
    fico: 720,
  };
  // Emerging bridge grid: 11.00%, 2 points, 80% of as-is, 100% rehab, 85% LTC, 80% LTARV, 4 mo min, 0.75% exit.
  // Advance 0.80 × 2,000,000 + 200,000 = 1,800,000; LTC 0.85 × 2,200,000 = 1,870,000; LTARV 2,080,000  →  1,800,000.
  const r = sizeHardMoney(i, rates);
  const q = quoteOf(r, "HARD_MONEY");
  const b = hardMoneyBreakdown(i);

  it("sizes on the advance limits and returns cash at closing", () => {
    expect(b.loanAmount).toBe(1_800_000);
    expect(b.binding).toBe("ADVANCE");
    expect(b.initialAdvance).toBe(1_600_000);
    expect(b.rehabHoldback).toBe(200_000);
    // Points 36,000 + 2,500 + 7,500 + Kubera 18,000 = 64,000.
    expect(b.closingCosts).toBe(64_000);
    // 1,600,000 − 1,200,000 payoff − 64,000 costs − (200,000 rehab − 200,000 holdback) = 336,000.
    expect(b.cashOut).toBe(336_000);
    expect(b.equityRequired).toBe(0);
    // Average balance 1,700,000 × 11% × 18/12.
    expect(b.interestCharged).toBeCloseTo(280_500, 6);
  });

  it("passes the bridge exit test on stabilized NOI", () => {
    // Payoff 1,800,000 + 0.75% exit fee = 1,813,500; debt yield 210,000 / 1,813,500 = 11.58%;
    // DSCR at 5.90% / 30-yr = 1.627x.
    expect(q.exit?.kind).toBe("BRIDGE_REFINANCE");
    expect(q.exit?.result).toBe("PASS");
    expect(q.exit?.payoff).toBe(1_813_500);
    expect(q.binding).toBe("ADVANCE");
    // A DSCR 5+ take-out is shown alongside but the hard money loan stays the pick.
    expect(r.quotes.map((x) => x.id)).toEqual(["HARD_MONEY", "DSCR_INVESTOR_5_PLUS"]);
    expect(r.bestFit).toBe("HARD_MONEY");
  });
});

describe("hard money rules", () => {
  it("tiers sponsors by completed projects", () => {
    expect(hardMoneyTier(0)).toBe("NEW");
    expect(hardMoneyTier(1)).toBe("EMERGING");
    expect(hardMoneyTier(4)).toBe("EMERGING");
    expect(hardMoneyTier(5)).toBe("EXPERIENCED");
  });

  it("keeps every grid inside the researched ranges", () => {
    for (const strategy of Object.values(HARD_MONEY.grid)) {
      for (const row of Object.values(strategy)) {
        expect(row.ratePct).toBeGreaterThanOrEqual(9.5);
        expect(row.ratePct).toBeLessThanOrEqual(12.5);
        expect(row.points).toBeGreaterThanOrEqual(1);
        expect(row.points).toBeLessThanOrEqual(4);
        expect(row.minInterestMonths).toBeGreaterThanOrEqual(3);
        expect(row.minInterestMonths).toBeLessThanOrEqual(6);
        expect(row.exitFeePct).toBeGreaterThanOrEqual(0.005);
        expect(row.exitFeePct).toBeLessThanOrEqual(0.01);
        expect(row.extensionFeePct).toBeGreaterThanOrEqual(0.005);
        expect(row.extensionFeePct).toBeLessThanOrEqual(0.02);
      }
    }
    for (const row of Object.values(HARD_MONEY.grid.FIX_AND_FLIP)) {
      expect(row.maxLtarv).toBeGreaterThanOrEqual(0.65);
      expect(row.maxLtarv).toBeLessThanOrEqual(0.75);
    }
    expect(Math.max(...Object.values(HARD_MONEY.grid.BRIDGE).map((r) => r.maxInitialPct))).toBeLessThanOrEqual(0.85);
    expect(HARD_MONEY.defaultRatePct).toBeLessThanOrEqual(24);
  });

  it("never applies the investor-funded §10232.3 limits (no investor desk)", () => {
    expect(HARD_MONEY.investorFundedLtvLimits.applies).toBe(false);
  });

  it("clamps the term to 6–36 months", () => {
    const short = quoteOf(sizeHardMoney({ ...flipExperienced, termMonths: 2 }, rates), "HARD_MONEY");
    expect(short.termLabel).toMatch(/^6 months/);
    const long = quoteOf(sizeHardMoney({ ...flipExperienced, termMonths: 60, holdMonths: 30 }, rates), "HARD_MONEY");
    expect(long.termLabel).toMatch(/^36 months/);
  });

  it("warns when the hold runs past the term and every extension", () => {
    const q = quoteOf(sizeHardMoney({ ...flipExperienced, termMonths: 6, holdMonths: 24 }, rates), "HARD_MONEY");
    expect(q.warnings.some((w) => /runs past the 6 months term/.test(w))).toBe(true);
  });

  it("uses the DSCR refinance as the exit on a 1–4 unit bridge", () => {
    const r = sizeHardMoney(
      { ...flipExperienced, strategy: "BRIDGE", units: 3, rehabBudget: 50_000, arv: 600_000, loanAmount: 400_000, monthlyRent: 5_400, monthlyTaxesInsuranceHoa: 900, fico: 750 },
      rates,
    );
    const q = quoteOf(r, "HARD_MONEY");
    expect(q.exit?.kind).toBe("DSCR_REFINANCE");
    expect(r.quotes.some((x) => x.id === "DSCR_INVESTOR_2_4")).toBe(true);
  });

  it("states the lender of record and the MLDS, and never Kubera funding draws", () => {
    const q = quoteOf(sizeHardMoney(flipExperienced, rates), "HARD_MONEY");
    expect(q.notes.join(" ")).toMatch(/lender of record/);
    expect(q.notes.join(" ")).toMatch(/RE 882/);
    expect(q.notes.join(" ")).toMatch(/Kubera has no role in draws/);
    expect(q.closeTimeline).toMatch(/not guaranteed/);
  });
});
