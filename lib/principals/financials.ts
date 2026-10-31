// Summaries of the principal financial exhibits: personal financial statement,
// schedule of real estate owned, HUD-2530 previous participation and SBA Form
// 1919 answers. Pure functions; the staff view and the lender package read them.

import { FORM_1919_QUESTIONS, type Form1919Answers, type Form1919Question, type Hud2530, type Pfs, type ReoEntry } from "./types";

const DAY = 86_400_000;
const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

export type PfsSummary = {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  /** Cash and marketable securities (retirement accounts excluded, as most lenders do). */
  liquidity: number;
  contingentLiabilities: number;
  annualIncome: number;
  ageDays: number;
  /** Older than the program's freshness window at `asOf` (default 90 days). */
  stale: boolean;
};

export function summarizePfs(pfs: Pfs, now: Date, maxAgeDays = 90): PfsSummary {
  const totalAssets = sum(pfs.assets);
  const totalLiabilities = sum(pfs.liabilities);
  const ageDays = Math.floor((now.getTime() - Date.parse(`${pfs.asOf}T00:00:00Z`)) / DAY);
  return {
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    liquidity: pfs.assets.cash + pfs.assets.marketableSecurities,
    contingentLiabilities: sum(pfs.contingentLiabilities),
    annualIncome: sum(pfs.annualIncome),
    ageDays,
    stale: ageDays > maxAgeDays,
  };
}

/** Guarantor net worth and liquidity covenants (e.g. CMBS: net worth ≥ loan amount, liquidity ≥ 10%). */
export function guarantorCovenants(summary: PfsSummary, loanAmount: number, opts: { netWorthMultiple?: number; liquidityPct?: number } = {}) {
  const netWorthMultiple = opts.netWorthMultiple ?? 1;
  const liquidityPct = opts.liquidityPct ?? 0.1;
  const requiredNetWorth = loanAmount * netWorthMultiple;
  const requiredLiquidity = loanAmount * liquidityPct;
  return {
    requiredNetWorth,
    requiredLiquidity,
    netWorthOk: summary.netWorth >= requiredNetWorth,
    liquidityOk: summary.liquidity >= requiredLiquidity,
  };
}

export type ReoSummary = {
  properties: number;
  /** Values at the principal's ownership share, owned properties only. */
  marketValue: number;
  debt: number;
  equity: number;
  annualNoi: number;
  annualDebtService: number;
  /** Aggregate DSCR of the owned portfolio; null with no debt service. */
  dscr: number | null;
  maturingWithin24Months: number;
  flags: string[];
};

export function summarizeReo(entries: readonly ReoEntry[], now: Date): ReoSummary {
  let marketValue = 0;
  let debt = 0;
  let annualNoi = 0;
  let annualDebtService = 0;
  let maturing = 0;
  const flags: string[] = [];
  const horizon = now.getTime() + 730 * DAY;
  const owned = entries.filter((e) => e.status !== "sold_last_3_years");
  for (const e of owned) {
    const share = e.ownershipPct / 100;
    marketValue += e.marketValue * share;
    debt += e.loanBalance * share;
    annualNoi += e.annualNoi * share;
    annualDebtService += e.monthlyDebtService * 12 * share;
    if (e.maturityDate && Date.parse(`${e.maturityDate}T00:00:00Z`) <= horizon) maturing += 1;
    if (e.loanBalance > e.marketValue) flags.push(`${e.address}: debt exceeds value.`);
    if (e.monthlyDebtService > 0 && e.annualNoi / (e.monthlyDebtService * 12) < 1) flags.push(`${e.address}: income does not cover debt service.`);
    if (e.inDefault) flags.push(`${e.address}: loan reported in default.`);
  }
  for (const e of entries) if (e.status === "sold_last_3_years" && e.inDefault) flags.push(`${e.address}: sold with a reported default; ask for an explanation.`);
  return {
    properties: owned.length,
    marketValue,
    debt,
    equity: marketValue - debt,
    annualNoi,
    annualDebtService,
    dscr: annualDebtService > 0 ? Math.round((annualNoi / annualDebtService) * 100) / 100 : null,
    maturingWithin24Months: maturing,
    flags,
  };
}

/** HUD-2530 items that need a written explanation (and lender/HUD review) before submission. */
export function hud2530Flags(h: Hud2530): string[] {
  const flags: string[] = [];
  if (!h.noPriorParticipation && h.projects.length === 0) flags.push("Prior participation is indicated but no projects are listed.");
  if (h.noPriorParticipation && h.projects.length > 0) flags.push("Projects are listed although no prior participation was indicated.");
  for (const p of h.projects) {
    if (p.defaultOrClaim) flags.push(`${p.projectName}: default, assignment or claim reported${p.explanation ? "" : " without an explanation"}.`);
    if (p.status === "terminated" && !p.explanation) flags.push(`${p.projectName}: participation terminated; add an explanation.`);
  }
  if (!h.certifications.noDefaultsLast10Years) flags.push("Cannot certify no defaults in the last 10 years.");
  if (!h.certifications.notDebarredOrSuspended) flags.push("Suspension, debarment or limited denial of participation reported.");
  if (!h.certifications.noUnresolvedFindings) flags.push("Unresolved HUD audit or management review findings reported.");
  return flags;
}

/** "Yes" answers on Form 1919 need an explanation and lender review (some make the loan ineligible). */
export function form1919Flags(f: Form1919Answers): { question: Form1919Question; text: string }[] {
  return (Object.keys(FORM_1919_QUESTIONS) as Form1919Question[]).filter((q) => f.answers[q]).map((q) => ({ question: q, text: FORM_1919_QUESTIONS[q] }));
}
