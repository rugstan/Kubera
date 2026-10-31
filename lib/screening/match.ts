// Name matching used by the in-memory sanctions list (tests, local dev) and
// as a second opinion on provider results. Names are normalized (case,
// accents, punctuation, common entity suffixes) and compared token-wise with
// Jaro-Winkler so "Ivanov, Pyotr" matches "PYOTR IVANOV".

const ENTITY_SUFFIXES = new Set(["llc", "inc", "corp", "corporation", "co", "company", "ltd", "limited", "lp", "llp", "plc", "sa", "gmbh", "ag", "the", "of"]);

export function normalizeName(raw: string): string[] {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !ENTITY_SUFFIXES.has(t));
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = bHit[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Order-insensitive similarity of two names (0–1): each token of the shorter
 * name is paired with its best match in the longer one, and the score is
 * scaled down when the longer name has unmatched tokens.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeName(a);
  const tb = normalizeName(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((u, idx) => {
      if (used.has(idx)) return;
      const s = jaroWinkler(t, u);
      if (s > best) {
        best = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  const coverage = short.length / long.length;
  const score = (total / short.length) * (0.85 + 0.15 * coverage);
  return Math.round(score * 1000) / 1000;
}
