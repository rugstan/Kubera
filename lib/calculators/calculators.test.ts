import { describe, expect, it } from "vitest";
import { AGENCY, CMBS, HUD, SBA, SPREADS, mid, FALLBACK_BENCHMARKS } from "@/lib/sizing/assumptions";
import { calcDscr, DSCR_PRESETS, validateDscr } from "./dscr";
import { multiple, parseNumber, pctOf, points, usd } from "./format";
import { calcHotelDebtYield } from "./hotel-debt-yield";
import { calcHudMip, hudMipProgram, HUD_MIP_PROGRAMS } from "./hud-mip";
import { indicativeRates } from "./rates";
import { calcSba504 } from "./sba-504";

function ok<T, K extends string>(o: { ok: true; result: T } | { ok: false; errors: Partial<Record<K, string>> }): T {
  if (!o.ok) throw new Error(`expected ok, got ${JSON.stringify(o.errors)}`);
  return o.result;
}

describe("format helpers", () => {
  it("formats currency, percentages and multiples", () => {
    expect(usd(1_234_567.8)).toBe("$1,234,568");
    expect(usd(Number.NaN)).toBe("n/a");
    expect(pctOf(0.0725, 2)).toBe("7.25%");
    expect(points(6.5)).toBe("6.50%");
    expect(multiple(1.2345)).toBe("1.23x");
  });

  it("parses typed numbers and rejects junk", () => {
    expect(parseNumber("$1,250,000")).toBe(1_250_000);
    expect(parseNumber("6.25%")).toBe(6.25);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(4)).toBe(4);
  });
});

