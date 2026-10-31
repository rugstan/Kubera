// NOI normalization: the reported operating statement restated the way a
// lender underwrites it (vacancy floor, management fee floor, replacement
// reserves or FF&E, other-income haircut, trended expenses, reassessed taxes).

import { profileFor, type AssetClass, type LenderProfileId } from "./assumptions";

export type OperatingStatement = {
  /** Months the figures cover; partial years are annualized. */
  months?: number | null;
  grossPotentialRent?: number | null;
  vacancyLoss?: number | null;
  lossToLease?: number | null;
  concessions?: number | null;
  badDebt?: number | null;
  otherIncome?: number | null;
  roomsRevenue?: number | null;
  foodBeverageRevenue?: number | null;
  effectiveGrossIncome?: number | null;
  realEstateTaxes?: number | null;
  insurance?: number | null;
  utilities?: number | null;
  repairsMaintenance?: number | null;
  payroll?: number | null;
  management?: number | null;
  generalAdmin?: number | null;
  marketing?: number | null;
  contractServices?: number | null;
  franchiseFees?: number | null;
  replacementReserves?: number | null;
  otherExpenses?: number | null;
  totalOperatingExpenses?: number | null;
  noi?: number | null;
};

export type NoiOptions = {
  asset: AssetClass;
  /** Units, beds or keys (reserves per unit). */
  units: number;
  profile: LenderProfileId;
  /** Year-one taxes after a sale reassessment (lib/rules/california/prop13); used when higher than reported. */
  reassessedTaxes?: number | null;
};

export type NoiLine = { key: string; label: string; reported: number; underwritten: number; note?: string };

export type NoiResult = {
  profile: LenderProfileId;
  annualizationFactor: number;
  lines: NoiLine[];
  reportedEgi: number;
  underwrittenEgi: number;
  reportedOpex: number;
  underwrittenOpex: number;
  reportedNoi: number;
  underwrittenNoi: number;
  /** 1 - underwritten / reported. */
  haircutPct: number;
  /** Economic loss applied, as a share of gross potential rent (null for hotels / no GPR). */
  economicLossPct: number | null;
  flags: string[];
};

const v = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const has = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

const EXPENSE_LINES: [keyof OperatingStatement, string][] = [
  ["realEstateTaxes", "Real estate taxes"],
  ["insurance", "Insurance"],
  ["utilities", "Utilities"],
  ["repairsMaintenance", "Repairs & maintenance"],
  ["payroll", "Payroll"],
  ["generalAdmin", "General & administrative"],
  ["marketing", "Marketing"],
  ["contractServices", "Contract services"],
  ["franchiseFees", "Franchise fees"],
  ["otherExpenses", "Other expenses"],
];

