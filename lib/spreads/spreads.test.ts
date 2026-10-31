// Ratio layer against hand-built models: three fixtures per spread line. The
// document-backed lines (rent roll, census, STR, budget) start from the golden
// document fixtures in evals/documents, so these tests also prove the
// document -> extraction -> spread path end to end. Expected values were
// worked by hand (and cross-checked with an independent script), not read
// back from the implementation.

import { describe, expect, it } from "vitest";
import { censusFromExtraction, budgetFromExtraction, guarantorFromPfs, quoteFromTermSheet, statementFromT12, strFromExtraction, unitsFromRentRoll } from "./from-extraction";
import { budgetSpread, budgetTotals } from "./construction";
import { strMetrics } from "./hotel";
import { normalizeNoi } from "./noi";
import { analyzeQuote } from "./quotes";
import { normalizeRentRoll } from "./rentroll";
import { globalCashFlow } from "./sba";
import { censusMetrics, normalizeCareLevel, normalizePayor } from "./senior";
import { goldenFields } from "./test-fixtures";

const close = (a: number | null | undefined, b: number, d = 2) => expect(a).toBeCloseTo(b, d);

describe("NOI normalization", () => {
  it("multifamily T-12 under agency conventions (actual loss above the floor, expenses trended 3%)", () => {
    const r = normalizeNoi(statementFromT12(goldenFields("t12-annual-csv")), { asset: "multifamily", units: 40, profile: "AGENCY" });
    expect(r.reportedEgi).toBe(943_200);
    expect(r.underwrittenEgi).toBe(943_200);
    expect(r.economicLossPct).toBe(0.055);
    expect(r.reportedOpex).toBe(399_728);
    expect(r.underwrittenOpex).toBe(407_408);
    expect(r.reportedNoi).toBe(543_472);
    expect(r.underwrittenNoi).toBe(535_792);
    expect(r.haircutPct).toBe(0.0141);
    expect(r.lines.find((l) => l.key === "management")!.underwritten).toBe(37_728); // above the 3% floor
    expect(r.lines.find((l) => l.key === "replacementReserves")!.underwritten).toBe(10_000); // 40 x $250
  });

  it("hotel departmental statement under CMBS (3% management, 4% FF&E)", () => {
    const r = normalizeNoi(statementFromT12(goldenFields("t12-hotel-pdf")), { asset: "hotel", units: 120, profile: "CMBS" });
    expect(r.underwrittenEgi).toBe(4_920_000);
    expect(r.underwrittenOpex).toBe(3_997_972);
    expect(r.reportedNoi).toBe(1_023_200);
    expect(r.underwrittenNoi).toBe(922_028);
    expect(r.haircutPct).toBe(0.0989);
    expect(r.lines.find((l) => l.key === "replacementReserves")!.underwritten).toBe(196_800);
    expect(r.economicLossPct).toBeNull();
  });

  it("senior T-6 annualized under HUD with Prop 13 reassessed taxes, 5% management and $350/unit reserves", () => {
    const r = normalizeNoi(
      {
        months: 6,
        grossPotentialRent: 1_500_000,
        vacancyLoss: 120_000,
        otherIncome: 30_000,
        realEstateTaxes: 60_000,
        insurance: 30_000,
        payroll: 600_000,
        utilities: 45_000,
        management: 60_000,
        otherExpenses: 85_000,
      },
      { asset: "senior", units: 60, profile: "HUD", reassessedTaxes: 150_000 },
    );
    expect(r.annualizationFactor).toBe(2);
    expect(r.flags).toContain("annualized_partial_year");
    expect(r.economicLossPct).toBe(0.08);
    expect(r.underwrittenEgi).toBe(2_820_000);
    expect(r.reportedOpex).toBe(1_760_000);
    expect(r.underwrittenOpex).toBe(1_877_600);
    expect(r.reportedNoi).toBe(1_060_000);
    expect(r.underwrittenNoi).toBe(942_400);
    expect(r.haircutPct).toBe(0.1109);
    expect(r.lines.find((l) => l.key === "realEstateTaxes")!.underwritten).toBe(150_000);
    expect(r.lines.find((l) => l.key === "management")!.underwritten).toBe(141_000);
    expect(r.lines.find((l) => l.key === "replacementReserves")!.underwritten).toBe(21_000);
  });

  it("applies the vacancy floor when actual loss is below it", () => {
    const r = normalizeNoi({ grossPotentialRent: 1_000_000, vacancyLoss: 20_000, totalOperatingExpenses: 400_000 }, { asset: "multifamily", units: 0, profile: "HUD" });
    expect(r.economicLossPct).toBe(0.07);
    expect(r.underwrittenEgi).toBe(930_000);
    expect(r.flags).toContain("expense_detail_missing");
  });
});

