// Construction boxes: three hand-built term sheets (one per lender channel),
// then the interest-reserve solve, budget rules and the capital stack.
// Benchmarks: SOFR 4.00%, 5-yr 4.00%, 10-yr 4.25% (agency take-out 5.90%).

import { describe, expect, it } from "vitest";
import { debtConstant } from "../finance";
import { CONSTRUCTION } from "./assumptions";
import { constructionBreakdown, constructionBudget, sizeConstruction, solveLoanWithinLtc, type ConstructionInputs } from "./construction";
import { TEST_RATES as rates, quoteOf } from "./test-helpers";

const mf: ConstructionInputs = {
  assetType: "MULTIFAMILY",
  units: 80,
  landCost: 3_000_000,
  hardCosts: 14_000_000,
  softCosts: 2_500_000,
  contingencyPct: 0.05,
  developerFeePct: 0.03,
  gmpContract: true,
  constructionMonths: 18,
  leaseUpMonths: 6,
  stabilizedNoi: 1_650_000,
  asCompletedValue: 27_500_000,
  loanAmount: 15_000_000,
  completedProjects: 5,
  mezzTargetLtc: 0,
  prefTargetLtc: 0,
  cpaceAmount: 0,
  takeout: "AGENCY",
};

describe("construction term sheet 1 — bank loan, LTC binds with the reserve inside", () => {
  // Budget: 3.0M land + 14.0M hard + 2.5M soft + 5% contingency 700,000 + 3% developer fee 495,000 = 20,695,000.
  // Bank: SOFR 4.00 + 3.125 = 7.125%, 65% LTC / 65% LTV, 0.75 points, 35,000 fees.
  // Reserve factor 7.125% × (0.55 × 18 + 6) / 12 = 0.0944063; cost per loan dollar c = 0.0075 + 0.01 + 0.0944063.
  // LTC fixed point 0.65 × 20,730,000 / (1 − 0.65 c) = 14,531,508 < request 15,000,000  →  14,531,000.
  const b = constructionBreakdown(mf, "BANK", rates);

  it("solves the commitment against a cost that includes its own reserve", () => {
    expect(constructionBudget(mf).baseCost).toBe(20_695_000);
    expect(b.ratePct).toBeCloseTo(7.125, 10);
    expect(b.loanAmount).toBe(14_531_000);
    expect(b.binding).toBe("LTC");
    expect(b.interestReserve).toBeCloseTo(1_371_817.22, 2);
    expect(b.totalCost).toBeCloseTo(22_356_109.72, 2);
    expect(b.ltc).toBeLessThanOrEqual(0.65);
    expect(b.ltc).toBeGreaterThan(0.6499);
  });

  it("builds a senior + common equity stack and passes the agency take-out", () => {
    expect(b.stack.layers.map((l) => l.kind)).toEqual(["SENIOR", "COMMON_EQUITY"]);
    expect(b.stack.layers[1]?.amount).toBeCloseTo(7_825_109.72, 2);
    expect(b.stack.layers[1]?.cumulativePct).toBeCloseTo(1, 10);
    // Agency take-out: min(80% × 27.5M, 1.65M / 1.25 / constant(5.90%, 30)) = 18,545,478.
    expect(b.takeout.proceeds).toBeCloseTo(18_545_477.95, 1);
    expect(b.takeout.result).toBe("PASS");
    expect(b.termMonths).toBe(30);
  });
});

describe("construction term sheet 2 — debt fund, DSCR binds, mezzanine to 80%", () => {
  const i: ConstructionInputs = { ...mf, loanAmount: 16_000_000, completedProjects: 2, mezzTargetLtc: 0.8 };
  // Debt fund, emerging sponsor: SOFR 4.00 + 4.75 + 0.25 = 9.00%, 67.5% LTC / LTV, 1.15x at stabilization.
  // DSCR cap 1,650,000 / 1.15 / constant(9.00%, 30) = 14,859,788 < LTC fixed point 15,484,446  →  14,859,000.
  const b = constructionBreakdown(i, "DEBT_FUND", rates);

  it("sizes on coverage at stabilization", () => {
    expect(b.tier).toBe("EMERGING");
    expect(b.ratePct).toBeCloseTo(9, 10);
    expect(b.maxLtc).toBeCloseTo(0.675, 10);
    expect(b.loanAmount).toBe(14_859_000);
    expect(b.binding).toBe("DSCR");
    // Reserve 9% × 1.325 = 0.11925 of the loan; total cost 20,695,000 + 50,000 + 0.14175 × 14,859,000.
    expect(b.interestReserve).toBeCloseTo(1_771_935.75, 2);
    expect(b.totalCost).toBeCloseTo(22_851_263.25, 2);
  });

  it("fills mezzanine to 80% combined LTC, flags the equity pledge and still passes the take-out", () => {
    const mezz = b.stack.layers.find((l) => l.kind === "MEZZANINE");
    expect(mezz?.amount).toBeCloseTo(3_422_010.6, 1);
    expect(mezz?.cumulativePct).toBeCloseTo(0.8, 10);
    expect(mezz?.flags).toContain("usury_exemption_unavailable");
    expect(b.stack.layers.at(-1)?.amount).toBeCloseTo(4_570_252.65, 1);
    // Payoff senior + mezz = 18,281,011 ≤ agency take-out 18,545,478.
    expect(b.takeout.payoff).toBeCloseTo(18_281_010.6, 1);
    expect(b.takeout.result).toBe("PASS");
    expect(b.takeout.permDscr).toBeCloseTo(1.2681, 4);
  });
});

