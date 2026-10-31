// Regression tests: one block per program box, pinning the max leverage,
// minimum coverage and premium each box is sized on. The literals here are the
// program values as of the date in ASSUMPTIONS_REVIEWED (HUD multifamily per
// Mortgagee Letter 2025-03 and Federal Register 2025-18379). If a test here
// fails, a program rule changed: update assumptions.ts with a VERIFY note and
// source, then update the literal.

import { describe, expect, it } from "vitest";
import type { Benchmarks } from "@/lib/rates";
import { AGENCY, BRIDGE, CMBS, FALLBACK_BENCHMARKS as rates, HUD, SBA } from "./assumptions";
import {
  GREEN_MIP_NOTE,
  hudMultifamilyBox,
  hudMultifamilyTier,
  isoDateLabel,
  sizeHospitality,
  sizeMultifamily,
  sizeSenior,
} from "./programs";
import type { HospitalityInputs, MultifamilyInputs, ProgramId, ProgramQuote, SeniorInputs, SizingResult } from "./types";

const quote = (r: SizingResult, id: ProgramId | ((id: ProgramId) => boolean)): ProgramQuote => {
  const q = r.quotes.find((x) => (typeof id === "function" ? id(x.id) : x.id === id));
  if (!q) throw new Error(`no quote ${String(id)}`);
  return q;
};

/** Sized amounts are floored to $1,000, so a binding limit lands within $1k below the cap. */
function expectCappedAt(q: ProgramQuote, cap: number) {
  expect(q.eligible).toBe(true);
  expect(q.loanAmount).toBeLessThanOrEqual(cap);
  expect(q.loanAmount).toBeGreaterThan(cap - 1_000);
}

/** At a binding coverage test the quote clears the minimum, by no more than rounding. */
function expectCoverageAt(q: ProgramQuote, minDscr: number) {
  expect(q.binding).toBe("DSCR");
  expect(q.dscr).toBeGreaterThanOrEqual(minDscr - 1e-9);
  expect(q.dscr).toBeLessThan(minDscr + 0.01);
}

const senior: SeniorInputs = {
  facilityType: "ASSISTED_LIVING",
  beds: 96,
  occupancyPct: 91,
  loanAmount: 30_000_000,
  noi: 5_000_000,
  value: 24_000_000,
  transaction: "REFINANCE",
  nonRecourseOnly: false,
  green: false,
};

const hotel: HospitalityInputs = {
  keys: 140,
  tier: "PREMIUM_FLAG",
  loanAmount: 40_000_000,
  noi: 6_000_000,
  adr: 210,
  occupancyPct: 78,
  pipBudget: 0,
  value: 30_000_000,
  transaction: "PURCHASE",
  nonRecourseOnly: false,
  green: false,
};

const mf: MultifamilyInputs = {
  assetType: "MULTIFAMILY",
  units: 120,
  sqft: 0,
  loanAmount: 40_000_000,
  noi: 4_000_000,
  value: 29_000_000,
  transaction: "REFINANCE",
  affordable: false,
  green: false,
};

const mfBuild: MultifamilyInputs = { ...mf, transaction: "CONSTRUCTION", value: 40_000_000, totalCost: 30_000_000 };

// ---------------------------------------------------------------------------
// HUD Section 232 — unchanged by ML 2025-03.

