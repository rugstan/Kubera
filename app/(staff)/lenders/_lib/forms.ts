// Form and query-string parsing for the lenders desk (pure, so it is unit
// tested). Money is typed in dollars and stored in cents; blank optional
// fields become null.

import { dollarsToCents } from "@/lib/deals/money";
import type { PackageSpreads } from "@/lib/agents/lenders/package";
import type { ProfileOverrides } from "@/lib/agents/lenders/service";
import { assetClasses, bindingConstraints, lienPositions, prepayKinds, recourseKinds, type AssetClass, type BindingConstraint, type PrepayKind, type QuoteTerms, type Recourse } from "@/lib/agents/lenders/types";

export class FormInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormInputError";
  }
}

/** Anything with get/getAll: FormData or URLSearchParams. */
type Source = { get(name: string): FormDataEntryValue | string | null; getAll(name: string): (FormDataEntryValue | string)[] };

const str = (f: Source, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export function optNum(f: Source, k: string, label = k): number | null {
  const s = str(f, k).replace(/[,%x$\s]/gi, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new FormInputError(`${label} must be a number`);
  return n;
}

export function optInt(f: Source, k: string, label = k): number | null {
  const n = optNum(f, k, label);
  if (n === null) return null;
  if (!Number.isInteger(n)) throw new FormInputError(`${label} must be a whole number`);
  return n;
}

export function optCents(f: Source, k: string, label = k): number | null {
  const s = str(f, k);
  if (!s) return null;
  try {
    return dollarsToCents(s);
  } catch {
    throw new FormInputError(`${label} must be a dollar amount`);
  }
}

function oneOf<T extends string>(f: Source, k: string, values: readonly T[]): T | null {
  const s = str(f, k);
  return (values as readonly string[]).includes(s) ? (s as T) : null;
}

export const list = (f: Source, k: string) => f.getAll(k).filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
export const lines = (f: Source, k: string) => str(f, k).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** "5-4-3-2-1", "5/4/3", "5, 4, 3" → [5,4,3,…]. */
export function parseSchedule(raw: string): number[] {
  if (!raw.trim()) return [];
  const parts = raw.split(/[-/,\s]+/).filter(Boolean).map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 20)) throw new FormInputError("Prepayment schedule must be percentages like 5-4-3-2-1");
  return parts;
}

/** Credit-box terms (validated again by parseCreditBoxTerms). */
export function boxTermsFromForm(f: Source): Record<string, unknown> {
  return {
    label: str(f, "label"),
    programs: list(f, "programs"),
    assetClasses: list(f, "assetClasses"),
    states: [str(f, "states")],
    minLoanCents: optCents(f, "minLoan", "Minimum loan"),
    maxLoanCents: optCents(f, "maxLoan", "Maximum loan"),
    maxLtvPct: optNum(f, "maxLtvPct", "Max LTV"),
    maxLtcPct: optNum(f, "maxLtcPct", "Max LTC"),
    minDscr: optNum(f, "minDscr", "Min DSCR"),
    minDebtYieldPct: optNum(f, "minDebtYieldPct", "Min debt yield"),
    lienPositions: list(f, "lienPositions").length ? list(f, "lienPositions") : ["first"],
    recourse: oneOf(f, "recourse", recourseKinds),
    maxTermMonths: optInt(f, "maxTermMonths", "Max term"),
    maxAmortizationMonths: optInt(f, "maxAmortizationMonths", "Max amortization"),
    maxIoMonths: optInt(f, "maxIoMonths", "Max interest-only"),
    rateMinPct: optNum(f, "rateMinPct", "Rate from"),
    rateMaxPct: optNum(f, "rateMaxPct", "Rate to"),
    originationFeePct: optNum(f, "originationFeePct", "Origination"),
    brokerCompensationPct: optNum(f, "brokerCompensationPct", "Broker compensation"),
    typicalCloseDays: optInt(f, "typicalCloseDays", "Typical days to close"),
    franchiseRequirements: str(f, "franchiseRequirements") || null,
    notes: str(f, "notes") || null,
  };
}