describe("construction term sheet 3 — private lender on industrial, as-completed value binds, take-out short", () => {
  const i: ConstructionInputs = {
    assetType: "COMMERCIAL",
    units: 0,
    landCost: 1_500_000,
    hardCosts: 6_000_000,
    softCosts: 1_000_000,
    contingencyPct: 0.05,
    developerFeePct: 0.06,
    gmpContract: false,
    constructionMonths: 12,
    leaseUpMonths: 6,
    stabilizedNoi: 780_000,
    loanAmount: 8_000_000,
    completedProjects: 0,
    mezzTargetLtc: 0,
    prefTargetLtc: 0.9,
    cpaceAmount: 1_200_000,
    takeout: "BANK_PERM",
  };
  // Budget: contingency raised to 10% without a GMP (600,000), developer fee capped at 5% of 7.0M (350,000);
  // base 9,450,000. Value 780,000 / 7.25% = 10,758,621.
  // Private, first project: 11.50 + 0.50 = 12.00% fixed, 82.5% LTC, 67.5% as-completed LTV.
  // As-completed cap 0.675 × 10,758,621 = 7,262,069 < LTC fixed point 9,004,670  →  7,262,000.
  const budget = constructionBudget(i);
  const b = constructionBreakdown(i, "PRIVATE", rates);

  it("applies the lender budget rules", () => {
    expect(budget.contingency).toBeCloseTo(600_000, 6);
    expect(budget.developerFee).toBeCloseTo(350_000, 6);
    expect(budget.baseCost).toBeCloseTo(9_450_000, 6);
    expect(budget.adjustments).toHaveLength(2);
    expect(budget.asCompletedValue).toBeCloseTo(10_758_620.69, 2);
  });

  it("sizes on as-completed value", () => {
    expect(b.ratePct).toBe(12);
    expect(b.loanAmount).toBe(7_262_000);
    expect(b.binding).toBe("AS_COMPLETED_LTV");
    // Reserve 12% × (0.55 × 12 + 6) / 12 = 0.126 of the loan = 915,012.
    expect(b.interestReserve).toBeCloseTo(915_012, 6);
    expect(b.totalCost).toBeCloseTo(10_634_182, 6);
  });

  it("stacks C-PACE and preferred equity to 90% and keeps 10% sponsor equity", () => {
    const kinds = b.stack.layers.map((l) => [l.kind, Math.round(l.amount)]);
    expect(kinds).toEqual([
      ["SENIOR", 7_262_000],
      ["C_PACE", 1_200_000],
      ["PREFERRED_EQUITY", 1_108_764],
      ["COMMON_EQUITY", 1_063_418],
    ]);
  });

  it("fails the bank take-out once the C-PACE assessment comes off NOI", () => {
    // Assessment 1.2M × constant(7.5%, 25) = 106,415; take-out (780,000 − 106,415) / 1.25 / constant(6.25%, 25) = 6,807,302.
    expect(b.takeout.proceeds).toBeCloseTo(6_807_301.68, 1);
    expect(b.takeout.shortfall).toBeCloseTo(454_698.32, 1);
    expect(b.takeout.result).toBe("FAIL");
  });
});

