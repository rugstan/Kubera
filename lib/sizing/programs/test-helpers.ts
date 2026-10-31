// Shared fixtures for the program-box tests. Round benchmark values keep the
// hand-built term sheets in each test easy to follow.

import type { Benchmarks } from "@/lib/rates";
import type { SizerProgramId, SizerQuote, SizerResult } from "./types";

export const TEST_RATES: Benchmarks = { fiveYear: 4.0, tenYear: 4.25, sofr30: 4.0, prime: 7.0 };

export function quoteOf(r: SizerResult, id: SizerProgramId): SizerQuote {
  const q = r.quotes.find((x) => x.id === id);
  if (!q) throw new Error(`no quote ${id}`);
  return q;
}

/** Every borrower-facing string a quote carries. */
export function quoteCopy(q: SizerQuote): string[] {
  return [
    q.name,
    q.short,
    q.termLabel,
    q.amortLabel,
    q.closeTimeline,
    ...q.notes,
    ...q.warnings,
    ...(q.terms ?? []).flatMap((t) => [t.label, t.value]),
    ...(q.exit?.lines ?? []).flatMap((t) => [t.label, t.value]),
    ...(q.stack?.layers ?? []).map((l) => l.label),
  ];
}
