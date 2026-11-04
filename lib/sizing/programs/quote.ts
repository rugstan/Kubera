// Shared quote assembly for the program boxes in this directory. Mirrors
// buildQuote in ../programs.ts (same fields, same ranking rules) but takes
// SizerQuote ids, constraints and term-sheet detail.

import { CONSTRAINT_COPY } from "../programs";
import type { FeeLine, Recourse, Tranche } from "../types";
import type { CapitalStack, ExitTest, SizerConstraint, SizerProgramId, SizerQuote, TermLine } from "./types";

export const SIZER_CONSTRAINT_COPY: Record<SizerConstraint, string> = {
  ...CONSTRAINT_COPY,
  LTARV: "loan-to-after-repair value",
  AS_COMPLETED_LTV: "as-completed value",
  ADVANCE: "initial advance and rehab holdback limits",
  ORIGINAL_PRINCIPAL: "original insured principal",
  REFINANCE_BASIS: "unpaid balance plus eligible costs",
  DEBT_SERVICE_TEST: "existing debt service",
};

/** Floors to the nearest $1,000, like the original sizer. */
export const floor1k = (n: number) => Math.max(0, Math.floor(n / 1_000) * 1_000);

/** Smallest finite limit and the constraint that binds; REQUESTED wins ties. */
export function bindingOf(limits: Partial<Record<SizerConstraint, number>>): { amount: number; binding: SizerConstraint } {
  let best: { amount: number; binding: SizerConstraint } = { amount: Infinity, binding: "REQUESTED" };
  for (const [k, v] of Object.entries(limits) as [SizerConstraint, number][]) {
    if (Number.isFinite(v) && v < best.amount) best = { amount: Math.max(0, v), binding: k };
  }
  return best;
}

export type SizerQuoteSpec = {
  id: SizerProgramId;
  name: string;
  short: string;
  requested: number;
  /** Final sized loan amount (already floored and limited by the box). */
  loanAmount: number;
  binding: SizerConstraint;
  tranches: Tranche[];
  annualFee?: FeeLine;
  annualAudit?: number;
  closingBreakdown: FeeLine[];
  /** NOI used for DSCR and debt yield display. */
  noi: number;
  /** Debt service the displayed DSCR is measured on (defaults to P&I plus the annual fee). */
  coverageDebtService?: number;
  /** Income the displayed debt yield is measured on (defaults to `noi`). */
  debtYieldNoi?: number;
  /** Basis for the displayed leverage ratio. */
  value: number;
  leverageBasis: "LTV" | "LTC";
  termLabel: string;
  amortLabel: string;
  recourse: Recourse;
  closeTimeline: string;
  advisoryFeePct: number;
  eligible: boolean;
  notes?: string[];
  warnings?: string[];
  equityRequired?: number;
  accent?: SizerQuote["accent"];
  horizonYears?: number;
  interim?: boolean;
  terms?: TermLine[];
  stack?: CapitalStack;
  exit?: ExitTest;
};