describe("quotes at each lender's constant", () => {
  const noi = 535_792;
  const value = 9_000_000;

  it("agency 30-year amortizing quote; DSCR binds", () => {
    const q = analyzeQuote(noi, value, { id: "a", lender: "Agency", loanAmount: 6_000_000, ratePct: 6, amortYears: 30, ioMonths: 24, minDscr: 1.25, maxLtv: 0.8 });
    close(q.constant, 0.071946, 6);
    close(q.annualDebtService, 431_676.38, 1);
    expect(q.dscr).toBe(1.2412);
    expect(q.ioAnnualDebtService).toBe(360_000);
    expect(q.dscrDuringIo).toBe(1.4883);
    expect(q.debtYield).toBe(0.0893);
    expect(q.ltv).toBe(0.6667);
    expect(q.maxLoanByDscr).toBe(5_957_707);
    expect(q.maxLoanByLtv).toBe(7_200_000);
    expect(q.binding).toBe("DSCR");
    expect(q.passes).toEqual({ dscr: false, ltv: true, debtYield: null });
  });

  it("HUD 35-year quote with MIP in the constant", () => {
    const q = analyzeQuote(noi, value, { id: "h", lender: "HUD", loanAmount: 7_000_000, ratePct: 5.5, amortYears: 35, annualFeePct: 0.0025, minDscr: 1.15, maxLtv: 0.87 });
    close(q.constant, 0.066942, 6);
    close(q.annualDebtService, 468_593.67, 0);
    expect(q.dscr).toBe(1.1434);
    expect(q.ltv).toBe(0.7778);
    expect(q.maxLoanByDscr).toBe(6_959_851);
    expect(q.maxLoanByLtv).toBe(7_830_000);
    expect(q.binding).toBe("DSCR");
    expect(q.passes.dscr).toBe(false);
  });

  it("interest-only bridge quote; LTV binds over debt yield", () => {
    const q = analyzeQuote(noi, value, { id: "b", lender: "Bridge", loanAmount: 7_500_000, ratePct: 8.5, amortYears: 0, minDebtYield: 0.07, maxLtv: 0.75 });
    expect(q.constant).toBe(0.085);
    expect(q.annualDebtService).toBe(637_500);
    expect(q.dscr).toBe(0.8405);
    expect(q.debtYield).toBe(0.0714);
    expect(q.maxLoanByDebtYield).toBe(7_654_171);
    expect(q.maxLoanByLtv).toBe(6_750_000);
    expect(q.binding).toBe("LTV");
    expect(q.passes).toEqual({ dscr: null, ltv: false, debtYield: true });
  });

  it("reads quotes from the golden term sheets", () => {
    const q = quoteFromTermSheet(goldenFields("term-sheet-letter"), "ts1")!;
    expect(q).toMatchObject({ lender: "Pacific Coast Bank", loanAmount: 12_500_000, ratePct: 6.25, amortYears: 30, ioMonths: 12, termMonths: 120, minDscr: 1.25, maxLtv: 0.65 });
    const b = quoteFromTermSheet(goldenFields("term-sheet-bridge-csv"), "ts2")!;
    expect(b).toMatchObject({ amortYears: 0, termMonths: 24, minDebtYield: 0.08, maxLtv: 0.7 });
  });
});

