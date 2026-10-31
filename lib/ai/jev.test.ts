// Jev routing for the new boxes: hard money, construction, DSCR investor and
// tiered agency intakes land on the right program, lenders and flags.

import { describe, expect, it } from "vitest";
import { NEW_PROGRAM_IDS } from "@/lib/sizing/programs/types";
import { intakeSchema } from "@/lib/validation";
import { NEW_BOX_ROUTING, PROGRAM_FITS, decideWithRules, intakeAssumptions, jevDecisionSchema, lendersFor, publicSummary, verticalFor } from "./jev";

const rates = { fiveYear: 4.0, tenYear: 4.25, sofr30: 4.0, prime: 7.0 };

describe("Jev: hard money intakes", () => {
  const flip = intakeSchema.parse({
    assetType: "RESIDENTIAL_2_4",
    transaction: "HARD_MONEY",
    loanAmount: 500_000,
    noi: 0,
    value: 400_000,
    unitCount: 2,
    hardMoney: { strategy: "FIX_AND_FLIP", rehabBudget: 100_000, arv: 650_000, completedProjects: 6, termMonths: 12, holdMonths: 8 },
  });

  it("routes to the hard money box with private lenders", () => {
    const r = decideWithRules(flip, rates);
    expect(verticalFor(flip)).toBe("HARD_MONEY_PRIVATE");
    expect(r.decision.assetVertical).toBe("HARD_MONEY_PRIVATE");
    expect(r.decision.primaryProgramFit).toBe("HARD_MONEY");
    expect(r.primaryQuote?.loanAmount).toBe(450_000);
    expect(r.decision.recommendedWholesaleLenders).toEqual(["FIDELIS_PRIVATE_FUND", "ROC_CAPITAL"]);
    // No in-place income is expected on a flip: still qualified, 1% advisory fee on 450,000.
    expect(r.decision.leadUrgencyTier).not.toBe("UNQUALIFIED");
    expect(r.decision.estimatedBrokerCommissionUsd).toBe(4_500);
    expect(jevDecisionSchema.safeParse(r.decision).success).toBe(true);
  });

  it("flags a flip whose sale exit loses money", () => {
    const thin = intakeSchema.parse({ ...flip, value: 300_000, loanAmount: 400_000, hardMoney: { strategy: "FIX_AND_FLIP", rehabBudget: 80_000, arv: 420_000, termMonths: 12, holdMonths: 14 } });
    const r = decideWithRules(thin, rates);
    expect(r.decision.sizingOptimizationFlag).toBe("EXIT_SHORTFALL_NEEDS_RESTRUCTURE");
    expect(r.rationale.some((x) => /Sale exit falls short/.test(x))).toBe(true);
  });

  it("notes what it assumed for a bare hard money intake", () => {
    const bare = intakeSchema.parse({ assetType: "COMMERCIAL", transaction: "HARD_MONEY", loanAmount: 1_500_000, noi: 0 });
    expect(intakeAssumptions(bare)).toHaveLength(2);
    const r = decideWithRules(bare, rates);
    expect(r.decision.primaryProgramFit).toBe("HARD_MONEY");
  });
});

describe("Jev: construction intakes", () => {
  const build = intakeSchema.parse({
    assetType: "COMMERCIAL",
    transaction: "CONSTRUCTION",
    loanAmount: 15_000_000,
    noi: 1_650_000,
    construction: { landCost: 3_000_000, hardCosts: 14_000_000, softCosts: 2_500_000, contingencyPct: 5, developerFeePct: 3, gmpContract: true, asCompletedValue: 27_500_000, completedProjects: 5 },
  });

  it("routes ground-up commercial to the construction channels", () => {
    const r = decideWithRules(build, rates);
    expect(r.sizing.quotes.map((q) => q.id)).toEqual(["CONSTRUCTION_BANK", "CONSTRUCTION_DEBT_FUND", "CONSTRUCTION_PRIVATE"]);
    expect(r.decision.primaryProgramFit).toBe("CONSTRUCTION_BANK");
    expect(r.primaryQuote?.loanAmount).toBe(14_531_000);
    expect(r.decision.leadUrgencyTier).toBe("TIER_1_INSTITUTIONAL_HOT");
    expect(r.decision.recommendedWholesaleLenders).toContain("READY_CAPITAL");
  });

  it("adds HUD 221(d)(4) for ground-up multifamily", () => {
    const r = decideWithRules({ ...build, assetType: "MULTIFAMILY", unitCount: 80 }, rates);
    expect(r.sizing.quotes[0]?.id).toBe("HUD_221D4_223F_MULTIFAMILY");
    expect(r.decision.primaryProgramFit).toBe("HUD_221D4_223F_MULTIFAMILY");
  });

  it("estimates the budget when none is given and says so", () => {
    const bare = intakeSchema.parse({ assetType: "MIXED_USE", transaction: "CONSTRUCTION", loanAmount: 6_500_000, noi: 900_000, value: 2_000_000, unitCount: 30 });
    const r = decideWithRules(bare, rates);
    expect(r.rationale[0]).toMatch(/No construction budget/);
    expect(r.sizing.value).toBeGreaterThan(9_000_000);
  });

  it("keeps senior-care and hotel construction on their own boxes", () => {
    const senior = intakeSchema.parse({ assetType: "ASSISTED_LIVING", transaction: "CONSTRUCTION", loanAmount: 12_000_000, noi: 1_600_000, value: 18_000_000, unitCount: 90 });
    expect(decideWithRules(senior, rates).sizing.quotes.some((q) => q.id === "HUD_232_NEW_CONST")).toBe(true);
  });
});

