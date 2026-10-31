// Adapters from stored document extractions (lib/agents/documents) to the
// ratio-layer inputs. Only accepted extractions (extracted or approved) feed a
// spread; anything in review is skipped by the caller.

import type { StoredFields } from "@/lib/agents/documents/store";
import type { FieldValue } from "@/lib/agents/documents/types";
import type { BudgetLineInput, BudgetTotals } from "./construction";
import type { OperatingStatement } from "./noi";
import type { LoanQuote } from "./quotes";
import type { RentRollUnit } from "./rentroll";
import type { GuarantorCashFlow } from "./sba";
import type { CensusRow } from "./senior";
import type { StrMonth } from "./hotel";

const n = (v: FieldValue | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: FieldValue | undefined): string | null => (typeof v === "string" && v.trim() ? v : null);
const sv = (f: StoredFields, k: string) => f.scalars[k]?.value;

const T12_KEYS = [
  "months",
  "grossPotentialRent",
  "vacancyLoss",
  "lossToLease",
  "concessions",
  "badDebt",
  "otherIncome",
  "roomsRevenue",
  "foodBeverageRevenue",
  "effectiveGrossIncome",
  "realEstateTaxes",
  "insurance",
  "utilities",
  "repairsMaintenance",
  "payroll",
  "management",
  "generalAdmin",
  "marketing",
  "contractServices",
  "franchiseFees",
  "replacementReserves",
  "otherExpenses",
  "totalOperatingExpenses",
  "noi",
] as const satisfies readonly (keyof OperatingStatement)[];

export function statementFromT12(f: StoredFields): OperatingStatement {
  const out: OperatingStatement = {};
  for (const k of T12_KEYS) out[k] = n(sv(f, k));
  return out;
}

export function unitsFromRentRoll(f: StoredFields): RentRollUnit[] {
  return f.rows.map((r) => ({
    unit: String(r.values.unit ?? ""),
    unitType: s(r.values.unitType),
    beds: n(r.values.beds),
    baths: n(r.values.baths),
    sqft: n(r.values.sqft),
    status: s(r.values.status),
    marketRent: n(r.values.marketRent),
    inPlaceRent: n(r.values.inPlaceRent),
    concession: n(r.values.concession),
    balanceDue: n(r.values.balanceDue),
    leaseStart: s(r.values.leaseStart),
    leaseEnd: s(r.values.leaseEnd),
  }));
}

export function censusFromExtraction(f: StoredFields): { rows: CensusRow[]; licensedBeds: number | null; totalUnits: number | null; asOf: string | null } {
  return {
    rows: f.rows.map((r) => ({
      room: String(r.values.room ?? ""),
      careLevel: s(r.values.careLevel),
      payor: s(r.values.payor),
      status: s(r.values.status),
      monthlyRate: n(r.values.monthlyRate),
      residents: n(r.values.residents),
    })),
    licensedBeds: n(sv(f, "licensedBeds")),
    totalUnits: n(sv(f, "totalUnits")),
    asOf: s(sv(f, "asOfDate")),
  };
}

export function strFromExtraction(f: StoredFields): { months: StrMonth[]; rooms: number | null } {
  return {
    rooms: n(sv(f, "rooms")),
    months: f.rows
      .filter((r) => typeof r.values.month === "string")
      .map((r) => ({
        month: r.values.month as string,
        occupancy: n(r.values.occupancy),
        adr: n(r.values.adr),
        revpar: n(r.values.revpar),
        roomsAvailable: n(r.values.roomsAvailable),
        roomsSold: n(r.values.roomsSold),
        roomRevenue: n(r.values.roomRevenue),
        compOccupancy: n(r.values.compOccupancy),
        compAdr: n(r.values.compAdr),
        compRevpar: n(r.values.compRevpar),
      })),
  };
}

export function guarantorFromPfs(f: StoredFields, label: string): GuarantorCashFlow {
  return {
    label,
    salary: n(sv(f, "annualSalary")) ?? 0,
    otherIncome: n(sv(f, "annualOtherIncome")) ?? 0,
    personalDebtService: n(sv(f, "annualPersonalDebtService")) ?? 0,
  };
}

export function budgetFromExtraction(f: StoredFields): { lines: BudgetLineInput[]; scalars: Partial<Record<keyof Omit<BudgetTotals, "reserves">, number | null>>; gmpContract: boolean | null } {
  return {
    lines: f.rows
      .filter((r) => typeof r.values.amount === "number")
      .map((r) => ({ description: String(r.values.description ?? ""), category: (r.values.category as BudgetLineInput["category"]) ?? "hard", amount: r.values.amount as number })),
    scalars: {
      land: n(sv(f, "landCost")),
      hard: n(sv(f, "hardCosts")),
      soft: n(sv(f, "softCosts")),
      contingency: n(sv(f, "contingency")),
      developerFee: n(sv(f, "developerFee")),
      financing: n(sv(f, "financingCosts")),
      total: n(sv(f, "totalCost")),
    },
    gmpContract: typeof sv(f, "gmpContract") === "boolean" ? (sv(f, "gmpContract") as boolean) : null,
  };
}

/** A term sheet as a quote; null when the loan amount or rate is missing. */
export function quoteFromTermSheet(f: StoredFields, id: string): LoanQuote | null {
  const loanAmount = n(sv(f, "loanAmount"));
  const ratePct = n(sv(f, "interestRatePct"));
  if (loanAmount === null || ratePct === null) return null;
  const amort = n(sv(f, "amortizationYears"));
  return {
    id,
    lender: s(sv(f, "lenderName")) ?? "Lender",
    loanAmount,
    ratePct,
    amortYears: amort ?? 30,
    ...(n(sv(f, "interestOnlyMonths")) !== null ? { ioMonths: n(sv(f, "interestOnlyMonths"))! } : {}),
    ...(n(sv(f, "termMonths")) !== null ? { termMonths: n(sv(f, "termMonths"))! } : {}),
    ...(n(sv(f, "minDscr")) !== null ? { minDscr: n(sv(f, "minDscr"))! } : {}),
    ...(n(sv(f, "maxLtv")) !== null ? { maxLtv: n(sv(f, "maxLtv"))! } : {}),
    ...(n(sv(f, "minDebtYield")) !== null ? { minDebtYield: n(sv(f, "minDebtYield"))! } : {}),
  };
}