describe("SBA global cash flow", () => {
  it("one guarantor, comfortable coverage", () => {
    const r = globalCashFlow({
      business: { netIncome: 300_000, depreciation: 120_000, interestExpense: 80_000 },
      businessDebtService: { existing: 50_000, proposed: 250_000 },
      guarantors: [{ label: "G1", salary: 150_000, otherIncome: 20_000, personalDebtService: 40_000, livingExpenses: 60_000, taxes: 30_000 }],
    });
    expect(r.businessCashFlow).toBe(500_000);
    expect(r.businessDscr).toBe(1.6667);
    expect(r.personalSurplus).toBe(80_000);
    expect(r.globalCashFlow).toBe(580_000);
    expect(r.globalDebtService).toBe(340_000);
    expect(r.globalDscr).toBe(1.7059);
    expect(r.meetsMinimum).toBe(true);
  });

  it("two guarantors, one in deficit and one on the default living allowance: fails 1.25x and the SOP floor", () => {
    const r = globalCashFlow({
      business: { netIncome: 100_000, depreciation: 50_000, interestExpense: 30_000, distributions: 40_000 },
      businessDebtService: { existing: 0, proposed: 120_000 },
      guarantors: [
        { label: "G1", salary: 90_000, personalDebtService: 24_000, taxes: 18_000 },
        { label: "G2", otherIncome: 12_000, personalDebtService: 6_000, livingExpenses: 30_000 },
      ],
    });
    expect(r.businessCashFlow).toBe(140_000);
    expect(r.businessDscr).toBe(1.1667);
    expect(r.guarantors.map((g) => g.surplus)).toEqual([36_000, -18_000]);
    expect(r.globalCashFlow).toBe(158_000);
    expect(r.globalDebtService).toBe(150_000);
    expect(r.globalDscr).toBe(1.0533);
    expect(r.meetsMinimum).toBe(false);
    expect(r.meetsSopMinimum).toBe(false);
    expect(r.flags).toContain("living_expenses_defaulted:G1");
  });

  it("guarantor taken from the golden PFS", () => {
    const g = guarantorFromPfs(goldenFields("pfs-413-csv"), "Guarantor 1");
    expect(g).toEqual({ label: "Guarantor 1", salary: 220_000, otherIncome: 30_000, personalDebtService: 96_000 });
    const r = globalCashFlow({
      business: { netIncome: 400_000, depreciation: 150_000, amortization: 10_000, interestExpense: 90_000, nonRecurringAddBacks: 25_000 },
      businessDebtService: { existing: 100_000, proposed: 350_000 },
      guarantors: [g],
    });
    expect(r.businessCashFlow).toBe(675_000);
    expect(r.businessDscr).toBe(1.5);
    expect(r.personalSurplus).toBe(214_000);
    expect(r.globalCashFlow).toBe(889_000);
    expect(r.globalDebtService).toBe(546_000);
    expect(r.globalDscr).toBe(1.6282);
  });
});

describe("hotel STR metrics", () => {
  it("twelve months of ratios vs. comp set", () => {
    const s = strFromExtraction(goldenFields("str-monthly-csv"));
    const r = strMetrics(s.months, s.rooms!);
    expect(r.ttm).toMatchObject({ months: 12, roomsAvailable: 36_500, roomsSold: 27_375, roomRevenue: 4_106_250, occupancy: 0.75, adr: 150, revpar: 112.5 });
    expect(r.ttm.comp).toEqual({ occupancy: 0.7, adr: 140, revpar: 98 });
    expect([r.ttm.mpi, r.ttm.ari, r.ttm.rgi]).toEqual([107.1, 107.1, 114.8]);
    expect(r.flags).toEqual([]);
  });

  it("twenty-four months of supply and demand: trailing twelve and RevPAR growth", () => {
    const s = strFromExtraction(goldenFields("str-supply-demand-xlsx"));
    const r = strMetrics(s.months, s.rooms!);
    expect(r.firstMonth).toBe("2025-01");
    expect(r.lastMonth).toBe("2025-12");
    expect(r.ttm).toMatchObject({ roomsAvailable: 28_800, roomsSold: 21_600, roomRevenue: 2_808_000, occupancy: 0.75, adr: 130, revpar: 97.5 });
    expect(r.prior).toMatchObject({ occupancy: 0.7, adr: 120, revpar: 84 });
    expect(r.revparGrowth).toBe(0.1607);
    expect(r.flags).toContain("comp_set_missing");
  });

  it("three months weighted by room nights (not averaged ratios)", () => {
    const s = strFromExtraction(goldenFields("str-quarter-pdf"));
    const r = strMetrics(s.months, s.rooms!);
    expect(r.ttm).toMatchObject({ roomsAvailable: 4_600, roomsSold: 3_608, roomRevenue: 713_675, occupancy: 0.7842, adr: 197.83, revpar: 155.15 });
    expect(r.ttm.comp).toEqual({ occupancy: 0.7571, adr: 188.91, revpar: 143.02 });
    expect([r.ttm.mpi, r.ttm.ari, r.ttm.rgi]).toEqual([103.6, 104.7, 108.5]);
    expect(r.flags).toContain("fewer_than_12_months");
  });
});