describe("HUD 232/223(f) box", () => {
  it("is 80% LTV, 1.45x DSCR, 0.65% annual MIP, 1% upfront, 35 years", () => {
    expect(HUD.section232.refi).toEqual({ termYears: 35, maxLtv: 0.8, minDscr: 1.45, annualMip: 0.0065, upfrontMip: 0.01 });
  });

  it("caps proceeds at 80% LTV", () => {
    const q = quote(sizeSenior(senior, rates), "HUD_232_223F");
    expect(q.binding).toBe("LTV");
    expectCappedAt(q, 24_000_000 * 0.8);
    expect(q.annualFee.amount).toBeCloseTo(q.loanAmount * 0.0065, 2);
    expect(q.closingBreakdown.find((l) => l.label === "Upfront MIP")!.amount).toBeCloseTo(q.loanAmount * 0.01, 2);
  });

  it("sizes to 1.45x when coverage binds", () => {
    expectCoverageAt(quote(sizeSenior({ ...senior, loanAmount: 19_000_000, noi: 1_200_000 }, rates), "HUD_232_223F"), 1.45);
  });

  it("ignores green certification for MIP and says so", () => {
    const q = quote(sizeSenior({ ...senior, green: true }, rates), "HUD_232_223F");
    expect(q.annualFee.amount).toBeCloseTo(q.loanAmount * 0.0065, 2);
    expect(q.notes).toContain(GREEN_MIP_NOTE);
    expect(q.warnings.join(" ")).not.toMatch(/Green MIP/);
  });
});

describe("HUD 232 new construction box", () => {
  const build: SeniorInputs = { ...senior, transaction: "NEW_CONSTRUCTION" };

  it("is 75% LTC, 1.45x DSCR, 0.77% annual MIP, 40 years", () => {
    expect(HUD.section232.newConstruction).toEqual({ termYears: 40, maxLtc: 0.75, minDscr: 1.45, annualMip: 0.0077, upfrontMip: 0.01 });
  });

  it("caps proceeds at 75% of project cost", () => {
    const q = quote(sizeSenior(build, rates), "HUD_232_NEW_CONST");
    expect(q.binding).toBe("LTC");
    expect(q.leverageBasis).toBe("LTC");
    expectCappedAt(q, 24_000_000 * 0.75);
    expect(q.annualFee.amount).toBeCloseTo(q.loanAmount * 0.0077, 2);
  });

  it("sizes to 1.45x when coverage binds", () => {
    expectCoverageAt(quote(sizeSenior({ ...build, loanAmount: 17_000_000, noi: 1_100_000 }, rates), "HUD_232_NEW_CONST"), 1.45);
  });
});

// ---------------------------------------------------------------------------
// HUD multifamily — ML 2025-03 boxes and the flat 0.25% MIP.

describe("HUD multifamily MIP", () => {
  it("is a flat 0.25% annual and 0.25% upfront for applications on or after Oct 1, 2025", () => {
    expect(HUD.multifamily.mip).toEqual({ annual: 0.0025, upfront: 0.0025, effectiveForApplicationsOnOrAfter: "2025-10-01" });
    expect(HUD.greenLowersMip).toBe(false);
  });

  it("is the same for every tier, program and green flag", () => {
    const variants: MultifamilyInputs[] = [
      mf,
      { ...mf, green: true },
      { ...mf, affordable: true },
      { ...mf, rentalAssistance: true, green: true },
      mfBuild,
      { ...mfBuild, affordable: true, green: true },
    ];
    for (const v of variants) {
      const q = quote(sizeMultifamily(v, rates), "HUD_221D4_223F_MULTIFAMILY");
      expect(q.annualFee.amount).toBeCloseTo(q.loanAmount * 0.0025, 2);
      expect(q.annualFee.label).toBe("Annual MIP (0.25%)");
      expect(q.closingBreakdown.find((l) => l.label === "Upfront MIP")!.amount).toBeCloseTo(q.loanAmount * 0.0025, 2);
    }
  });

  it("gives green deals the same HUD proceeds as non-green deals", () => {
    const plain = quote(sizeMultifamily({ ...mf, loanAmount: 25_000_000, noi: 1_500_000 }, rates), "HUD_221D4_223F_MULTIFAMILY");
    const green = quote(sizeMultifamily({ ...mf, loanAmount: 25_000_000, noi: 1_500_000, green: true }, rates), "HUD_221D4_223F_MULTIFAMILY");
    expect(green.loanAmount).toBe(plain.loanAmount);
    expect(green.annualFee.amount).toBe(plain.annualFee.amount);
    expect(green.notes).toContain(GREEN_MIP_NOTE);
    expect(plain.notes).not.toContain(GREEN_MIP_NOTE);
  });
});