describe("construction rules", () => {
  it("fixed-point iteration matches the closed form", () => {
    const args = { staticCap: Infinity, ltc: 0.7, baseCost: 10_000_000, fixedFees: 40_000, costPerDollar: 0.12 };
    const s = solveLoanWithinLtc(args);
    expect(s.loan).toBeCloseTo((0.7 * 10_040_000) / (1 - 0.7 * 0.12), 1);
    expect(s.ltcBinds).toBe(true);
    expect(s.iterations).toBeGreaterThan(2);
    const capped = solveLoanWithinLtc({ ...args, staticCap: 5_000_000 });
    expect(capped.loan).toBe(5_000_000);
    expect(capped.ltcBinds).toBe(false);
  });

  it("keeps the channels inside the researched LTC bands", () => {
    expect(CONSTRUCTION.boxes.BANK.maxLtc).toBeGreaterThanOrEqual(0.6);
    expect(CONSTRUCTION.boxes.BANK.maxLtc).toBeLessThanOrEqual(0.65);
    expect(CONSTRUCTION.boxes.DEBT_FUND.maxLtc).toBeGreaterThanOrEqual(0.65);
    expect(CONSTRUCTION.boxes.DEBT_FUND.maxLtc).toBeLessThanOrEqual(0.75);
    expect(CONSTRUCTION.boxes.PRIVATE.maxLtc).toBeGreaterThanOrEqual(0.85);
    expect(CONSTRUCTION.boxes.PRIVATE.maxLtc).toBeLessThanOrEqual(0.9);
    expect(CONSTRUCTION.boxes.PRIVATE.maxAsCompletedLtv).toBeGreaterThanOrEqual(0.7);
    expect(CONSTRUCTION.boxes.PRIVATE.maxAsCompletedLtv).toBeLessThanOrEqual(0.75);
    expect(CONSTRUCTION.boxes.BANK.spread).toBeGreaterThanOrEqual(2.75);
    expect(CONSTRUCTION.boxes.BANK.spread).toBeLessThanOrEqual(3.5);
    expect(CONSTRUCTION.boxes.DEBT_FUND.spread).toBeGreaterThanOrEqual(4.25);
    expect(CONSTRUCTION.boxes.DEBT_FUND.spread).toBeLessThanOrEqual(5.25);
  });

  it("quotes HUD 221(d)(4) next to the three channels for multifamily and picks the cheapest permanent fit", () => {
    const r = sizeConstruction(mf, rates);
    expect(r.quotes.map((q) => q.id)).toEqual(["HUD_221D4_223F_MULTIFAMILY", "CONSTRUCTION_BANK", "CONSTRUCTION_DEBT_FUND", "CONSTRUCTION_PRIVATE"]);
    expect(r.bestFit).toBe("HUD_221D4_223F_MULTIFAMILY");
    const commercial = sizeConstruction({ ...mf, assetType: "COMMERCIAL" }, rates);
    expect(commercial.quotes.map((q) => q.id)).toEqual(["CONSTRUCTION_BANK", "CONSTRUCTION_DEBT_FUND", "CONSTRUCTION_PRIVATE"]);
    // Interim loans only: the bank's 14,531,000 covers 96.9% of the request and is the cheapest.
    expect(commercial.bestFit).toBe("CONSTRUCTION_BANK");
    // Ask for more than the bank's 65% LTC and the debt fund's 15.48M fixed point wins.
    const bigger = sizeConstruction({ ...mf, assetType: "COMMERCIAL", stabilizedNoi: 1_900_000, loanAmount: 15_400_000 }, rates);
    expect(bigger.bestFit).toBe("CONSTRUCTION_DEBT_FUND");
  });

  it("never lets mezzanine or preferred equity squeeze sponsor equity below 10%", () => {
    const b = constructionBreakdown({ ...mf, mezzTargetLtc: 0.85, prefTargetLtc: 0.9, cpaceAmount: 5_000_000, loanAmount: 30_000_000 }, "PRIVATE", rates);
    const common = b.stack.layers.find((l) => l.kind === "COMMON_EQUITY");
    expect(common?.pctOfCost).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(b.stack.layers.at(-1)?.cumulativePct).toBeCloseTo(1, 10);
  });

  it("tests coverage at the higher of the note and take-out rates", () => {
    const b = constructionBreakdown(mf, "BANK", rates);
    const q = quoteOf(sizeConstruction(mf, rates), "CONSTRUCTION_BANK");
    expect(q.dscr).toBeCloseTo(mf.stabilizedNoi / (b.loanAmount * debtConstant(7.125, 30)), 6);
  });

  it("keeps C-PACE off small multifamily and notes the senior lender's consent", () => {
    const small = constructionBreakdown({ ...mf, units: 4, cpaceAmount: 500_000 }, "BANK", rates);
    expect(small.stack.layers.some((l) => l.kind === "C_PACE")).toBe(false);
    const q = quoteOf(sizeConstruction({ ...mf, cpaceAmount: 500_000 }, rates), "CONSTRUCTION_BANK");
    expect(q.notes.some((n) => /senior lender must consent/.test(n))).toBe(true);
  });

  it("says nothing about draws or funds beyond the lender of record's role", () => {
    const q = quoteOf(sizeConstruction(mf, rates), "CONSTRUCTION_BANK");
    const text = [...q.notes, ...q.warnings, ...(q.terms ?? []).map((t) => t.label)].join(" ");
    expect(text).not.toMatch(/draw request|lien waiver|inspection|disburse/i);
    expect(text).toMatch(/lender of record funds and administers/);
  });
});