describe("senior census and payor mix", () => {
  it("assisted living / memory care on licensed beds", () => {
    const c = censusFromExtraction(goldenFields("census-al-csv"));
    const r = censusMetrics(c.rows, { licensedBeds: c.licensedBeds, totalUnits: c.totalUnits });
    expect(r).toMatchObject({ capacity: 12, capacityBasis: "licensed_beds", occupied: 10, occupancy: 0.8333, monthlyRevenue: 63_000, annualizedRevenue: 756_000 });
    expect(r.payorMixByResidents).toEqual({ PRIVATE: 0.6, MEDICAID: 0.2, LTC_INSURANCE: 0.1, VA: 0.1 });
    expect(r.payorMixByRevenue).toEqual({ PRIVATE: 0.6429, MEDICAID: 0.127, LTC_INSURANCE: 0.119, VA: 0.1111 });
    expect(r.avgRateByPayor).toEqual({ PRIVATE: 6750, MEDICAID: 4000, LTC_INSURANCE: 7500, VA: 7000 });
    expect(r.byCareLevel).toEqual([
      { careLevel: "AL", units: 7, occupied: 6, avgMonthlyRate: 5416.67 },
      { careLevel: "MC", units: 5, occupied: 4, avgMonthlyRate: 7625 },
    ]);
    expect(r.flags).toEqual(["below_hud_232_stabilized_occupancy"]);
  });

  it("skilled nursing on units, Medicaid-heavy", () => {
    const c = censusFromExtraction(goldenFields("census-snf-xlsx"));
    const r = censusMetrics(c.rows, { licensedBeds: c.licensedBeds, totalUnits: c.totalUnits });
    expect(r).toMatchObject({ capacity: 8, capacityBasis: "units", occupied: 7, occupancy: 0.875, monthlyRevenue: 74_000 });
    expect(r.payorMixByResidents).toEqual({ MEDICARE: 0.1429, MEDICAID: 0.5714, MANAGED_CARE: 0.1429, PRIVATE: 0.1429 });
    expect(r.payorMixByRevenue).toEqual({ MEDICARE: 0.2027, MEDICAID: 0.4865, MANAGED_CARE: 0.1622, PRIVATE: 0.1486 });
    expect(r.byCareLevel).toEqual([{ careLevel: "SNF", units: 8, occupied: 7, avgMonthlyRate: 10_571.43 }]);
    expect(r.flags.sort()).toEqual(["medicaid_concentration", "private_pay_below_30pct"]);
  });

  it("memory care with shared rooms counts residents against licensed beds", () => {
    const c = censusFromExtraction(goldenFields("census-mc-pdf"));
    const r = censusMetrics(c.rows, { licensedBeds: c.licensedBeds, totalUnits: c.totalUnits });
    expect(r).toMatchObject({ capacity: 6, occupied: 4, occupancy: 0.6667, monthlyRevenue: 26_500 });
    expect(r.payorMixByResidents).toEqual({ PRIVATE: 0.75, MEDICAID: 0.25 });
    expect(r.payorMixByRevenue).toEqual({ PRIVATE: 0.8113, MEDICAID: 0.1887 });
    expect(r.avgRateByPayor).toEqual({ PRIVATE: 10_750, MEDICAID: 5_000 });
    expect(r.byCareLevel).toEqual([{ careLevel: "MC", units: 4, occupied: 3, avgMonthlyRate: 8833.33 }]);
  });

  it("normalizes care levels and payors", () => {
    expect(["Independent Living", "Assisted", "Alzheimer's", "Skilled", "RCFE"].map(normalizeCareLevel)).toEqual(["IL", "AL", "MC", "SNF", "AL"]);
    expect(["Medi-Cal", "Medicare A", "VA Aid", "LTCi", "Private Pay", "Vacant", "HMO"].map(normalizePayor)).toEqual(["MEDICAID", "MEDICARE", "VA", "LTC_INSURANCE", "PRIVATE", "VACANT", "MANAGED_CARE"]);
  });
});

