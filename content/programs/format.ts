import { ASSUMPTIONS_REVIEWED } from "@/lib/sizing/assumptions";
import type { ProgramFact } from "./types";

/** Percent from a fraction: pct(0.8) -> "80%". */
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
/** Spread or rate already in percentage points: pts(1.4) -> "1.40". */
export const pts = (n: number) => n.toFixed(2);
/** Coverage ratio: x(1.45) -> "1.45x". */
export const x = (n: number) => `${n.toFixed(2)}x`;
/** Whole dollars: usd(5_000_000) -> "$5M"; usd(20_000) -> "$20,000". */
export const usd = (n: number) => (n >= 1_000_000 ? `$${n / 1_000_000}M` : `$${n.toLocaleString("en-US")}`);
/** Compound adjective: years(35) -> "35-year". */
export const years = (n: number) => `${n}-year`;

/** The date every fact derived from `lib/sizing/assumptions.ts` was last reviewed. */
export const AS_OF = ASSUMPTIONS_REVIEWED;

interface FactOptions {
  /**
   * Internal review flag, never rendered on public pages (the facts table states
   * one caveat for every row). Defaults to true: program rules change by notice,
   * so reviewers re-check every figure unless it is a fixed definition.
   */
  verify?: boolean;
  asOf?: string;
}

export function fact(label: string, value: string, source: string, opts: FactOptions = {}): ProgramFact {
  return { label, value, source, asOf: opts.asOf ?? AS_OF, verify: opts.verify ?? true };
}

/** Citations reused across pages. */
export const SRC = {
  hud232: "HUD Handbook 4232.1 and prior MIP schedule",
  hudMfML: "HUD Mortgagee Letter 2025-03 (Jan 2025)",
  hudMfMip: "Federal Register 2025-18379 (Sept 23, 2025)",
  sba: "SBA SOP 50 10 (confirm the revision in effect at application)",
  sbaStack: "Corin modeling of the 2026 combined 7(a) + 504 structure; confirm against SOP 50 10",
  // Public labels: they render in every facts table's source column.
  corin: "Corin sizing estimate",
  market: "Corin estimate, varies by lender",
} as const;