describe("HUD 223(f) market-rate box", () => {
  it("is 87% LTV, 1.15x DSCR, 35 years", () => {
    expect(hudMultifamilyBox(false, "MARKET_RATE")).toMatchObject({ program: "223F", leverageBasis: "LTV", maxLeverage: 0.87, minDscr: 1.15, termYears: 35 });
  });

  it("caps proceeds at 87% LTV (above the pre-2025 85%)", () => {
    const q = quote(sizeMultifamily(mf, rates), "HUD_221D4_223F_MULTIFAMILY");
    expect(q.binding).toBe("LTV");
    expectCappedAt(q, 29_000_000 * 0.87);
    expect(q.loanAmount).toBeGreaterThan(29_000_000 * 0.85);
    expect(q.notes).toContain("Market-rate box: 87% LTV, 1.15x DSCR.");
  });

  it("sizes to 1.15x when coverage binds", () => {
    expectCoverageAt(quote(sizeMultifamily({ ...mf, loanAmount: 25_000_000, noi: 1_500_000 }, rates), "HUD_221D4_223F_MULTIFAMILY"), 1.15);
  });

  it("notes the unchanged 80% cash-out cap on cash-out refinances only", () => {
    expect(HUD.multifamily.s223f.cashOutMaxLtv).toBe(0.8);
    expect(quote(sizeMultifamily({ ...mf, cashOut: true }, rates), "HUD_221D4_223F_MULTIFAMILY").notes).toContain("Cash-out refinances stay capped at 80% LTV.");
    expect(quote(sizeMultifamily(mf, rates), "HUD_221D4_223F_MULTIFAMILY").notes.join(" ")).not.toMatch(/Cash-out/);
    expect(quote(sizeMultifamily({ ...mf, transaction: "PURCHASE", cashOut: true }, rates), "HUD_221D4_223F_MULTIFAMILY").notes.join(" ")).not.toMatch(/Cash-out/);
  });

  it("sizes a cash-out refinance at 80% LTV, not 87% (regression)", () => {
    const inputs: MultifamilyInputs = { ...mf, value: 10_000_000, noi: 2_000_000, loanAmount: 20_000_000 };
    const rateTerm = quote(sizeMultifamily(inputs, rates), "HUD_221D4_223F_MULTIFAMILY");
    expect(rateTerm.binding).toBe("LTV");
    expectCappedAt(rateTerm, 10_000_000 * 0.87);

    const cashOut = quote(sizeMultifamily({ ...inputs, cashOut: true }, rates), "HUD_221D4_223F_MULTIFAMILY");
    expect(cashOut.binding).toBe("LTV");
    expectCappedAt(cashOut, 10_000_000 * 0.8);
    expect(cashOut.loanAmount).toBeLessThan(rateTerm.loanAmount);
    expect(hudMultifamilyBox(false, "MARKET_RATE", true).maxLeverage).toBe(0.8);
    // The affordable box (90%) is capped at the cash-out limit as well; 221(d)(4) is unaffected.
    expect(hudMultifamilyBox(false, "AFFORDABLE", true).maxLeverage).toBe(0.8);
    expect(hudMultifamilyBox(true, "MARKET_RATE", true).maxLeverage).toBe(0.87);
  });
});

describe("HUD 223(f) affordable box", () => {
  it("is 90% LTV, 1.11x DSCR", () => {
    expect(hudMultifamilyBox(false, "AFFORDABLE")).toMatchObject({ maxLeverage: 0.9, minDscr: 1.11 });
  });

  it("caps proceeds at 90% LTV", () => {
    const q = quote(sizeMultifamily({ ...mf, affordable: true }, rates), "HUD_221D4_223F_MULTIFAMILY");
    expect(q.binding).toBe("LTV");
    expectCappedAt(q, 29_000_000 * 0.9);
  });

  it("sizes to 1.11x when coverage binds", () => {
    expectCoverageAt(quote(sizeMultifamily({ ...mf, affordable: true, loanAmount: 25_000_000, noi: 1_500_000 }, rates), "HUD_221D4_223F_MULTIFAMILY"), 1.11);
  });
});

