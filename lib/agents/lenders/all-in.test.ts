import { describe, expect, it } from "vitest";
import { AllInError, DEFEASANCE_TRANSACTION_COST_CENTS, amortizingPayment, compareQuotes, computeAllIn, monthlyIrr } from "./all-in";
import { terms } from "./test-fixtures";

// Closed-form balance after k level payments (independent of the month loop).
const balanceAfter = (p: number, r: number, n: number, k: number) => {
  const a = amortizingPayment(p, r, n);
  return p * (1 + r) ** k - (a * ((1 + r) ** k - 1)) / r;
};

describe("amortization and IRR primitives", () => {
  it("matches the textbook 30-year payment", () => {
    // $1,000,000 at 6% over 360 months = $5,995.51 per month.
    expect(amortizingPayment(100_000_000, 0.06 / 12, 360) / 100).toBeCloseTo(5995.51, 2);
    expect(amortizingPayment(1_200, 0, 12)).toBe(100);
  });

  it("solves the monthly IRR of a simple loan", () => {
    // Borrow 1,000 and repay 1,010 a month later: 1% a month.
    expect(monthlyIrr([1_000, -1_010])!).toBeCloseTo(0.01, 8);
    expect(monthlyIrr([1_000, 100])).toBeNull();
  });
});

describe("computeAllIn", () => {
  it("prices a no-fee fixed loan at its note rate, with the right balloon", () => {
    const r = computeAllIn(terms(), { holdMonths: 120 });
    expect(r.allInRatePct).toBeCloseTo(6, 3);
    expect(r.amortizingPaymentCents! / 100).toBeCloseTo(5995.51, 2);
    expect(r.balanceAtExitCents).toBe(Math.round(balanceAfter(100_000_000, 0.005, 360, 120)));
    expect(r.netProceedsCents).toBe(100_000_000);
    expect(r.stabilizedAnnualDebtServiceCents).toBe(Math.round(amortizingPayment(100_000_000, 0.005, 360) * 12));
    expect(r.prepayCostCents).toBe(0);
  });

  it("adds one point of origination over a one-year interest-only hold (hand model)", () => {
    // Proceeds 990,000; 12 × 5,000 interest; 1,000,000 repaid. Monthly IRR solves
    // 990,000 = 5,000·a(i,12) + 1,000,000·v(i,12) → i = 0.5866% a month, 7.04% nominal
    // (check: v¹² = 0.93222, a = 11.555 → 57,775 + 932,219 = 989,994).
    const r = computeAllIn(terms({ originationFeePct: 1, amortizationMonths: null, ioMonths: 12, termMonths: 12 }), { holdMonths: 12 });
    expect(r.upfrontCostsCents).toBe(1_000_000);
    expect(r.ioPaymentCents).toBe(500_000);
    expect(r.allInRatePct).toBeCloseTo(7.0385, 3);
    expect(r.totalCostCents).toBe(6_000_000 + 1_000_000);
  });

  it("prices a step-down prepayment at the hold year", () => {
    const sched = terms({ prepay: { kind: "step_down", schedule: [5, 4, 3, 2, 1], months: null } });
    const r = computeAllIn(sched, { holdMonths: 30 });
    expect(r.exitMonth).toBe(30);
    expect(r.prepayCostCents).toBe(Math.round(balanceAfter(100_000_000, 0.005, 360, 30) * 0.03));
    expect(r.allInRatePct).toBeGreaterThan(6.9);
    // No premium after year 5.
    expect(computeAllIn(sched, { holdMonths: 72 }).prepayCostCents).toBe(0);
  });

  it("pushes the exit past a lockout and warns", () => {
    const r = computeAllIn(terms({ prepay: { kind: "lockout", schedule: [], months: 36 } }), { holdMonths: 24 });
    expect(r.exitMonth).toBe(36);
    expect(r.warnings.join(" ")).toMatch(/locked out for 36 months/);
  });

  it("estimates yield maintenance with a 1% floor and defeasance with costs", () => {
    const ym = terms({ prepay: { kind: "yield_maintenance", schedule: [], months: null } });
    // Reinvestment above the coupon: the floor applies.
    const floor = computeAllIn(ym, { holdMonths: 60, reinvestmentRatePct: 7 });
    expect(floor.prepayCostCents).toBe(Math.round(balanceAfter(100_000_000, 0.005, 360, 60) * 0.01));
    // 2 points of differential over 60 remaining months: PV well above the floor.
    const priced = computeAllIn(ym, { holdMonths: 60, reinvestmentRatePct: 4 });
    expect(priced.prepayCostCents).toBeGreaterThan(floor.prepayCostCents * 5);
    const def = computeAllIn(terms({ prepay: { kind: "defeasance", schedule: [], months: null } }), { holdMonths: 60, reinvestmentRatePct: 7 });
    expect(def.prepayCostCents).toBe(DEFEASANCE_TRANSACTION_COST_CENTS);
  });

  it("charges minimum interest only before the minimum period ends", () => {
    const mi = terms({ amortizationMonths: null, ioMonths: 12, termMonths: 12, prepay: { kind: "minimum_interest", schedule: [], months: 6 } });
    expect(computeAllIn(mi, { holdMonths: 4 }).prepayCostCents).toBe(2 * 500_000);
    expect(computeAllIn(mi, { holdMonths: 8 }).prepayCostCents).toBe(0);
  });

  it("adds HUD MIP to the all-in cost", () => {
    const base = computeAllIn(terms({ termMonths: 420, amortizationMonths: 420 }), { holdMonths: 120 });
    const mip = computeAllIn(terms({ termMonths: 420, amortizationMonths: 420, mipUpfrontPct: 0.25, mipAnnualPct: 0.25 }), { holdMonths: 120 });
    expect(mip.upfrontBreakdown.mipUpfront).toBe(250_000);
    expect(mip.totalMipCents).toBeGreaterThan(0);
    expect(mip.allInRatePct - base.allInRatePct).toBeGreaterThan(0.25);
    expect(mip.allInRatePct - base.allInRatePct).toBeLessThan(0.32);
  });

  it("counts lender-required reserves against proceeds and releases them at payoff", () => {
    const r = computeAllIn(terms({ upfrontReservesCents: 5_000_000, monthlyReservesCents: 50_000 }), { holdMonths: 60 });
    expect(r.netProceedsCents).toBe(95_000_000);
    expect(r.allInRatePct).toBeGreaterThan(6);
    expect(r.totalCostCents).toBe(computeAllIn(terms(), { holdMonths: 60 }).totalCostCents);
  });

  it("reports DSCR and debt yield from NOI and flags a structure under the lender's minimum", () => {
    const r = computeAllIn(terms({ minDscr: 1.25 }), { holdMonths: 60, noiCents: 8_000_000 });
    expect(r.dscr).toBeCloseTo(8_000_000 / (amortizingPayment(100_000_000, 0.005, 360) * 12), 3);
    expect(r.debtYieldPct).toBe(8);
    const tight = computeAllIn(terms({ minDscr: 1.25 }), { holdMonths: 60, noiCents: 7_000_000 });
    expect(tight.warnings.join(" ")).toMatch(/below the lender's 1.25x minimum/);
  });

  it("prices to maturity when the hold is longer than the term", () => {
    const r = computeAllIn(terms({ termMonths: 36, amortizationMonths: null, ioMonths: 36, exitFeePct: 1 }), { holdMonths: 60 });
    expect(r.exitMonth).toBe(36);
    expect(r.exitFeeCents).toBe(1_000_000);
    expect(r.warnings.join(" ")).toMatch(/longer than the 36-month term/);
  });

  it("rejects impossible terms", () => {
    expect(() => computeAllIn(terms({ loanAmountCents: 0 }))).toThrow(AllInError);
    expect(() => computeAllIn(terms({ ratePct: 55 }))).toThrow(AllInError);
    expect(() => computeAllIn(terms({ ioMonths: 200 }))).toThrow(AllInError);
    expect(() => computeAllIn(terms({ originationFeePct: 10, lenderFeesCents: 95_000_000 }))).toThrow(/exceed the loan/);
  });
});

describe("compareQuotes", () => {
  it("ranks by all-in rate and labels the best offers", () => {
    const rows = compareQuotes(
      [
        { id: "a", lenderName: "Alpha", status: "active", terms: terms({ ratePct: 6.5, timelineDays: 45 }) },
        { id: "b", lenderName: "Bravo", status: "active", terms: terms({ ratePct: 6.0, originationFeePct: 2, timelineDays: 90, recourse: "full" }) },
        { id: "c", lenderName: "Charlie", status: "active", terms: terms({ ratePct: 6.1, loanAmountCents: 110_000_000 }) },
        { id: "d", lenderName: "Delta", status: "active", terms: terms({ loanAmountCents: 0 }) },
      ],
      { holdMonths: 60 },
      { targetCloseDays: 60, today: "2026-11-04" },
    );
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
    expect(rows[0]!.badges).toEqual(expect.arrayContaining(["Lowest all-in cost", "Most net proceeds"]));
    expect(rows.find((r) => r.id === "a")!.badges).toContain("Fastest close");
    expect(rows.find((r) => r.id === "b")!.flags).toEqual(expect.arrayContaining(["Full recourse", "Quoted 90 days to close (target 60)"]));
    expect(rows.find((r) => r.id === "d")!.error).toMatch(/positive/);
    expect(rows.find((r) => r.id === "d")!.rank).toBeNull();
  });
});