export function buildSizerQuote(s: SizerQuoteSpec): SizerQuote {
  const loanAmount = s.eligible ? s.loanAmount : 0;
  const tranches = loanAmount > 0 ? s.tranches : [];
  const annualPrincipalInterest = tranches.reduce((sum, t) => sum + t.annualDebtService, 0);
  const annualFee = loanAmount > 0 && s.annualFee ? s.annualFee : { label: s.annualFee?.label ?? "No guarantee fee", amount: 0 };
  const closingBreakdown = loanAmount > 0 ? s.closingBreakdown.filter((l) => l.amount > 0) : [];
  const closingCosts = closingBreakdown.reduce((sum, l) => sum + l.amount, 0);
  const annualAudit = loanAmount > 0 ? (s.annualAudit ?? 0) : 0;
  const annualAllIn = annualPrincipalInterest + annualFee.amount + annualAudit;
  const ratePct = loanAmount > 0 ? tranches.reduce((sum, t) => sum + t.ratePct * t.amount, 0) / loanAmount : 0;
  const coverageDs = s.coverageDebtService ?? annualPrincipalInterest + annualFee.amount;
  const warnings = [...(s.warnings ?? [])];
  if (s.eligible && loanAmount > 0 && loanAmount < s.requested * 0.98) {
    warnings.unshift(`Sized below request — ${SIZER_CONSTRAINT_COPY[s.binding]} limits proceeds.`);
  }
  return {
    id: s.id,
    name: s.name,
    short: s.short,
    eligible: s.eligible && loanAmount > 0,
    notes: s.notes ?? [],
    warnings,
    requested: s.requested,
    loanAmount,
    binding: s.binding,
    ratePct,
    termLabel: s.termLabel,
    amortLabel: s.amortLabel,
    recourse: s.recourse,
    tranches,
    monthlyPrincipalInterest: annualPrincipalInterest / 12,
    annualPrincipalInterest,
    annualFee,
    annualAudit,
    closingCosts,
    closingBreakdown,
    annualAllIn,
    allInRatePct: loanAmount > 0 ? (annualAllIn / loanAmount) * 100 : 0,
    dscr: loanAmount > 0 && coverageDs > 0 ? s.noi / coverageDs : 0,
    ltv: s.value > 0 ? loanAmount / s.value : 0,
    leverageBasis: s.leverageBasis,
    debtYield: loanAmount > 0 ? (s.debtYieldNoi ?? s.noi) / loanAmount : 0,
    equityRequired: s.equityRequired,
    closeTimeline: s.closeTimeline,
    estimatedAdvisoryFee: loanAmount * s.advisoryFeePct,
    accent: s.accent,
    horizonYears: s.horizonYears,
    interim: s.interim,
    terms: loanAmount > 0 ? s.terms : undefined,
    stack: loanAmount > 0 ? s.stack : undefined,
    exit: loanAmount > 0 ? s.exit : undefined,
  };
}

// Interim structures from the original sizer (they predate the `interim` field).
const LEGACY_INTERIM: ReadonlySet<SizerProgramId> = new Set(["BRIDGE_TO_HUD_232", "HOSPITALITY_PIP_BRIDGE", "WHITE_LABEL_CRE_BRIDGE"]);

export const isInterim = (q: SizerQuote) => q.interim ?? LEGACY_INTERIM.has(q.id);

/** Note rate plus annual fees, audit and closing costs spread over the loan's horizon (10 years by default). */
export function sizerCostOfFunds(q: SizerQuote): number {
  if (q.loanAmount <= 0) return Infinity;
  const horizon = Math.max(1, q.horizonYears ?? 10);
  return q.ratePct / 100 + (q.annualFee.amount + q.annualAudit + q.closingCosts / horizon) / q.loanAmount;
}

/** Same rule as pickBestFit: cheapest permanent program covering ≥95%, else cheapest interim, else largest proceeds. */
export function pickSizerBestFit(quotes: SizerQuote[]): SizerProgramId | null {
  const eligible = quotes.filter((q) => q.eligible);
  if (!eligible.length) return null;
  const full = eligible.filter((q) => q.loanAmount >= q.requested * 0.95);
  const cheapest = (qs: SizerQuote[]) => qs.reduce((a, b) => (sizerCostOfFunds(b) < sizerCostOfFunds(a) ? b : a)).id;
  const permanent = full.filter((q) => !isInterim(q));
  if (permanent.length) return cheapest(permanent);
  if (full.length) return cheapest(full);
  return eligible.reduce((a, b) => (b.loanAmount > a.loanAmount ? b : a)).id;
}

/** Largest amount ≤ hi for which `ok` holds, to $1 (ok must be monotone decreasing in the amount). */
export function maxWhere(hi: number, ok: (amount: number) => boolean): number {
  if (hi <= 0) return 0;
  if (ok(hi)) return hi;
  let lo = 0;
  while (hi - lo > 1) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m;
    else hi = m;
  }
  return lo;
}

export const ioTranche = (label: string, amount: number, ratePct: number): Tranche => ({
  label,
  amount,
  ratePct,
  amortYears: 0,
  annualDebtService: (amount * ratePct) / 100,
});

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });

export const fmt = { pct, money, ratio: (n: number) => `${n.toFixed(2)}x` };

/** Months as "18 months" / "1 month". */
export const months = (n: number) => `${n} month${n === 1 ? "" : "s"}`;