/** Quote terms typed by staff (new quote or review of a parsed one). */
export function quoteTermsFromForm(f: Source): QuoteTerms {
  const loan = optCents(f, "loanAmount", "Loan amount");
  const rate = optNum(f, "ratePct", "Rate");
  const term = optInt(f, "termMonths", "Term");
  if (loan === null || rate === null || term === null) throw new FormInputError("Loan amount, rate and term are required");
  const amortizationMonths = optInt(f, "amortizationMonths", "Amortization");
  return {
    lenderName: str(f, "lenderName"),
    loanAmountCents: loan,
    rateType: str(f, "rateType") === "floating" ? "floating" : "fixed",
    ratePct: rate,
    indexName: str(f, "indexName") || null,
    spreadBps: optInt(f, "spreadBps", "Spread"),
    rateFloorPct: optNum(f, "rateFloorPct", "Rate floor"),
    termMonths: term,
    amortizationMonths,
    ioMonths: amortizationMonths === null ? term : (optInt(f, "ioMonths", "Interest-only months") ?? 0),
    originationFeePct: optNum(f, "originationFeePct", "Origination") ?? 0,
    lenderFeesCents: optCents(f, "lenderFees", "Lender fees") ?? 0,
    thirdPartyCostsCents: optCents(f, "thirdPartyCosts", "Third-party costs") ?? 0,
    brokerFeeCents: optCents(f, "brokerFee", "Borrower-paid broker fee") ?? 0,
    upfrontReservesCents: optCents(f, "upfrontReserves", "Upfront reserves") ?? 0,
    monthlyReservesCents: optCents(f, "monthlyReserves", "Monthly reserves") ?? 0,
    exitFeePct: optNum(f, "exitFeePct", "Exit fee") ?? 0,
    prepay: { kind: (oneOf(f, "prepayKind", prepayKinds) ?? "none") as PrepayKind, schedule: parseSchedule(str(f, "prepaySchedule")), months: optInt(f, "prepayMonths", "Prepayment months") },
    mipUpfrontPct: optNum(f, "mipUpfrontPct", "Upfront MIP") ?? 0,
    mipAnnualPct: optNum(f, "mipAnnualPct", "Annual MIP") ?? 0,
    recourse: oneOf(f, "recourse", recourseKinds) as Recourse | null,
    maxLtvPct: optNum(f, "maxLtvPct", "Max LTV"),
    minDscr: optNum(f, "minDscr", "Min DSCR"),
    minDebtYieldPct: optNum(f, "minDebtYieldPct", "Min debt yield"),
    bindingConstraint: oneOf(f, "bindingConstraint", bindingConstraints) as BindingConstraint | null,
    timelineDays: optInt(f, "timelineDays", "Days to close"),
    expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(str(f, "expiresOn")) ? str(f, "expiresOn") : null,
    notes: str(f, "notes").slice(0, 1_000) || null,
  };
}

