// DSCR investor boxes: three hand-built term sheets per box, then rules.
// Rates: 10-yr 4.25%.

import { describe, expect, it } from "vitest";
import { monthlyPayment } from "../finance";
import { DSCR_INVESTOR } from "./assumptions";
import { creditTier, sizeDscr2to4, sizeDscr5Plus, sizeDscrInvestor } from "./dscrInvestor";
import { TEST_RATES as rates } from "./test-helpers";

describe("DSCR 2–4 term sheets", () => {
  it("1 — fourplex purchase, 760 FICO: 80% LTV ties the request", () => {
    // 4.25 + 2.75 = 7.00%. Coverage cap: (8,400 / 1.00 − 1,500) / payment factor(7%, 30) = 1,037,122; LTV 0.80 × 1.2M = 960,000.
    const q = sizeDscr2to4({ units: 4, purpose: "PURCHASE", value: 1_200_000, loanAmount: 960_000, fico: 760, monthlyRent: 8_400, monthlyTaxesInsuranceHoa: 1_500 }, rates);
    expect(q.eligible).toBe(true);
    expect(q.ratePct).toBeCloseTo(7, 10);
    expect(q.loanAmount).toBe(960_000);
    expect(q.binding).toBe("REQUESTED");
    expect(q.monthlyPrincipalInterest).toBeCloseTo(6_386.9, 1);
    // 8,400 / (6,386.90 + 1,500) = 1.065x.
    expect(q.dscr).toBeCloseTo(1.06506, 4);
    expect(q.equityRequired).toBe(240_000);
  });

  it("2 — triplex cash-out, 715 FICO: coverage binds below the 70% cash-out LTV", () => {
    // 4.25 + 3.125 = 7.375%. Coverage cap (5,200 − 1,100) / factor = 593,622 < LTV 630,000 → 593,000.
    const q = sizeDscr2to4({ units: 3, purpose: "CASH_OUT", value: 900_000, loanAmount: 700_000, fico: 715, monthlyRent: 5_200, monthlyTaxesInsuranceHoa: 1_100 }, rates);
    expect(q.loanAmount).toBe(593_000);
    expect(q.binding).toBe("DSCR");
    expect(q.dscr).toBeCloseTo(1.00083, 4);
    expect(q.dscr).toBeGreaterThanOrEqual(DSCR_INVESTOR.units2to4.minDscr);
  });

  it("3 — duplex rate-and-term, 665 FICO: lowest tier", () => {
    // 4.25 + 3.75 = 8.00%. Coverage cap (4,000 − 900) / factor(8%) = 422,479 < LTV 0.70 × 700,000 → 422,000.
    const q = sizeDscr2to4({ units: 2, purpose: "RATE_TERM", value: 700_000, loanAmount: 500_000, fico: 665, monthlyRent: 4_000, monthlyTaxesInsuranceHoa: 900 }, rates);
    expect(q.ratePct).toBeCloseTo(8, 10);
    expect(q.loanAmount).toBe(422_000);
    expect(q.binding).toBe("DSCR");
    expect(q.monthlyPrincipalInterest).toBeCloseTo(monthlyPayment(422_000, 8, 30), 6);
  });
});

describe("DSCR 5+ term sheets", () => {
  it("1 — 10 units purchase, 745 FICO: 75% LTV", () => {
    // 4.25 + 2.50 = 6.75%. LTV 1.5M; coverage 150,000 / 1.20 / constant(6.75%, 30) = 1,606,028.
    const q = sizeDscr5Plus({ units: 10, purpose: "PURCHASE", value: 2_000_000, loanAmount: 1_500_000, fico: 745, noi: 150_000 }, rates);
    expect(q.loanAmount).toBe(1_500_000);
    expect(q.binding).toBe("REQUESTED");
    expect(q.ratePct).toBeCloseTo(6.75, 10);
  });

  it("2 — 24 units rate-and-term, 705 FICO: coverage binds", () => {
    // 7.125%. Coverage 260,000 / 1.20 / constant(7.125%, 30) = 2,679,985 < LTV 3,150,000 → 2,679,000.
    const q = sizeDscr5Plus({ units: 24, purpose: "RATE_TERM", value: 4_500_000, loanAmount: 3_400_000, fico: 705, noi: 260_000 }, rates);
    expect(q.loanAmount).toBe(2_679_000);
    expect(q.binding).toBe("DSCR");
    expect(q.dscr).toBeGreaterThanOrEqual(1.2);
    expect(q.dscr).toBeLessThan(1.201);
  });

  it("3 — 40 units cash-out, 680 FICO: 60% LTV binds", () => {
    // 7.75%. LTV 0.60 × 9M = 5.4M < coverage 6,785,355.
    const q = sizeDscr5Plus({ units: 40, purpose: "CASH_OUT", value: 9_000_000, loanAmount: 6_000_000, fico: 680, noi: 700_000 }, rates);
    expect(q.loanAmount).toBe(5_400_000);
    expect(q.binding).toBe("LTV");
    expect(q.ratePct).toBeCloseTo(7.75, 10);
    expect(q.equityRequired).toBeUndefined();
  });
});

describe("DSCR rules", () => {
  it("tiers credit and rejects scores under 660", () => {
    expect([creditTier(740), creditTier(739), creditTier(700), creditTier(660), creditTier(659)]).toEqual(["A", "B", "B", "C", null]);
    const q = sizeDscr2to4({ units: 2, purpose: "RATE_TERM", value: 700_000, loanAmount: 400_000, fico: 650, monthlyRent: 4_000, monthlyTaxesInsuranceHoa: 900 }, rates);
    expect(q.eligible).toBe(false);
    expect(q.warnings.some((w) => /660\+ credit score/.test(w))).toBe(true);
  });

  it("routes by unit count and keeps single-family out of the 2–4 box", () => {
    expect(sizeDscrInvestor({ units: 6, purpose: "PURCHASE", value: 1_000_000, loanAmount: 700_000, fico: 720, noi: 80_000 }, rates).id).toBe("DSCR_INVESTOR_5_PLUS");
    const sfr = sizeDscrInvestor({ units: 1, purpose: "PURCHASE", value: 500_000, loanAmount: 375_000, fico: 760, monthlyRent: 3_200, monthlyTaxesInsuranceHoa: 500 }, rates);
    expect(sfr.id).toBe("DSCR_INVESTOR_2_4");
    expect(sfr.eligible).toBe(false);
  });

  it("caps each box at its program maximum", () => {
    const q = sizeDscr5Plus({ units: 80, purpose: "PURCHASE", value: 20_000_000, loanAmount: 12_000_000, fico: 780, noi: 1_400_000 }, rates);
    expect(q.loanAmount).toBe(DSCR_INVESTOR.units5plus.maxLoan);
    expect(q.binding).toBe("PROGRAM_CAP");
  });
});
