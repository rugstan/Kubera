// Builds the deal context the sizer hands to the advisor ("Generate term
// sheet"). The advisor accepts only a flat record of scalar inputs (≤ 40 keys,
// key pattern below) and a capped JSON size, so nested sizer inputs such as an
// existing HUD loan are flattened with a prefix and anything else is dropped.

import type { Benchmarks } from "@/lib/rates";
import type { SizerResult } from "@/lib/sizing/programs/types";

type Scalar = number | string | boolean | null;

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_INPUTS = 40;

function scalar(v: unknown): Scalar | undefined {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 10_000) / 10_000 : undefined;
  if (typeof v === "string") return v.slice(0, 120);
  if (typeof v === "boolean") return v;
  return undefined;
}

/** Scalars kept as-is, one level of nested objects flattened to `parent_child`; at most 40 keys. */
export function flatInputs(obj: Record<string, unknown>): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  const put = (k: string, v: unknown) => {
    if (Object.keys(out).length >= MAX_INPUTS || !KEY.test(k)) return;
    const s = scalar(v);
    if (s !== undefined) out[k] = s;
  };
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) put(`${k}_${k2}`, v2);
    } else {
      put(k, v);
    }
  }
  return out;
}

const r2 = (n: number) => Number(n.toFixed(2));

export function buildDealContext(args: { vertical: string; inputs: Record<string, unknown>; result: SizerResult; benchmarks: Benchmarks }): string {
  const { result } = args;
  const best = result.quotes.find((q) => q.id === result.bestFit);
  return JSON.stringify({
    vertical: args.vertical.slice(0, 120),
    inputs: flatInputs(args.inputs),
    estimatedValue: Math.round(result.value),
    bestFit: best && {
      program: best.name.slice(0, 120),
      loanAmount: best.loanAmount,
      noteRatePct: r2(best.ratePct),
      term: best.termLabel.slice(0, 120),
      amortization: best.amortLabel.slice(0, 120),
      recourse: best.recourse,
      annualFee: { label: best.annualFee.label.slice(0, 120), amount: Math.round(best.annualFee.amount) },
      annualAudit: best.annualAudit,
      closingCosts: Math.round(best.closingCosts),
      tranches: best.tranches.slice(0, 6).map((t) => ({ label: t.label.slice(0, 120), amount: Math.round(t.amount), ratePct: r2(t.ratePct) })),
    },
    alternatives: result.quotes
      .filter((q) => q.eligible && q.id !== best?.id)
      .slice(0, 12)
      .map((q) => ({ program: q.name.slice(0, 120), loanAmount: q.loanAmount, noteRatePct: r2(q.ratePct) })),
    benchmarks: args.benchmarks,
  });
}