describe("DSCR calculator", () => {
  // $1,000,000 at 6.00% over 30 years is $5,995.51 a month (standard amortization table).
  const base = { noi: 500_000, loanAmount: 5_000_000, ratePct: 6, amortYears: 30, targetDscr: 1.25 };

  it("matches a hand-built amortizing case", () => {
    const r = ok(calcDscr(base));
    expect(r.monthlyPayment).toBeCloseTo(5 * 5995.51, 0);
    expect(r.annualDebtService).toBeCloseTo(5 * 5995.51 * 12, 0);
    expect(r.dscr).toBeCloseTo(500_000 / (5 * 5995.51 * 12), 3);
    expect(r.meetsTarget).toBe(true);
    expect(r.debtYield).toBeCloseTo(0.1, 6);
  });

  it("sizes the maximum loan at the target coverage and round-trips", () => {
    const r = ok(calcDscr(base));
    expect(r.maxLoanAtTarget).toBeGreaterThan(base.loanAmount);
    const atMax = ok(calcDscr({ ...base, loanAmount: r.maxLoanAtTarget }));
    expect(atMax.dscr).toBeCloseTo(1.25, 6);
  });

  it("reports the NOI cushion and the decline to break-even", () => {
    const r = ok(calcDscr(base));
    expect(r.noiNeededForTarget).toBeCloseTo(r.annualDebtService * 1.25, 4);
    expect(r.noiCushion).toBeCloseTo(500_000 - r.noiNeededForTarget, 4);
    expect(r.noiDeclineToBreakEven).toBeCloseTo(1 - r.annualDebtService / 500_000, 6);
  });

  it("handles interest-only loans", () => {
    const r = ok(calcDscr({ noi: 450_000, loanAmount: 5_000_000, ratePct: 6, amortYears: 0, targetDscr: 1.25 }));
    expect(r.annualDebtService).toBeCloseTo(300_000, 6);
    expect(r.monthlyPayment).toBeCloseTo(25_000, 6);
    expect(r.dscr).toBeCloseTo(1.5, 6);
  });

  it("flags a loan that misses the target and adds loan-to-value when a value is given", () => {
    const r = ok(calcDscr({ ...base, noi: 380_000, value: 8_000_000 }));
    expect(r.meetsTarget).toBe(false);
    expect(r.noiCushion).toBeLessThan(0);
    expect(r.ltv).toBeCloseTo(0.625, 6);
  });

  it("rejects bad inputs field by field", () => {
    const bad = calcDscr({ noi: 0, loanAmount: -1, ratePct: 80, amortYears: 99, targetDscr: 0.5, value: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["amortYears", "loanAmount", "noi", "ratePct", "targetDscr", "value"]);
    expect(validateDscr({ ...base, noi: Number.NaN }).noi).toBeTruthy();
  });

  it("presets carry the sizer's coverage minimums", () => {
    const byId = Object.fromEntries(DSCR_PRESETS.map((p) => [p.id, p]));
    expect(byId.hud232!.targetDscr).toBe(HUD.section232.refi.minDscr);
    expect(byId["hud-mf"]!.targetDscr).toBe(HUD.multifamily.s223f.minDscr);
    expect(byId.agency!.targetDscr).toBe(AGENCY.minDscr);
    expect(byId.sba!.targetDscr).toBe(SBA.minDscr);
    expect(byId.cmbs!.targetDscr).toBe(CMBS.minDscr);
  });
});

describe("HUD MIP calculator", () => {
  it("uses the flat 0.25% MIP for multifamily programs, from assumptions", () => {
    for (const id of ["223f", "221d4"] as const) {
      const p = hudMipProgram(id);
      expect(p.annualMip).toBe(HUD.multifamily.mip.annual);
      expect(p.upfrontMip).toBe(HUD.multifamily.mip.upfront);
    }
    expect(hudMipProgram("232-refinance").annualMip).toBe(HUD.section232.refi.annualMip);
    expect(hudMipProgram("232-new-construction").annualMip).toBe(HUD.section232.newConstruction.annualMip);
    expect(HUD_MIP_PROGRAMS.every((p) => p.verify)).toBe(true);
  });

  it("computes year-one MIP on the average balance (hand-built, 223(f), $10M, 6.00%, 35 years)", () => {
    const r = ok(calcHudMip({ loanAmount: 10_000_000, program: "223f", ratePct: 6 }));
    // Payment on $1M at 6%/35y is $5,701.90/month (standard table) => $57,019 on $10M.
    expect(r.monthlyPrincipalInterest).toBeCloseTo(57_019, -1);
    // Year one: balances at the start of months 1..12 average a little under the original balance.
    expect(r.schedule[0]!.averageBalance).toBeLessThan(10_000_000);
    expect(r.schedule[0]!.averageBalance).toBeGreaterThan(9_950_000);
    expect(r.yearOneMip).toBeCloseTo(r.schedule[0]!.averageBalance * 0.0025, 6);
    expect(r.yearOneMip).toBeCloseTo(24_900, -2);
    expect(r.upfrontMip).toBeCloseTo(25_000, 6);
    expect(r.yearOneMonthlyMip).toBeCloseTo(r.yearOneMip / 12, 6);
    expect(r.monthlyPaymentWithMip).toBeCloseTo(r.monthlyPrincipalInterest + r.yearOneMonthlyMip, 6);
  });

  it("amortizes the premium: later years cost less and the schedule covers the term", () => {
    const r = ok(calcHudMip({ loanAmount: 10_000_000, program: "223f", ratePct: 6 }));
    expect(r.schedule).toHaveLength(35);
    expect(r.schedule[10]!.mip).toBeLessThan(r.schedule[0]!.mip);
    expect(r.tenYearMip).toBeCloseTo(r.schedule.slice(0, 10).reduce((s, y) => s + y.mip, 0), 6);
    expect(r.totalMip).toBeGreaterThan(r.tenYearMip);
  });

  it("charges Section 232 refinance and new construction at their own rates", () => {
    const refi = ok(calcHudMip({ loanAmount: 10_000_000, program: "232-refinance", ratePct: 6 }));
    const nc = ok(calcHudMip({ loanAmount: 10_000_000, program: "232-new-construction", ratePct: 6 }));
    expect(refi.annualMipRate).toBe(0.0065);
    expect(refi.upfrontMip).toBeCloseTo(100_000, 6);
    expect(nc.annualMipRate).toBe(0.0077);
    expect(nc.termYears).toBe(40);
    expect(refi.yearOneMip / 10_000_000).toBeGreaterThan(0.006);
  });

  it("shows coverage with and without the premium", () => {
    const r = ok(calcHudMip({ loanAmount: 10_000_000, program: "223f", ratePct: 6, noi: 900_000 }));
    expect(r.dscrBeforeMip).toBeCloseTo(900_000 / (r.monthlyPrincipalInterest * 12), 6);
    expect(r.dscrWithMip!).toBeLessThan(r.dscrBeforeMip!);
    expect(r.allInRatePct).toBeCloseTo(6 + r.mipAsRatePoints, 6);
  });

  it("states that green certification does not lower MIP", () => {
    expect(ok(calcHudMip({ loanAmount: 1_000_000, program: "223f", ratePct: 6 })).greenLowersMip).toBe(false);
  });

  it("rejects a term longer than the program allows and other bad input", () => {
    const bad = calcHudMip({ loanAmount: 0, program: "223f", ratePct: 0, termYears: 50 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["loanAmount", "ratePct", "termYears"]);
    const unknown = calcHudMip({ loanAmount: 1_000_000, program: "nope" as never, ratePct: 6 });
    expect(unknown.ok).toBe(false);
    expect(() => hudMipProgram("nope" as never)).toThrow(RangeError);
  });

  it("a shorter term gives a smaller total premium", () => {
    const long = ok(calcHudMip({ loanAmount: 10_000_000, program: "223f", ratePct: 6 }));
    const short = ok(calcHudMip({ loanAmount: 10_000_000, program: "223f", ratePct: 6, termYears: 20 }));
    expect(short.termYears).toBe(20);
    expect(short.schedule).toHaveLength(20);
    expect(short.totalMip).toBeLessThan(long.totalMip);
  });
});

describe("SBA 504 calculator", () => {
  const base = { projectCost: 10_000_000, specialPurpose: true, newBusiness: false, higherCap: false, bankRatePct: 7, cdcRatePct: 6 };

  it("splits a hotel project 50 / 35 / 15 (special-purpose property)", () => {
    const r = ok(calcSba504(base));
    expect(r.equityPct).toBeCloseTo(0.15, 10);
    expect(r.tranches[0].amount).toBeCloseTo(5_000_000, 6);
    expect(r.tranches[1].amount).toBeCloseTo(3_500_000, 6);
    expect(r.equityRequired).toBeCloseTo(1_500_000, 6);
    expect(r.capBinds).toBe(false);
    expect(r.equityAboveMinimum).toBeCloseTo(0, 6);
    expect(r.totalDebt).toBeCloseTo(8_500_000, 6);
  });

  it("adds 5 points of equity for a start-up or new construction, and 10% only for ordinary property", () => {
    expect(ok(calcSba504({ ...base, newBusiness: true })).equityPct).toBeCloseTo(0.2, 10);
    const ordinary = ok(calcSba504({ ...base, specialPurpose: false }));
    expect(ordinary.equityPct).toBeCloseTo(0.1, 10);
    expect(ordinary.tranches[1].amount).toBeCloseTo(4_000_000, 6);
  });

  it("applies the debenture cap and shows the extra equity it forces", () => {
    const r = ok(calcSba504({ ...base, projectCost: 20_000_000 }));
    expect(r.capBinds).toBe(true);
    expect(r.tranches[1].amount).toBe(SBA.cdcCap);
    // 15% minimum is $3M; bank 50% = $10M, CDC capped at $5M, so equity is $5M.
    expect(r.equityRequired).toBeCloseTo(5_000_000, 6);
    expect(r.equityAboveMinimum).toBeCloseTo(2_000_000, 6);
    const higher = ok(calcSba504({ ...base, projectCost: 20_000_000, higherCap: true }));
    expect(higher.tranches[1].amount).toBe(SBA.cdcCapGreen);
  });

  it("builds debt service from both tranches plus the ongoing debenture fees", () => {
    const r = ok(calcSba504({ ...base, noi: 1_000_000 }));
    // $1M at 7%/25y = $7,067.80/month; at 6%/25y = $6,443.01/month (standard tables).
    expect(r.tranches[0].monthlyPayment).toBeCloseTo(5 * 7067.8, 0);
    expect(r.tranches[1].monthlyPayment).toBeCloseTo(3.5 * 6443.01, 0);
    expect(r.annualDebentureFees).toBeCloseTo(3_500_000 * SBA.annualDebentureFees, 6);
    expect(r.upfrontDebentureFees).toBeCloseTo(3_500_000 * SBA.upfrontDebentureFees, 6);
    expect(r.annualAllIn).toBeCloseTo(r.annualPrincipalInterest + r.annualDebentureFees, 6);
    expect(r.dscr).toBeCloseTo(1_000_000 / r.annualAllIn, 6);
    expect(r.meetsMinimumDscr).toBe((r.dscr ?? 0) >= SBA.minDscr);
    expect(r.blendedRatePct).toBeCloseTo((5 * 7 + 3.5 * 6) / 8.5, 6);
  });

  it("rejects bad input", () => {
    const bad = calcSba504({ ...base, projectCost: 0, bankRatePct: 0, cdcRatePct: 99, noi: -5 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["bankRatePct", "cdcRatePct", "noi", "projectCost"]);
  });
});

describe("hotel debt yield calculator", () => {
  const base = { keys: 120, adr: 150, occupancyPct: 70, noi: 1_800_000, loanAmount: 15_000_000, tier: "PREMIUM_FLAG" as const, ratePct: 7 };

  it("computes RevPAR, rooms revenue and debt yield by hand", () => {
    const r = ok(calcHotelDebtYield(base));
    expect(r.revpar).toBeCloseTo(105, 10);
    expect(r.roomsRevenue).toBeCloseTo(105 * 120 * 365, 6);
    expect(r.noiPerKey).toBeCloseTo(15_000, 6);
    expect(r.debtYield).toBeCloseTo(0.12, 10);
    expect(r.loanPerKey).toBeCloseTo(125_000, 6);
    expect(r.noiToRoomsRevenue).toBeCloseTo(1_800_000 / (105 * 120 * 365), 10);
  });

  it("uses the tier floor from assumptions and flags a loan below it", () => {
    const premium = ok(calcHotelDebtYield(base));
    expect(premium.minDebtYield).toBe(CMBS.minDebtYield.PREMIUM_FLAG);
    expect(premium.meetsMinimum).toBe(true); // 12.0% vs 11.0%
    const boutique = ok(calcHotelDebtYield({ ...base, tier: "BOUTIQUE_INDEPENDENT" }));
    expect(boutique.minDebtYield).toBe(CMBS.minDebtYield.BOUTIQUE_INDEPENDENT);
    expect(boutique.meetsMinimum).toBe(false); // 12.0% vs 12.5%
    expect(boutique.maxLoanAtMinDebtYield).toBeCloseTo(1_800_000 / 0.125, 6);
    expect(boutique.noiNeededForMinDebtYield).toBeCloseTo(15_000_000 * 0.125, 6);
  });

  it("names the binding constraint among debt yield, coverage and value", () => {
    const r = ok(calcHotelDebtYield({ ...base, value: 30_000_000 }));
    expect(r.maxLoanAtMaxLtv).toBeCloseTo(30_000_000 * CMBS.maxLtv, 6);
    const limits = { DEBT_YIELD: r.maxLoanAtMinDebtYield, DSCR: r.maxLoanAtMinDscr, LTV: r.maxLoanAtMaxLtv! };
    const tightest = Math.min(...Object.values(limits));
    expect(r.maxLoan).toBeCloseTo(tightest, 6);
    expect(limits[r.bindingConstraint]).toBeCloseTo(tightest, 6);
    // With a low value, LTV binds.
    expect(ok(calcHotelDebtYield({ ...base, value: 10_000_000 })).bindingConstraint).toBe("LTV");
    // Without a value there is no LTV limit.
    expect(ok(calcHotelDebtYield(base)).maxLoanAtMaxLtv).toBeUndefined();
  });

  it("shows debt yield under a 10% NOI swing", () => {
    const r = ok(calcHotelDebtYield(base));
    expect(r.debtYieldNoiDown10).toBeCloseTo(0.108, 10);
    expect(r.debtYieldNoiUp10).toBeCloseTo(0.132, 10);
  });

  it("rejects bad input", () => {
    const bad = calcHotelDebtYield({ ...base, keys: 0, adr: -1, occupancyPct: 120, noi: 0, loanAmount: 0, ratePct: 0, tier: "X" as never, value: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["adr", "keys", "loanAmount", "noi", "occupancyPct", "ratePct", "tier", "value"]);
  });
});

describe("indicative rates", () => {
  it("adds the midpoint of each spread band to its benchmark", () => {
    const r = indicativeRates(FALLBACK_BENCHMARKS);
    expect(r.hud232).toBeCloseTo(FALLBACK_BENCHMARKS.tenYear + mid(SPREADS.hud232), 2);
    expect(r.sbaBankFirst).toBeCloseTo(FALLBACK_BENCHMARKS.fiveYear + mid(SPREADS.sbaBankFirst), 2);
    expect(r.hotelCmbs).toBeCloseTo(FALLBACK_BENCHMARKS.tenYear + mid(SPREADS.hotelCmbs), 2);
  });
});
