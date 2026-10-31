// HUD 223(a)(7): three hand-built refinances, then the flag.
// Rate: 10-yr 4.25 + HUD multifamily mid 1.50 − 0.05 = 5.70%; MIP 0.25%;
// percentage costs 0.25% upfront MIP + 1% financing + 0.15% application + 0.5% Kubera = 1.9%;
// fixed costs 40,000 legal/title + 10,000 inspection = 50,000.

import { describe, expect, it } from "vitest";
import { HUD_223A7 } from "./assumptions";
import { hud223a7Breakdown, maxNewTerm, sizeHud223a7, type Hud223a7Inputs } from "./hud223a7";
import { hud223a7FlagFromEnv, sizeMultifamilyPlus, type MultifamilyPlusInputs } from "./multifamily";
import { TEST_RATES as rates } from "./test-helpers";

const loan1: Hud223a7Inputs = {
  unpaidBalance: 12_000_000,
  originalPrincipal: 15_000_000,
  existingRatePct: 5.5,
  existingAnnualMip: 0.0045,
  remainingTermYears: 28,
  originalProgram: "223F",
  repairs: 0,
  noi: 1_400_000,
};

describe("HUD 223(a)(7) term sheets", () => {
  it("1 — payoff plus costs binds; payment falls", () => {
    // Basis (12,000,000 + 50,000) / 0.981 = 12,283,384 < original 15M and < payment cap 13,060,107 → 12,283,000.
    // New term min(35, 28 + 12) = 35. Current P&I + MIP 894,910.78; new 12,283,000 × 0.0685225 = 841,661.52.
    const b = hud223a7Breakdown(loan1, rates);
    expect(b.ratePct).toBeCloseTo(5.7, 10);
    expect(b.newTermYears).toBe(35);
    expect(b.refinanceBasis).toBeCloseTo(12_283_384.3, 1);
    expect(b.loanAmount).toBe(12_283_000);
    expect(b.binding).toBe("REFINANCE_BASIS");
    expect(b.existingDebtService).toBeCloseTo(894_910.78, 1);
    expect(b.newDebtService).toBeCloseTo(841_661.52, 1);
    expect(b.annualSavings).toBeCloseTo(53_249.26, 1);
    const q = sizeHud223a7(loan1, rates);
    expect(q.binding).toBe("REQUESTED");
    expect(q.recourse).toBe("Non-recourse");
  });

  it("2 — a low-rate 221(d)(4) loan is held to its current payment", () => {
    // Existing 4.00% leaves little room: payment cap 556,108.52 / 0.0660337 = 8,421,591 < basis 9,633,028 → 8,421,000.
    const b = hud223a7Breakdown({ ...loan1, unpaidBalance: 9_000_000, originalPrincipal: 9_200_000, existingRatePct: 4, remainingTermYears: 30, originalProgram: "221D4", repairs: 400_000 }, rates);
    expect(b.newTermYears).toBe(40);
    expect(b.loanAmount).toBe(8_421_000);
    expect(b.binding).toBe("DEBT_SERVICE_TEST");
    expect(b.newDebtService).toBeLessThanOrEqual(b.existingDebtService);
    // 9,000,000 + 400,000 + 50,000 + 1.9% × 8,421,000 − 8,421,000.
    expect(b.cashToClose).toBeCloseTo(1_188_999, 1);
  });

  it("3 — the original insured principal caps the loan", () => {
    // Basis (7,900,000 + 150,000 + 50,000) / 0.981 = 8,256,881 > original 8,000,000.
    const b = hud223a7Breakdown({ ...loan1, unpaidBalance: 7_900_000, originalPrincipal: 8_000_000, existingRatePct: 6.25, existingAnnualMip: 0.005, remainingTermYears: 20, repairs: 150_000 }, rates);
    expect(b.newTermYears).toBe(32);
    expect(b.loanAmount).toBe(8_000_000);
    expect(b.binding).toBe("ORIGINAL_PRINCIPAL");
    expect(b.annualSavings).toBeCloseTo(168_216.97, 1);
    expect(b.cashToClose).toBeCloseTo(252_000, 1);
  });
});

describe("HUD 223(a)(7) flag", () => {
  const mf: MultifamilyPlusInputs = {
    assetType: "MULTIFAMILY",
    units: 150,
    sqft: 0,
    loanAmount: 12_000_000,
    noi: 1_400_000,
    value: 24_000_000,
    transaction: "REFINANCE",
    affordable: false,
    green: false,
    agencyTermYears: 10,
    agencyIoYears: 0,
    fico: 740,
    existingHud: loan1,
  };

  it("is off by default", () => {
    expect(HUD_223A7.enabled).toBe(false);
    expect(hud223a7FlagFromEnv(undefined)).toBe(false);
    expect(hud223a7FlagFromEnv("1")).toBe(false);
    expect(hud223a7FlagFromEnv("true")).toBe(true);
    expect(sizeMultifamilyPlus(mf, rates).quotes.some((q) => q.id === "HUD_223A7")).toBe(false);
  });

  it("quotes 223(a)(7) when switched on for a refinance of an insured loan", () => {
    const r = sizeMultifamilyPlus(mf, rates, { hud223a7: true });
    expect(r.quotes.some((q) => q.id === "HUD_223A7")).toBe(true);
    expect(sizeMultifamilyPlus({ ...mf, transaction: "PURCHASE" }, rates, { hud223a7: true }).quotes.some((q) => q.id === "HUD_223A7")).toBe(false);
  });

  it("caps the new term at remaining + 12 years within the program maximum", () => {
    expect(maxNewTerm({ remainingTermYears: 10, originalProgram: "223F" })).toBe(22);
    expect(maxNewTerm({ remainingTermYears: 30, originalProgram: "223F" })).toBe(35);
    expect(maxNewTerm({ remainingTermYears: 33.5, originalProgram: "221D4" })).toBe(40);
  });
});
