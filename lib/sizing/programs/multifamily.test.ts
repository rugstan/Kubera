// The multifamily result with the new boxes folded in, plus a copy guard over
// every box: no usury-exemption claims, no overclaims, no guaranteed timelines.

import { describe, expect, it } from "vitest";
import { containsExemptionClaim } from "@/lib/compliance/gates";
import { sizeMultifamily } from "../programs";
import { sizeConstruction, type ConstructionInputs } from "./construction";
import { sizeHardMoney } from "./hardMoney";
import { sizeMultifamilyPlus, type MultifamilyPlusInputs } from "./multifamily";
import { TEST_RATES as rates, quoteCopy, quoteOf } from "./test-helpers";
import type { SizerQuote } from "./types";

const mf: MultifamilyPlusInputs = {
  assetType: "MULTIFAMILY",
  units: 120,
  sqft: 110_000,
  loanAmount: 20_000_000,
  noi: 1_750_000,
  value: 29_000_000,
  transaction: "REFINANCE",
  affordable: false,
  green: false,
  agencyTermYears: 10,
  agencyIoYears: 0,
  fico: 740,
};

describe("multifamily with the new boxes", () => {
  it("replaces the single agency quote with tiered Fannie Mae and Freddie Mac quotes and adds DSCR 5+", () => {
    const r = sizeMultifamilyPlus(mf, rates);
    expect(r.quotes.map((q) => q.id)).toEqual([
      "HUD_221D4_223F_MULTIFAMILY",
      "AGENCY_FANNIE_MAE",
      "AGENCY_FREDDIE_MAC",
      "WHITE_LABEL_CRE_BRIDGE",
      "DSCR_INVESTOR_5_PLUS",
    ]);
    // HUD and its value basis are unchanged from the original sizer.
    const original = sizeMultifamily(mf, rates);
    expect(quoteOf(r, "HUD_221D4_223F_MULTIFAMILY")).toEqual(original.quotes[0]);
    expect(r.value).toBe(original.value);
    expect(r.bestFit).not.toBeNull();
  });

  it("sizes 2–4 unit buildings on the DSCR 2–4 box and takes HUD and agency off the table", () => {
    const r = sizeMultifamilyPlus({ ...mf, units: 4, loanAmount: 900_000, noi: 70_000, value: 1_200_000, monthlyRent: 8_400, monthlyTaxesInsuranceHoa: 1_500 }, rates);
    expect(quoteOf(r, "HUD_221D4_223F_MULTIFAMILY").eligible).toBe(false);
    expect(quoteOf(r, "AGENCY_FANNIE_MAE").eligible).toBe(false);
    expect(quoteOf(r, "DSCR_INVESTOR_2_4").eligible).toBe(true);
    expect(r.bestFit).toBe("DSCR_INVESTOR_2_4");
  });

  it("adds no DSCR quote for construction or commercial deals", () => {
    expect(sizeMultifamilyPlus({ ...mf, transaction: "CONSTRUCTION" }, rates).quotes.some((q) => q.id.startsWith("DSCR"))).toBe(false);
    expect(sizeMultifamilyPlus({ ...mf, assetType: "COMMERCIAL" }, rates).quotes.some((q) => q.id.startsWith("DSCR"))).toBe(false);
  });

  it("passes agency term and IO selections through", () => {
    const r = sizeMultifamilyPlus({ ...mf, agencyTermYears: 7, agencyIoYears: 2 }, rates);
    const fannie = quoteOf(r, "AGENCY_FANNIE_MAE");
    expect(fannie.termLabel).toMatch(/^7 yrs/);
    expect(fannie.amortLabel).toBe("2 yrs interest-only, then 30 years");
  });
});

const FORBIDDEN = [/\bapproved\b/i, /qualified for/i, /fees protected/i, /will call you today/i, /autonomous/i, /(?<!not )guaranteed(?! maximum)/i];

function scenarios(): SizerQuote[] {
  const c: ConstructionInputs = {
    assetType: "MULTIFAMILY", units: 80, landCost: 3e6, hardCosts: 14e6, softCosts: 2.5e6, contingencyPct: 0.05, developerFeePct: 0.03,
    gmpContract: true, constructionMonths: 18, leaseUpMonths: 6, stabilizedNoi: 1.65e6, asCompletedValue: 27.5e6, loanAmount: 15e6,
    completedProjects: 0, mezzTargetLtc: 0.8, prefTargetLtc: 0.9, cpaceAmount: 1e6,
  };
  return [
    ...sizeMultifamilyPlus({ ...mf, stabilizedNoi: 900_000, existingHud: { unpaidBalance: 12e6, originalPrincipal: 15e6, existingRatePct: 5.5, existingAnnualMip: 0.0045, remainingTermYears: 28, originalProgram: "223F", repairs: 100_000 } }, rates, { hud223a7: true }).quotes,
    ...sizeMultifamilyPlus({ ...mf, units: 3, monthlyRent: 5_000, monthlyTaxesInsuranceHoa: 900, value: 900_000, loanAmount: 600_000, noi: 45_000 }, rates).quotes,
    ...sizeConstruction(c, rates).quotes,
    ...sizeHardMoney({ strategy: "FIX_AND_FLIP", purpose: "PURCHASE", propertyType: "RESIDENTIAL_1_4", units: 1, purchasePrice: 300_000, rehabBudget: 80_000, arv: 480_000, loanAmount: 400_000, completedProjects: 0, termMonths: 6, holdMonths: 24, interestReserveMonths: 6, interestBasis: "FULL_COMMITMENT" }, rates).quotes,
    ...sizeHardMoney({ strategy: "BRIDGE", purpose: "REFINANCE", propertyType: "MULTIFAMILY", units: 12, purchasePrice: 2e6, rehabBudget: 200_000, arv: 2.6e6, loanAmount: 1.9e6, completedProjects: 6, termMonths: 24, holdMonths: 18, interestReserveMonths: 3, interestBasis: "OUTSTANDING", stabilizedNoi: 150_000 }, rates).quotes,
  ];
}

describe("copy guard across every new box", () => {
  const quotes = scenarios();

  it("covers all nine new program ids", () => {
    const ids = new Set(quotes.map((q) => q.id));
    for (const id of ["HARD_MONEY", "CONSTRUCTION_BANK", "CONSTRUCTION_DEBT_FUND", "CONSTRUCTION_PRIVATE", "AGENCY_FANNIE_MAE", "AGENCY_FREDDIE_MAC", "DSCR_INVESTOR_2_4", "DSCR_INVESTOR_5_PLUS", "HUD_223A7"]) {
      expect(ids.has(id as SizerQuote["id"])).toBe(true);
    }
  });

  it("never claims a loan is usury-exempt or overclaims", () => {
    for (const q of quotes) {
      for (const line of quoteCopy(q)) {
        expect(containsExemptionClaim(line), line).toBe(false);
        for (const re of FORBIDDEN) expect(re.test(line), `${q.id}: ${line}`).toBe(false);
      }
    }
  });

  it("qualifies every timeline (new boxes and the HUD / bridge quotes beside them) as not guaranteed", () => {
    for (const q of quotes) {
      expect(q.closeTimeline, q.id).toMatch(/after a complete file.*not guaranteed/);
    }
  });

  it("never models Corin as lender", () => {
    for (const q of quotes) {
      for (const line of quoteCopy(q)) expect(line, line).not.toMatch(/Corin (lends|funds|is the lender)|lender: Corin/i);
    }
  });
});
