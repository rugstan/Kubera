// Agency tiered grids: three hand-built term sheets, then grid rules.
// Rates: 5-yr 4.00%, 10-yr 4.25%; agency mid spread 1.65.

import { describe, expect, it } from "vitest";
import { AGENCY_GRID } from "./assumptions";
import { agencyGrid, agencyRate, sizeAgency, snapTerm, type AgencyInputs } from "./agency";
import { TEST_RATES as rates } from "./test-helpers";

const base: AgencyInputs = {
  residential: true,
  units: 120,
  loanAmount: 20_000_000,
  noi: 1_750_000,
  value: 29_000_000,
  transaction: "REFINANCE",
  termYears: 10,
  ioYears: 0,
  green: false,
};

describe("agency term sheet 1 — Fannie Mae DUS, 10-yr, no tier covers the request", () => {
  // Tier 2 at 4.25 + 1.65 = 5.90%: LTV 23.2M, DSCR 1.75M / 1.25 / constant(5.90%, 30) = 19,669,446.
  // Tier 3 at 5.75%: 18.85M LTV / 18.51M DSCR. Tier 4 at 5.60%: 15.95M LTV.
  // None reaches 20M, so the box takes the largest: Tier 2, DSCR-bound.
  const q = sizeAgency("FANNIE", base, rates);
  const grid = agencyGrid("FANNIE", base, rates);

  it("sizes every tier", () => {
    expect(grid.map((g) => [g.tier, Number(g.ratePct.toFixed(2)), g.binding])).toEqual([
      ["TIER_2", 5.9, "DSCR"],
      ["TIER_3", 5.75, "DSCR"],
      ["TIER_4", 5.6, "LTV"],
    ]);
    expect(grid[0]?.maxLoan).toBeCloseTo(19_669_446.31, 1);
    expect(grid[1]?.maxLoan).toBeCloseTo(18_510_917.73, 1);
    expect(grid[2]?.maxLoan).toBeCloseTo(15_950_000, 1);
  });

  it("quotes Tier 2 as Fannie Mae DUS", () => {
    expect(q.name).toBe("Fannie Mae DUS");
    expect(q.loanAmount).toBe(19_669_000);
    expect(q.binding).toBe("DSCR");
    expect(q.ratePct).toBeCloseTo(5.9, 10);
    expect(q.dscr).toBeGreaterThanOrEqual(1.25);
    expect(q.dscr).toBeLessThan(1.2501);
    expect(q.termLabel).toMatch(/^10 yrs fixed/);
    // DUS fixed costs (45,000) + 1% origination + 0.75% Corin.
    expect(q.closingCosts).toBeCloseTo(45_000 + 19_669_000 * 0.0175, 6);
  });
});

describe("agency term sheet 2 — Fannie Mae Small Loan, 7-yr, cheapest tier covers", () => {
  const i: AgencyInputs = { ...base, units: 40, loanAmount: 5_000_000, noi: 600_000, value: 10_000_000, transaction: "PURCHASE", termYears: 7 };
  // 7-yr prices off the 5-yr: Tier 4 at 4.00 + 1.65 − 0.30 = 5.35%: LTV 5.5M, DSCR 5,776,732 → covers 5M.
  const q = sizeAgency("FANNIE", i, rates);

  it("picks Tier 4 pricing because it still covers the full request", () => {
    expect(q.name).toBe("Fannie Mae Small Loan");
    expect(q.loanAmount).toBe(5_000_000);
    expect(q.binding).toBe("REQUESTED");
    expect(q.ratePct).toBeCloseTo(5.35, 10);
    expect(q.notes[0]).toMatch(/^Tier 4 pricing: up to 55% LTV at 1.55x/);
    // Small-loan third-party costs (25,000) + 1% origination + 0.75% Corin.
    expect(q.closingCosts).toBeCloseTo(25_000 + 5_000_000 * 0.0175, 6);
  });
});