describe("Jev: rentals and agency", () => {
  it("sizes a 2–4 unit rental on the DSCR box", () => {
    const duplex = intakeSchema.parse({
      assetType: "RESIDENTIAL_2_4",
      transaction: "REFINANCE",
      loanAmount: 420_000,
      noi: 30_000,
      value: 700_000,
      unitCount: 2,
      creditBand: "660_699",
      rental: { monthlyRent: 4_000, monthlyTaxesInsuranceHoa: 900 },
    });
    const r = decideWithRules(duplex, rates);
    expect(r.decision.assetVertical).toBe("RESIDENTIAL_INVESTOR");
    expect(r.decision.primaryProgramFit).toBe("DSCR_INVESTOR_2_4");
    expect(r.primaryQuote?.loanAmount).toBe(420_000);
    expect(r.decision.recommendedWholesaleLenders).toContain("ROC_CAPITAL");
  });

  it("quotes Fannie Mae and Freddie Mac separately for stabilized multifamily", () => {
    const mf = intakeSchema.parse({ assetType: "MULTIFAMILY", transaction: "REFINANCE", loanAmount: 8_000_000, noi: 820_000, value: 12_000_000, unitCount: 60, occupancyPct: 95 });
    const r = decideWithRules(mf, rates);
    const ids = r.sizing.quotes.map((q) => q.id);
    expect(ids).toContain("AGENCY_FANNIE_MAE");
    expect(ids).toContain("AGENCY_FREDDIE_MAC");
    expect(ids).not.toContain("AGENCY_FANNIE_FREDDIE");
    expect(r.decision.primaryProgramFit).toMatch(/^AGENCY_|^HUD_/);
    expect(publicSummary({ ...r, engine: "rules", latencyMs: 1 }).program).toBe(r.primaryQuote?.name);
  });
});

describe("Jev schema", () => {
  it("accepts every new program id and routes each to lenders", () => {
    for (const id of NEW_PROGRAM_IDS) {
      expect(PROGRAM_FITS).toContain(id);
      expect(lendersFor(id)).toEqual(NEW_BOX_ROUTING[id]);
    }
    expect(lendersFor("SBA_504_STANDARD")).toContain("TMC_FINANCING_CDC");
    expect(lendersFor("NONE")).toEqual([]);
    expect(lendersFor("toString")).toEqual([]);
  });

  it("validates the new intake fields", () => {
    expect(intakeSchema.safeParse({ assetType: "RESIDENTIAL_2_4", transaction: "HARD_MONEY", loanAmount: 300_000, noi: 0, hardMoney: { termMonths: 48 } }).success).toBe(false);
    expect(intakeSchema.safeParse({ assetType: "COMMERCIAL", transaction: "CONSTRUCTION", loanAmount: 3_000_000, noi: 0, construction: { landCost: 1, hardCosts: 1, contingencyPct: 80 } }).success).toBe(false);
    expect(intakeSchema.safeParse({ assetType: "COMMERCIAL", transaction: "REFINANCE", loanAmount: 3_000_000, noi: 1, creditBand: "800" }).success).toBe(false);
    const ok = intakeSchema.parse({ assetType: "MULTIFAMILY", transaction: "HARD_MONEY", loanAmount: 2_000_000, noi: 0, hardMoney: {} });
    expect(ok.hardMoney).toMatchObject({ strategy: "FIX_AND_FLIP", purpose: "PURCHASE", rehabBudget: 0, termMonths: 12, completedProjects: 0 });
  });
});