export function normalizeNoi(s: OperatingStatement, o: NoiOptions): NoiResult {
  const p = profileFor(o.profile, o.asset);
  const flags: string[] = [];
  const months = s.months && s.months > 0 && s.months <= 12 ? s.months : 12;
  const k = 12 / months;
  if (months < 12) flags.push("annualized_partial_year");
  const lines: NoiLine[] = [];
  const line = (key: string, label: string, reported: number, underwritten: number, note?: string) => {
    lines.push({ key, label, reported: r2(reported), underwritten: r2(underwritten), ...(note ? { note } : {}) });
  };

  // --- Revenue ---------------------------------------------------------------------------
  let reportedEgi: number;
  let underwrittenEgi: number;
  let economicLossPct: number | null = null;
  let totalRevenueForFfe = 0;
  if (o.asset === "hotel") {
    const rooms = v(s.roomsRevenue) * k;
    const fb = v(s.foodBeverageRevenue) * k;
    const other = v(s.otherIncome) * k;
    const reported = has(s.roomsRevenue) || has(s.foodBeverageRevenue) ? rooms + fb + other : v(s.effectiveGrossIncome) * k;
    if (!has(s.roomsRevenue) && !has(s.foodBeverageRevenue)) flags.push("hotel_departments_missing");
    const otherUw = other * (1 - p.otherIncomeHaircutPct);
    reportedEgi = reported;
    underwrittenEgi = has(s.roomsRevenue) || has(s.foodBeverageRevenue) ? rooms + fb + otherUw : reported;
    totalRevenueForFfe = underwrittenEgi;
    if (has(s.roomsRevenue)) line("roomsRevenue", "Rooms revenue", rooms, rooms);
    if (has(s.foodBeverageRevenue)) line("foodBeverageRevenue", "Food & beverage revenue", fb, fb);
    if (has(s.otherIncome)) line("otherIncome", "Other income", other, otherUw, p.otherIncomeHaircutPct ? `${p.otherIncomeHaircutPct * 100}% of other income excluded` : undefined);
  } else if (has(s.grossPotentialRent)) {
    const gpr = v(s.grossPotentialRent) * k;
    const loss = (v(s.vacancyLoss) + v(s.lossToLease) + v(s.concessions) + v(s.badDebt)) * k;
    const other = v(s.otherIncome) * k;
    const actualLossPct = gpr > 0 ? loss / gpr : 0;
    economicLossPct = Math.max(actualLossPct, p.vacancyFloorPct);
    const lossUw = gpr * economicLossPct;
    const otherUw = other * (1 - p.otherIncomeHaircutPct);
    reportedEgi = gpr - loss + other;
    underwrittenEgi = gpr - lossUw + otherUw;
    line("grossPotentialRent", "Gross potential rent", gpr, gpr);
    line(
      "economicLoss",
      "Vacancy, loss to lease, concessions & credit loss",
      -loss,
      -lossUw,
      economicLossPct > actualLossPct ? `${r2(p.vacancyFloorPct * 100)}% floor applied (actual ${r2(actualLossPct * 100)}%)` : undefined,
    );
    if (has(s.otherIncome)) line("otherIncome", "Other income", other, otherUw, p.otherIncomeHaircutPct ? `${p.otherIncomeHaircutPct * 100}% of other income excluded` : undefined);
  } else {
    reportedEgi = v(s.effectiveGrossIncome) * k;
    underwrittenEgi = reportedEgi;
    flags.push("gross_potential_rent_missing");
    line("effectiveGrossIncome", "Effective gross income", reportedEgi, underwrittenEgi, "no rent detail; vacancy floor not testable");
  }
  if (o.asset !== "hotel") totalRevenueForFfe = underwrittenEgi;

  // --- Expenses --------------------------------------------------------------------------
  let reportedOpex = 0;
  let underwrittenOpex = 0;
  const itemized = EXPENSE_LINES.some(([key]) => has(s[key] as number | null | undefined));
  if (itemized) {
    for (const [key, label] of EXPENSE_LINES) {
      if (!has(s[key] as number | null | undefined)) continue;
      const rep = v(s[key] as number) * k;
      let uw = rep;
      let note: string | undefined;
      if (key === "realEstateTaxes") {
        if (has(o.reassessedTaxes) && v(o.reassessedTaxes) > rep) {
          uw = v(o.reassessedTaxes);
          note = "reassessed taxes after sale";
        }
      } else if (p.expenseTrendPct) {
        uw = rep * (1 + p.expenseTrendPct);
        note = `trended ${r2(p.expenseTrendPct * 100)}%`;
      }
      reportedOpex += rep;
      underwrittenOpex += uw;
      line(key, label, rep, uw, note);
    }
  } else {
    // Only a total: take it less management and reserves (re-underwritten below).
    const total = v(s.totalOperatingExpenses) * k;
    const rest = Math.max(0, total - v(s.management) * k - v(s.replacementReserves) * k);
    reportedOpex += rest;
    underwrittenOpex += rest * (1 + p.expenseTrendPct);
    line("operatingExpenses", "Operating expenses (total only)", rest, rest * (1 + p.expenseTrendPct), "no expense detail");
    flags.push("expense_detail_missing");
    if (has(o.reassessedTaxes)) flags.push("reassessed_taxes_not_applied");
  }

  const mgmtRep = v(s.management) * k;
  const mgmtUw = Math.max(mgmtRep, underwrittenEgi * p.managementFeeFloorPct);
  reportedOpex += mgmtRep;
  underwrittenOpex += mgmtUw;
  line("management", "Management fee", mgmtRep, mgmtUw, mgmtUw > mgmtRep ? `${r2(p.managementFeeFloorPct * 100)}% of EGI floor` : undefined);

  const resRep = v(s.replacementReserves) * k;
  const resFloor = o.asset === "hotel" ? totalRevenueForFfe * p.ffeReservePct : Math.max(0, o.units) * p.reservesPerUnit;
  const resUw = Math.max(resRep, resFloor);
  reportedOpex += resRep;
  underwrittenOpex += resUw;
  line(
    "replacementReserves",
    o.asset === "hotel" ? "FF&E reserve" : "Replacement reserves",
    resRep,
    resUw,
    resUw > resRep ? (o.asset === "hotel" ? `${r2(p.ffeReservePct * 100)}% of revenue` : `$${p.reservesPerUnit}/unit`) : undefined,
  );

  const reportedNoi = has(s.noi) ? v(s.noi) * k : reportedEgi - reportedOpex;
  const underwrittenNoi = underwrittenEgi - underwrittenOpex;
  if (has(s.noi) && Math.abs(reportedNoi - (reportedEgi - reportedOpex)) > Math.max(1, Math.abs(reportedNoi) * 0.01)) flags.push("reported_noi_differs_from_lines");
  return {
    profile: o.profile,
    annualizationFactor: r2(k),
    lines,
    reportedEgi: r2(reportedEgi),
    underwrittenEgi: r2(underwrittenEgi),
    reportedOpex: r2(reportedOpex),
    underwrittenOpex: r2(underwrittenOpex),
    reportedNoi: r2(reportedNoi),
    underwrittenNoi: r2(underwrittenNoi),
    haircutPct: reportedNoi > 0 ? Math.round((1 - underwrittenNoi / reportedNoi) * 10_000) / 10_000 : 0,
    economicLossPct: economicLossPct === null ? null : Math.round(economicLossPct * 10_000) / 10_000,
    flags,
  };
}