describe("HUD 223(f) rental-assistance box", () => {
  it("shares the affordable 90% / 1.11x box", () => {
    expect(hudMultifamilyTier({ affordable: false, rentalAssistance: true, transaction: "REFINANCE" }).tier).toBe("RENTAL_ASSISTANCE");
    expect(hudMultifamilyBox(false, "RENTAL_ASSISTANCE")).toMatchObject({ maxLeverage: 0.9, minDscr: 1.11 });
  });

  it("caps proceeds at 90% LTV and sizes to 1.11x", () => {
    const ltv = quote(sizeMultifamily({ ...mf, rentalAssistance: true }, rates), "HUD_221D4_223F_MULTIFAMILY");
    expectCappedAt(ltv, 29_000_000 * 0.9);
    expect(ltv.notes).toContain("Rental-assistance box: 90% LTV, 1.11x DSCR.");
    expectCoverageAt(quote(sizeMultifamily({ ...mf, rentalAssistance: true, loanAmount: 25_000_000, noi: 1_500_000 }, rates), "HUD_221D4_223F_MULTIFAMILY"), 1.11);
  });
});

describe("HUD 221(d)(4) market-rate box", () => {
  it("is 87% LTC, 1.15x DSCR, 40 years", () => {
    expect(hudMultifamilyBox(true, "MARKET_RATE")).toMatchObject({ program: "221D4", leverageBasis: "LTC", maxLeverage: 0.87, minDscr: 1.15, termYears: 40 });
  });

  it("caps proceeds at 87% of total project cost and reports LTC on cost", () => {
    const q = quote(sizeMultifamily(mfBuild, rates), "HUD_221D4_223F_MULTIFAMILY");
    expect(q.name).toBe("HUD 221(d)(4)");
    expect(q.binding).toBe("LTC");
    expect(q.leverageBasis).toBe("LTC");
    expectCappedAt(q, 30_000_000 * 0.87);
    expect(q.ltv).toBeCloseTo(0.87, 3);
  });

  it("sizes to 1.15x when coverage binds", () => {
    expectCoverageAt(quote(sizeMultifamily({ ...mfBuild, loanAmount: 25_000_000, noi: 1_500_000 }, rates), "HUD_221D4_223F_MULTIFAMILY"), 1.15);
  });
});

describe("HUD 221(d)(4) affordable box", () => {
  it("is 90% LTC, 1.11x DSCR", () => {
    expect(hudMultifamilyBox(true, "AFFORDABLE")).toMatchObject({ maxLeverage: 0.9, minDscr: 1.11 });
    expect(hudMultifamilyBox(true, "RENTAL_ASSISTANCE")).toMatchObject({ maxLeverage: 0.9, minDscr: 1.11 });
  });

  it("caps proceeds at 90% LTC and sizes to 1.11x", () => {
    expectCappedAt(quote(sizeMultifamily({ ...mfBuild, affordable: true }, rates), "HUD_221D4_223F_MULTIFAMILY"), 30_000_000 * 0.9);
    expectCoverageAt(quote(sizeMultifamily({ ...mfBuild, affordable: true, loanAmount: 25_000_000, noi: 1_500_000 }, rates), "HUD_221D4_223F_MULTIFAMILY"), 1.11);
  });
});

