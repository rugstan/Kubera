// Construction / PIP budget spread: hard, soft, contingency, developer fee and
// financing costs, contingency adequacy, and loan-to-cost. Pre-closing sizing
// only: Kubera has no role in construction draws.

import { CONSTRUCTION } from "@/lib/sizing/programs/assumptions";

export type BudgetLineInput = { description: string; category: "land" | "hard" | "soft" | "contingency" | "developer_fee" | "financing" | "reserve"; amount: number };

export type BudgetTotals = {
  land: number;
  hard: number;
  soft: number;
  contingency: number;
  developerFee: number;
  financing: number;
  reserves: number;
  total: number;
};

export type BudgetSpread = {
  totals: BudgetTotals;
  contingencyPctOfHard: number | null;
  softPctOfHard: number | null;
  developerFeePctOfHardSoft: number | null;
  ltc: number | null;
  ltv: number | null;
  debtYieldOnCost: number | null;
  /** Senior loan at the given LTC on total cost. */
  loanAtMaxLtc: number | null;
  flags: string[];
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function budgetTotals(lines: BudgetLineInput[], scalars: Partial<Record<keyof Omit<BudgetTotals, "reserves">, number | null>> = {}): BudgetTotals {
  const sum = (c: BudgetLineInput["category"]) => lines.filter((l) => l.category === c).reduce((s, l) => s + l.amount, 0);
  const pick = (k: keyof Omit<BudgetTotals, "reserves" | "total">, c: BudgetLineInput["category"]) => {
    const s = scalars[k];
    return typeof s === "number" ? s : sum(c);
  };
  const t = {
    land: pick("land", "land"),
    hard: pick("hard", "hard"),
    soft: pick("soft", "soft"),
    contingency: pick("contingency", "contingency"),
    developerFee: pick("developerFee", "developer_fee"),
    financing: pick("financing", "financing"),
    reserves: sum("reserve"),
  };
  const parts = t.land + t.hard + t.soft + t.contingency + t.developerFee + t.financing + t.reserves;
  return { ...t, total: typeof scalars.total === "number" ? scalars.total : parts };
}

export function budgetSpread(
  totals: BudgetTotals,
  opts: { loanAmount?: number | null; asCompletedValue?: number | null; stabilizedNoi?: number | null; maxLtc?: number | null; gmpContract?: boolean | null } = {},
): BudgetSpread {
  const flags: string[] = [];
  const contPct = totals.hard ? totals.contingency / totals.hard : null;
  const minCont = opts.gmpContract ? CONSTRUCTION.minContingencyGmp : CONSTRUCTION.minContingencyNoGmp;
  if (contPct !== null && contPct + 1e-9 < minCont) flags.push(opts.gmpContract ? "contingency_below_gmp_minimum" : "contingency_below_minimum");
  if (contPct !== null && contPct > 0.15) flags.push("contingency_above_15pct");
  const devPct = totals.hard + totals.soft ? totals.developerFee / (totals.hard + totals.soft) : null;
  if (devPct !== null && devPct > CONSTRUCTION.maxDeveloperFeePct + 1e-9) flags.push("developer_fee_above_lender_cap");
  if (!totals.land) flags.push("land_missing");
  if (opts.loanAmount && !totals.financing) flags.push("interest_reserve_not_budgeted");
  const parts = totals.land + totals.hard + totals.soft + totals.contingency + totals.developerFee + totals.financing + totals.reserves;
  if (Math.abs(parts - totals.total) > Math.max(1, totals.total * 0.005)) flags.push("total_differs_from_parts");
  return {
    totals,
    contingencyPctOfHard: contPct === null ? null : r4(contPct),
    softPctOfHard: totals.hard ? r4(totals.soft / totals.hard) : null,
    developerFeePctOfHardSoft: devPct === null ? null : r4(devPct),
    ltc: opts.loanAmount && totals.total ? r4(opts.loanAmount / totals.total) : null,
    ltv: opts.loanAmount && opts.asCompletedValue ? r4(opts.loanAmount / opts.asCompletedValue) : null,
    debtYieldOnCost: opts.stabilizedNoi && totals.total ? r4(opts.stabilizedNoi / totals.total) : null,
    loanAtMaxLtc: opts.maxLtc && totals.total ? Math.floor(opts.maxLtc * totals.total) : null,
    flags,
  };
}