describe("agency term sheet 3 — Freddie Mac Conventional Small, 5-yr full-term IO, green", () => {
  const i: AgencyInputs = { ...base, units: 60, loanAmount: 8_000_000, noi: 820_000, value: 12_000_000, termYears: 5, ioYears: 5, green: true };
  // Full-term IO: Tier 3 or lower only. Tier 3: 4.00 + 1.65 + 0.05 − 0.15 − 0.05 (5-yr) − 0.10 (green) = 5.40%,
  // LTV 0.65 × 12M = 7.8M (DSCR 9.01M). Tier 4: 5.25%, 6.6M. Neither covers 8M → Tier 3, LTV-bound.
  const q = sizeAgency("FREDDIE", i, rates);

  it("limits full-term IO to Tier 3 leverage", () => {
    const grid = agencyGrid("FREDDIE", i, rates);
    expect(grid.find((g) => g.tier === "TIER_2")?.allowed).toBe(false);
    expect(q.name).toBe("Freddie Mac Conventional Small");
    expect(q.loanAmount).toBe(7_800_000);
    expect(q.binding).toBe("LTV");
    expect(q.ratePct).toBeCloseTo(5.4, 10);
    expect(q.amortLabel).toBe("Full-term interest-only");
    expect(q.terms?.find((t) => t.label === "Interest-only payment")?.value).toBe("$35,100 / mo");
    expect(q.warnings.some((w) => /Full-term interest-only/.test(w))).toBe(true);
  });
});

describe("agency rules", () => {
  it("snaps to offered terms", () => {
    expect(snapTerm("FANNIE", 11)).toBe(10);
    expect(snapTerm("FANNIE", 25)).toBe(30);
    expect(snapTerm("FREDDIE", 15)).toBe(10);
    const q = sizeAgency("FREDDIE", { ...base, loanAmount: 8_000_000, termYears: 12 }, rates);
    expect(q.termLabel).toMatch(/^10 yrs/);
    expect(q.warnings.some((w) => /quoted at 10 years/.test(w))).toBe(true);
  });

  it("prices longer terms wider and lower leverage tighter", () => {
    expect(agencyRate("FANNIE", "TIER_2", 30, false, rates)).toBeGreaterThan(agencyRate("FANNIE", "TIER_2", 10, false, rates));
    expect(agencyRate("FANNIE", "TIER_4", 10, false, rates)).toBeLessThan(agencyRate("FANNIE", "TIER_2", 10, false, rates));
  });

  it("encodes the researched small-loan boxes", () => {
    expect(AGENCY_GRID.tiers.TIER_2).toMatchObject({ maxLtv: 0.8, minDscr: 1.25 });
    expect(AGENCY_GRID.fannie.smallLoanMax).toBe(9_000_000);
    expect([AGENCY_GRID.freddie.smallMin, AGENCY_GRID.freddie.smallMax]).toEqual([2_000_000, 10_000_000]);
    expect(AGENCY_GRID.fannie.terms[0]).toBe(5);
    expect(AGENCY_GRID.fannie.terms.at(-1)).toBe(30);
  });

  it("keeps Freddie under its $2M minimum and agency off construction, small and commercial deals", () => {
    expect(sizeAgency("FREDDIE", { ...base, loanAmount: 1_500_000, noi: 200_000, value: 3_000_000 }, rates).eligible).toBe(false);
    expect(sizeAgency("FANNIE", { ...base, transaction: "CONSTRUCTION" }, rates).eligible).toBe(false);
    expect(sizeAgency("FANNIE", { ...base, units: 4 }, rates).eligible).toBe(false);
    expect(sizeAgency("FANNIE", { ...base, residential: false }, rates).eligible).toBe(false);
  });

  it("warns below 90% occupancy", () => {
    const q = sizeAgency("FANNIE", { ...base, occupancyPct: 84 }, rates);
    expect(q.warnings.some((w) => /90% occupancy/.test(w))).toBe(true);
  });
});