describe("HUD 221(d)(4) middle-income box (flagged)", () => {
  it("is off by default and holds 90% LTC / 1.11x for when it is confirmed", () => {
    expect(HUD.multifamily.middleIncome221d4).toMatchObject({ enabled: false, maxLtc: 0.9, minDscr: 1.11 });
  });

  it("sizes on the market-rate box, with a warning, while the flag is off", () => {
    const q = quote(sizeMultifamily({ ...mfBuild, middleIncome: true }, rates), "HUD_221D4_223F_MULTIFAMILY");
    expectCappedAt(q, 30_000_000 * 0.87);
    expect(q.warnings.join(" ")).toMatch(/middle-income tier is not yet confirmed/);
  });

  it("sizes at 90% LTC / 1.11x when the flag is on", () => {
    const opts = { middleIncomeTier: true };
    const q = quote(sizeMultifamily({ ...mfBuild, middleIncome: true }, rates, opts), "HUD_221D4_223F_MULTIFAMILY");
    expectCappedAt(q, 30_000_000 * 0.9);
    expect(q.notes).toContain("Middle-income box: 90% LTC, 1.11x DSCR.");
    expectCoverageAt(quote(sizeMultifamily({ ...mfBuild, middleIncome: true, loanAmount: 25_000_000, noi: 1_500_000 }, rates, opts), "HUD_221D4_223F_MULTIFAMILY"), 1.11);
  });

  it("never applies to 223(f), even with the flag on", () => {
    expect(hudMultifamilyTier({ affordable: false, middleIncome: true, transaction: "REFINANCE" }, { middleIncomeTier: true }).tier).toBe("MARKET_RATE");
    expect(hudMultifamilyBox(false, "MIDDLE_INCOME")).toMatchObject({ tier: "MARKET_RATE", maxLeverage: 0.87, minDscr: 1.15 });
    const q = quote(sizeMultifamily({ ...mf, middleIncome: true }, rates, { middleIncomeTier: true }), "HUD_221D4_223F_MULTIFAMILY");
    expectCappedAt(q, 29_000_000 * 0.87);
  });

  it("lets affordable and rental assistance take precedence", () => {
    expect(hudMultifamilyTier({ affordable: true, middleIncome: true, transaction: "CONSTRUCTION" }, { middleIncomeTier: true }).tier).toBe("AFFORDABLE");
    expect(hudMultifamilyTier({ affordable: true, rentalAssistance: true, transaction: "CONSTRUCTION" }).tier).toBe("RENTAL_ASSISTANCE");
  });
});

// ---------------------------------------------------------------------------
// SBA 504 (+ 7(a) stack)

describe("SBA 504 box", () => {
  const small: SeniorInputs = { ...senior, beds: 58, loanAmount: 5_000_000, noi: 1_000_000, value: 3_200_000 };

  it("is 50% bank / 35% CDC / 15% equity for special-purpose property, 1.25x DSCR, $5M CDC cap", () => {
    expect(SBA.bankFirstPct).toBe(0.5);
    expect(SBA.equity.base + SBA.equity.specialPurpose).toBeCloseTo(0.15, 10);
    expect(SBA.minDscr).toBe(1.25);
    expect(SBA.cdcCap).toBe(5_000_000);
    expect(SBA.cdcCapGreen).toBe(5_500_000);
  });

  it("caps proceeds at 85% of project cost with no MIP and no audit", () => {
    const q = quote(sizeSenior(small, rates), (id) => id.startsWith("SBA_"));
    expect(q.binding).toBe("PROGRAM_CAP");
    expectCappedAt(q, 3_200_000 * 0.85);
    expect(q.annualAudit).toBe(0);
    expect(q.annualFee.label).toBe("SBA guarantee & CDC servicing fees");
    expect(q.annualFee.amount).toBeCloseTo(q.tranches[1]!.amount * SBA.annualDebentureFees, 2);
  });

  it("sizes to 1.25x when coverage binds", () => {
    expectCoverageAt(quote(sizeSenior({ ...small, loanAmount: 2_500_000, noi: 250_000 }, rates), (id) => id.startsWith("SBA_")), 1.25);
  });
});

