import { usd } from "@/lib/sizing/programs";
import type { ProgramQuote } from "@/lib/sizing/types";

// Pure helpers for the mobile quote carousel and the sticky results bar.

/** Viewport widths at or below this show the swipeable carousel and the results bar. */
export const MOBILE_MAX_PX = 768;

/** Index of the slide whose left edge is closest to the scroll position. */
export function nearestIndex(offsets: readonly number[], scrollLeft: number): number {
  let best = 0;
  let bestDistance = Infinity;
  offsets.forEach((offset, i) => {
    const d = Math.abs(offset - scrollLeft);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/** Keeps an index inside 0..count-1. */
export function clampIndex(i: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(i, 0), count - 1);
}

export type BestSummary = { label: string; detail: string };

/** The one-line best-fit summary shown in the sticky bar. */
export function bestSummary(best: Pick<ProgramQuote, "name" | "loanAmount" | "ratePct" | "eligible"> | undefined): BestSummary {
  if (!best || !best.eligible) return { label: "No structure fits yet", detail: "Adjust the inputs or compare every structure." };
  return { label: best.name, detail: `${usd(best.loanAmount)} at about ${best.ratePct.toFixed(2)}%` };
}