describe("rent roll normalization", () => {
  it("ten units: loss to lease, vacancy, concessions, delinquency, expirations and unit mix", () => {
    const r = normalizeRentRoll(unitsFromRentRoll(goldenFields("rent-roll-csv")), { asOf: "2026-09-30" });
    expect(r).toMatchObject({
      units: 10,
      occupiedUnits: 8,
      physicalOccupancy: 0.8,
      grossPotentialRent: 237_600,
      inPlaceRent: 187_200,
      lossToLease: 7_200,
      lossToLeasePct: 0.037,
      vacancyLoss: 43_200,
      concessions: 1_800,
      nonRevenueUnits: 1,
      economicOccupancy: 0.7803,
      expiringNext12Months: 7,
      monthToMonth: 1,
    });
    expect(r.delinquency).toEqual({ totalBalance: 1_250, units: 2, pctOfMonthlyRent: 0.0801 });
    expect(r.unitMix).toEqual([
      { type: "1x1", units: 3, occupied: 2, avgSqft: 650, avgMarketRent: 1500, avgInPlaceRent: 1475, lossToLeasePct: 0.0167 },
      { type: "2x1", units: 2, occupied: 2, avgSqft: 900, avgMarketRent: 1900, avgInPlaceRent: 1825, lossToLeasePct: 0.0395 },
      { type: "2x2", units: 3, occupied: 2, avgSqft: 1000, avgMarketRent: 2100, avgInPlaceRent: 1975, lossToLeasePct: 0.0595 },
      { type: "3x2", units: 2, occupied: 2, avgSqft: 1200, avgMarketRent: 2600, avgInPlaceRent: 2525, lossToLeasePct: 0.0288 },
    ]);
    expect(r.flags.sort()).toEqual(["delinquency_above_5pct", "physical_occupancy_below_85pct"]);
    expect(r.rentControl).toBeNull();
  });

  it("down and employee units are non-revenue and counted in vacancy loss", () => {
    const f = goldenFields("rent-roll-xlsx");
    const r = normalizeRentRoll(unitsFromRentRoll(f), { asOf: String(f.scalars.asOfDate!.value) });
    expect(r).toMatchObject({
      units: 6,
      occupiedUnits: 3,
      physicalOccupancy: 0.5,
      grossPotentialRent: 122_400,
      inPlaceRent: 54_600,
      lossToLease: 1_800,
      lossToLeasePct: 0.0319,
      vacancyLoss: 66_000,
      nonRevenueUnits: 2,
      economicOccupancy: 0.4461,
      expiringNext12Months: 3,
      monthToMonth: 0,
    });
    expect(r.delinquency).toEqual({ totalBalance: 500, units: 1, pctOfMonthlyRent: 0.1099 });
    expect(r.unitMix.map((m) => [m.type, m.units, m.occupied, m.avgInPlaceRent, m.lossToLeasePct])).toEqual([
      ["0x1", 1, 1, 1150, 0.0417],
      ["1x1", 2, 1, 1500, 0],
      ["2x2", 3, 1, 1900, 0.05],
    ]);
  });

  it("text-layer PDF rent roll, with the City of Los Angeles RSO capping loss-to-lease recovery", () => {
    const pdf = normalizeRentRoll(unitsFromRentRoll(goldenFields("rent-roll-pdf")), { asOf: "2026-03-31" });
    expect(pdf).toMatchObject({ units: 4, physicalOccupancy: 0.75, grossPotentialRent: 93_600, inPlaceRent: 69_600, lossToLease: 2_400, lossToLeasePct: 0.0333, vacancyLoss: 21_600, economicOccupancy: 0.7436, expiringNext12Months: 3 });
    expect(pdf.unitMix.map((m) => [m.type, m.units, m.occupied, m.avgInPlaceRent, m.lossToLeasePct])).toEqual([
      ["2x1", 3, 2, 1750, 0.0278],
      ["3x2", 1, 1, 2300, 0.0417],
    ]);

    // Oak Terrace placed in the City of Los Angeles, built 1965: RSO 3% for Jul 2026-Jun 2027.
    const la = normalizeRentRoll(unitsFromRentRoll(goldenFields("rent-roll-csv")), {
      asOf: "2026-09-30",
      rentControl: { state: "CA", city: "Los Angeles", county: "Los Angeles", unincorporated: false, yearBuilt: 1965, ownerType: "llc" },
    });
    expect(la.rentControl?.regime).toBe("local_ordinance");
    expect(la.rentControl?.annualCapPct).toBe(3);
    expect(la.rentControl?.recoverableLossToLeasePerYear).toBe(5_616); // min(7,200, 187,200 x 3%)
    expect(la.flags).toEqual(expect.arrayContaining(["local_rent_control", "loss_to_lease_capped_by_rent_control"]));
  });
});