describe("SBA 504 + 7(a) stack box", () => {
  it("keeps the CDC at its cap and total SBA exposure within $10M", () => {
    expect(SBA.combinedExposureCap).toBe(10_000_000);
    const q = quote(sizeHospitality({ ...hotel, loanAmount: 25_000_000, value: 26_000_000, pipBudget: 4_000_000, green: false }, rates), (id) => id.startsWith("SBA_"));
    expect(q.id).toBe("SBA_504_PLUS_7A_10M_STACK");
    expect(q.tranches[1]!.amount).toBeLessThanOrEqual(SBA.cdcCap);
    expect(q.tranches[1]!.amount + q.tranches[2]!.amount).toBeLessThanOrEqual(SBA.combinedExposureCap);
    expect(q.loanAmount).toBeLessThanOrEqual(30_000_000 * 0.85);
  });
});

// ---------------------------------------------------------------------------
// Hospitality

describe("Hotel CMBS box", () => {
  it("is 65% LTV, 1.40x DSCR, 11% / 12% / 12.5% debt yield by tier, $5M minimum", () => {
    expect(CMBS.maxLtv).toBe(0.65);
    expect(CMBS.minDscr).toBe(1.4);
    expect(CMBS.minDebtYield).toEqual({ PREMIUM_FLAG: 0.11, ECONOMY_FLAG: 0.12, BOUTIQUE_INDEPENDENT: 0.125 });
    expect(CMBS.minLoan).toBe(5_000_000);
  });

  it("caps proceeds at 65% LTV", () => {
    const q = quote(sizeHospitality(hotel, rates), "HOSPITALITY_CMBS_NON_RECOURSE");
    expect(q.binding).toBe("LTV");
    expectCappedAt(q, 30_000_000 * 0.65);
    expect(q.annualFee.amount).toBe(0);
  });

  it("sizes to the tier debt yield when it binds", () => {
    const q = quote(sizeHospitality({ ...hotel, tier: "ECONOMY_FLAG", loanAmount: 19_000_000, noi: 2_000_000 }, rates), "HOSPITALITY_CMBS_NON_RECOURSE");
    expect(q.binding).toBe("DEBT_YIELD");
    expect(q.debtYield).toBeGreaterThanOrEqual(0.12);
    expect(q.debtYield).toBeLessThan(0.1201);
  });

  it("sizes to 1.40x when coverage binds", () => {
    const high: Benchmarks = { ...rates, tenYear: 5.5 };
    expectCoverageAt(quote(sizeHospitality({ ...hotel, loanAmount: 19_000_000, noi: 2_000_000 }, high), "HOSPITALITY_CMBS_NON_RECOURSE"), 1.4);
  });
});

describe("PIP bridge box", () => {
  const pip: HospitalityInputs = { ...hotel, value: 20_000_000, pipBudget: 2_000_000, loanAmount: 30_000_000, noi: 5_000_000 };

  it("is 70% LTC on purchase plus PIP, 8% debt yield", () => {
    expect(BRIDGE.hotelPip).toMatchObject({ maxLtc: 0.7, minDebtYield: 0.08 });
    const q = quote(sizeHospitality(pip, rates), "HOSPITALITY_PIP_BRIDGE");
    expect(q.binding).toBe("LTC");
    expectCappedAt(q, 22_000_000 * 0.7);
    expect(q.leverageBasis).toBe("LTC");
  });

  it("sizes to an 8% debt yield when it binds", () => {
    const q = quote(sizeHospitality({ ...pip, noi: 1_000_000 }, rates), "HOSPITALITY_PIP_BRIDGE");
    expect(q.binding).toBe("DEBT_YIELD");
    expect(q.debtYield).toBeGreaterThanOrEqual(0.08);
    expect(q.debtYield).toBeLessThan(0.0801);
  });
});

// ---------------------------------------------------------------------------
// Senior bridge, agency, private bridge and construction

