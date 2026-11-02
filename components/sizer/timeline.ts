// The homepage sizer shows closing timelines coarsely ("about 2–3 months",
// "a few weeks") rather than as day counts, so the page never reads like a
// schedule promise. The lender-facing and staff screens keep the precise
// assumption text from lib/sizing; every string keeps its "after a complete
// file; not guaranteed" qualifier.

function daysPhrase(lo: number, hi: number): string {
  if (hi <= 45) return "a few weeks";
  const from = Math.max(1, Math.round(lo / 30));
  const to = Math.max(from, Math.round(hi / 30));
  return from === to ? `about ${from} month${from === 1 ? "" : "s"}` : `about ${from}–${to} months`;
}

/** A sizer close timeline with day and week ranges rounded to coarse phrases. */
export function coarseTimeline(text: string): string {
  return text
    .replace(/(\d+)\s*[–-]\s*(\d+)\s+days(?:\s*\(LEAN\))?/g, (_, lo: string, hi: string) => daysPhrase(Number(lo), Number(hi)))
    .replace(/(\d+)\s*[–-]\s*(\d+)\s+weeks/g, "a few weeks");
}