describe("construction budget", () => {
  it("line-item development budget: LTC, LTV, debt yield on cost, thin contingency", () => {
    const b = budgetFromExtraction(goldenFields("budget-lines-csv"));
    const totals = budgetTotals(b.lines, b.scalars);
    expect(totals).toEqual({ land: 3_000_000, hard: 16_000_000, soft: 1_800_000, contingency: 900_000, developerFee: 600_000, financing: 1_400_000, reserves: 0, total: 23_700_000 });
    const r = budgetSpread(totals, { loanAmount: 16_590_000, asCompletedValue: 30_000_000, stabilizedNoi: 1_900_000, maxLtc: 0.65, gmpContract: b.gmpContract });
    expect(r).toMatchObject({ contingencyPctOfHard: 0.0563, softPctOfHard: 0.1125, developerFeePctOfHardSoft: 0.0337, ltc: 0.7, ltv: 0.553, debtYieldOnCost: 0.0802, loanAtMaxLtc: 15_405_000 });
    expect(r.flags).toEqual(["contingency_below_minimum"]);
  });

  it("sources-and-uses summary with a GMP contract: contingency and developer fee within lender limits", () => {
    const b = budgetFromExtraction(goldenFields("budget-summary-xlsx"));
    expect(b.gmpContract).toBe(true);
    const totals = budgetTotals(b.lines, b.scalars);
    expect(totals).toEqual({ land: 2_000_000, hard: 8_000_000, soft: 1_200_000, contingency: 800_000, developerFee: 460_000, financing: 540_000, reserves: 0, total: 13_000_000 });
    const r = budgetSpread(totals, { loanAmount: 9_100_000, gmpContract: true });
    expect(r).toMatchObject({ contingencyPctOfHard: 0.1, softPctOfHard: 0.15, developerFeePctOfHardSoft: 0.05, ltc: 0.7 });
    expect(r.flags).toEqual([]);
  });

  it("PIP budget: no land, contingency just above the no-GMP minimum", () => {
    const b = budgetFromExtraction(goldenFields("budget-pip-pdf"));
    const totals = budgetTotals(b.lines, b.scalars);
    expect(totals).toEqual({ land: 0, hard: 3_900_000, soft: 150_000, contingency: 400_000, developerFee: 0, financing: 0, reserves: 0, total: 4_450_000 });
    const r = budgetSpread(totals, { gmpContract: b.gmpContract });
    expect(r).toMatchObject({ contingencyPctOfHard: 0.1026, softPctOfHard: 0.0385, developerFeePctOfHardSoft: 0 });
    expect(r.flags).toEqual(["land_missing"]);
  });
});