describe("Bridge-to-HUD box", () => {
  it("is 75% LTV, 8% debt yield", () => {
    expect(BRIDGE.senior).toMatchObject({ maxLtv: 0.75, minDebtYield: 0.08 });
    const q = quote(sizeSenior(senior, rates), "BRIDGE_TO_HUD_232");
    expect(q.binding).toBe("LTV");
    expectCappedAt(q, 24_000_000 * 0.75);
    const dy = quote(sizeSenior({ ...senior, noi: 1_000_000 }, rates), "BRIDGE_TO_HUD_232");
    expect(dy.binding).toBe("DEBT_YIELD");
    expect(dy.debtYield).toBeGreaterThanOrEqual(0.08);
  });
});

describe("Agency (Fannie / Freddie) box", () => {
  it("is 80% LTV, 1.25x DSCR, 30-year amortization, no MIP", () => {
    expect(AGENCY).toMatchObject({ maxLtv: 0.8, minDscr: 1.25, amortYears: 30 });
    const q = quote(sizeMultifamily(mf, rates), "AGENCY_FANNIE_FREDDIE");
    expect(q.binding).toBe("LTV");
    expectCappedAt(q, 29_000_000 * 0.8);
    expect(q.annualFee.amount).toBe(0);
  });

  it("sizes to 1.25x when coverage binds", () => {
    expectCoverageAt(quote(sizeMultifamily({ ...mf, loanAmount: 25_000_000, noi: 1_500_000 }, rates), "AGENCY_FANNIE_FREDDIE"), 1.25);
  });

  it("prices green deals with the configured agency discount", () => {
    const plain = quote(sizeMultifamily(mf, rates), "AGENCY_FANNIE_FREDDIE");
    const green = quote(sizeMultifamily({ ...mf, green: true }, rates), "AGENCY_FANNIE_FREDDIE");
    expect(plain.ratePct - green.ratePct).toBeCloseTo(AGENCY.greenRateDiscountPct, 10);
  });
});

describe("Private bridge box", () => {
  const cre: MultifamilyInputs = { ...mf, assetType: "COMMERCIAL", sqft: 40_000, units: 0, value: 9_000_000, noi: 2_000_000, loanAmount: 20_000_000 };

  it("is 75% LTV, 7% debt yield", () => {
    expect(BRIDGE.cre).toMatchObject({ maxLtv: 0.75, minDebtYield: 0.07 });
    const q = quote(sizeMultifamily(cre, rates), "WHITE_LABEL_CRE_BRIDGE");
    expect(q.binding).toBe("LTV");
    expectCappedAt(q, 9_000_000 * 0.75);
    const dy = quote(sizeMultifamily({ ...cre, noi: 400_000 }, rates), "WHITE_LABEL_CRE_BRIDGE");
    expect(dy.binding).toBe("DEBT_YIELD");
    expect(dy.debtYield).toBeGreaterThanOrEqual(0.07);
  });
});

describe("Private construction box", () => {
  it("is 80% LTC, 6.5% debt yield on cost, reported as LTC on cost", () => {
    expect(BRIDGE.construction).toMatchObject({ maxLtc: 0.8, minDebtYieldOnCost: 0.065 });
    const q = quote(sizeMultifamily(mfBuild, rates), "WHITE_LABEL_CRE_BRIDGE");
    expect(q.name).toBe("Private Construction");
    expect(q.binding).toBe("LTC");
    expect(q.leverageBasis).toBe("LTC");
    expectCappedAt(q, 30_000_000 * 0.8);
    expect(q.ltv).toBeCloseTo(0.8, 3);
  });
});

describe("isoDateLabel", () => {
  it("formats ISO dates without touching the clock", () => {
    expect(isoDateLabel("2025-10-01")).toBe("Oct 1, 2025");
    expect(isoDateLabel("2026-01-15")).toBe("Jan 15, 2026");
  });

  it("is used for the MIP effective-date note", () => {
    const q = quote(sizeMultifamily(mf, rates), "HUD_221D4_223F_MULTIFAMILY");
    expect(q.notes).toContain("Flat 0.25% annual MIP for applications submitted on or after Oct 1, 2025.");
  });
});