/** Matching inputs and summary metrics from the deal-metrics form (query string or hidden fields). */
export function metricsFromSource(f: Source, dealLoanCents: number | null = null): { overrides: ProfileOverrides; spreads: PackageSpreads; holdMonths: number | null; reinvestmentRatePct: number | null } {
  const noiCents = optCents(f, "noi", "NOI");
  const valueCents = optCents(f, "value", "Value");
  const costCents = optCents(f, "cost", "Total cost");
  const loanAmountCents = optCents(f, "loan", "Loan amount");
  let ltvPct = optNum(f, "ltv", "LTV");
  let ltcPct = optNum(f, "ltc", "LTC");
  const dscr = optNum(f, "dscr", "DSCR");
  let debtYieldPct = optNum(f, "debtYield", "Debt yield");
  const overrides: ProfileOverrides = {};
  if (loanAmountCents !== null) overrides.loanAmountCents = loanAmountCents;
  const state = str(f, "state").toUpperCase();
  if (/^[A-Z]{2}$/.test(state)) overrides.propertyState = state;
  const asset = oneOf(f, "assetClass", assetClasses) as AssetClass | null;
  if (asset) overrides.assetClass = asset;
  const lien = oneOf(f, "lien", lienPositions);
  if (lien) overrides.lienPosition = lien;
  if (str(f, "nonRecourse") === "on") overrides.requiresNonRecourse = true;
  const close = optInt(f, "closeDays", "Days to close");
  if (close !== null) overrides.targetCloseDays = close;
  if (str(f, "franchise")) overrides.franchise = str(f, "franchise").slice(0, 120);
  // Ratios the deal's numbers imply, when not typed.
  const loanForRatios = loanAmountCents ?? dealLoanCents;
  if (ltvPct === null && loanForRatios && valueCents) ltvPct = Math.round((loanForRatios / valueCents) * 10_000) / 100;
  if (ltcPct === null && loanForRatios && costCents) ltcPct = Math.round((loanForRatios / costCents) * 10_000) / 100;
  if (debtYieldPct === null && loanForRatios && noiCents) debtYieldPct = Math.round((noiCents / loanForRatios) * 10_000) / 100;
  if (ltvPct !== null) overrides.ltvPct = ltvPct;
  if (ltcPct !== null) overrides.ltcPct = ltcPct;
  if (dscr !== null) overrides.dscr = dscr;
  if (debtYieldPct !== null) overrides.debtYieldPct = debtYieldPct;
  const occupancyPct = optNum(f, "occupancy", "Occupancy");
  const spreads: PackageSpreads = { noiCents, valueCents, costCents, ltvPct, ltcPct, dscr, debtYieldPct, occupancyPct };
  return { overrides, spreads, holdMonths: optInt(f, "hold", "Hold"), reinvestmentRatePct: optNum(f, "reinvest", "Reinvestment rate") };
}

/** The metric field names carried from the GET form into the submission form. */
export const METRIC_FIELDS = ["loan", "state", "assetClass", "lien", "nonRecourse", "closeDays", "franchise", "ltv", "ltc", "dscr", "debtYield", "noi", "value", "cost", "occupancy", "hold", "reinvest"] as const;

/** The saved-spread fields the desk uses (lib/spreads/workflow SavedPackageSpreads). */
export type SavedSpreadDefaults = {
  asOf: string | null;
  noiCents: number | null;
  underwrittenNoiCents: number | null;
  revenueCents: number | null;
  expensesCents: number | null;
  occupancyPct: number | null;
  units: number | null;
  unitLabel: string | null;
  adrCents: number | null;
  revparCents: number | null;
  payorMix: Record<string, number> | null;
};

/**
 * The deal-metrics query with blanks filled from the latest saved spreads
 * (lender-normalized NOI, occupancy). Anything staff typed wins.
 */
export function withSavedSpreadDefaults(query: URLSearchParams, saved: SavedSpreadDefaults | null): URLSearchParams {
  if (!saved) return query;
  const q = new URLSearchParams(query);
  const noi = saved.underwrittenNoiCents ?? saved.noiCents;
  if (!q.get("noi") && noi !== null) q.set("noi", String(Math.round(noi) / 100));
  if (!q.get("occupancy") && saved.occupancyPct !== null) q.set("occupancy", String(saved.occupancyPct));
  return q;
}

/** Package metrics: what staff typed, then the saved spreads for everything left blank. */
export function mergeSavedSpreads(typed: PackageSpreads, saved: SavedSpreadDefaults | null): PackageSpreads {
  if (!saved) return typed;
  const out: PackageSpreads = {
    asOf: saved.asOf,
    noiCents: saved.noiCents,
    underwrittenNoiCents: saved.underwrittenNoiCents,
    revenueCents: saved.revenueCents,
    expensesCents: saved.expensesCents,
    occupancyPct: saved.occupancyPct,
    units: saved.units,
    unitLabel: saved.unitLabel,
    adrCents: saved.adrCents,
    revparCents: saved.revparCents,
    payorMix: saved.payorMix,
  };
  for (const [k, v] of Object.entries(typed) as [keyof PackageSpreads, PackageSpreads[keyof PackageSpreads]][]) {
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  // A typed NOI that differs from the documents is the advisor's figure; keep the documents' normalized NOI beside it.
  return out;
}
