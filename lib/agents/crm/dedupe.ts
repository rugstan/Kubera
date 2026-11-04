// Duplicate company detection for Twenty. Pure functions over company records;
// the scan in ./handlers.ts reads pages of companies and turns clusters into
// `company_merge` proposals, which always wait for a broker.
//
// A pair is a duplicate when the evidence adds up, never on a similar name
// alone:
//   same normalized name        0.60   ("Sunrise Senior Living, LLC" = "sunrise senior living llc")
//                                      (a name alone is only listed for review: it may be two entities)
//   near-identical name         0.45   (edit distance <= 1 on names of 8+ characters)
//   same website host           0.40
//   same street address         0.30
// A pair needs 0.75 or more. Two companies with different websites
// (`domain_conflict`) or different entity types, such as an LP and an LLC with
// the same name (`entity_type_conflict`), are never merged however alike the names.

import type { CrmCompany } from "./types";

const LEGAL_SUFFIXES = new Set(["llc", "inc", "incorporated", "corp", "corporation", "co", "company", "lp", "llp", "lllp", "ltd", "limited", "pllc", "pc", "plc", "lc"]);
/** Names too generic to say anything: never matched on name. */
const GENERIC_NAMES = new Set(["", "self employed", "selfemployed", "individual", "private", "unknown", "none", "n a", "na", "test", "sample", "tbd", "various", "confidential"]);

const SUFFIX_CANON: Record<string, string> = { incorporated: "inc", corporation: "corp", company: "co", limited: "ltd", lc: "llc" };

/** The legal-entity type word at the end of a name ("llc", "lp", "inc"), canonical, or null. */
export function entityType(name: string): string | null {
  const tokens = name.toLowerCase().replace(/\./g, "").replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean);
  const last = tokens[tokens.length - 1];
  return tokens.length > 1 && last && LEGAL_SUFFIXES.has(last) ? (SUFFIX_CANON[last] ?? last) : null;
}

export function normalizeCompanyName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  let tokens = base.split(" ").filter(Boolean);
  if (tokens[0] === "the") tokens = tokens.slice(1);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens = tokens.slice(0, -1);
  return tokens.join(" ");
}

const ADDRESS_WORDS: Record<string, string> = { street: "st", avenue: "ave", boulevard: "blvd", road: "rd", drive: "dr", lane: "ln", suite: "ste", north: "n", south: "s", east: "e", west: "w", place: "pl", court: "ct", highway: "hwy" };

export function normalizeAddress(address: string | null): string | null {
  if (!address) return null;
  // The street line is the part before the first comma.
  const street = address
    .split(",")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => ADDRESS_WORDS[t] ?? t)
    .join(" ");
  return street.length >= 6 && /\d/.test(street) ? street : null;
}

export function editDistance(a: string, b: string, cap = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export const PAIR_THRESHOLD = 0.75;

export type PairVerdict = { score: number; reasons: string[]; conflict: string | null };

export function comparePair(a: CrmCompany, b: CrmCompany): PairVerdict {
  const reasons: string[] = [];
  let score = 0;
  const na = normalizeCompanyName(a.name);
  const nb = normalizeCompanyName(b.name);
  const generic = GENERIC_NAMES.has(na) || GENERIC_NAMES.has(nb) || na.length < 3 || nb.length < 3;
  if (!generic) {
    if (na === nb) {
      score += 0.6;
      reasons.push("same_name");
    } else if (na.length >= 8 && nb.length >= 8 && editDistance(na, nb, 1) <= 1) {
      score += 0.45;
      reasons.push("near_identical_name");
    }
  }
  const domainsDiffer = Boolean(a.domain && b.domain && a.domain !== b.domain);
  if (a.domain && b.domain && a.domain === b.domain) {
    score += 0.4;
    reasons.push("same_domain");
  }
  const addrA = normalizeAddress(a.address);
  const addrB = normalizeAddress(b.address);
  if (addrA && addrB && addrA === addrB) {
    score += 0.3;
    reasons.push("same_address");
  }
  const ta = entityType(a.name);
  const tb = entityType(b.name);
  if (ta && tb && ta !== tb && reasons.length) return { score: Math.min(1, score), reasons, conflict: "entity_type_conflict" };
  if (domainsDiffer && reasons.length) return { score: Math.min(1, score), reasons, conflict: "domain_conflict" };
  return { score: Math.min(1, score), reasons, conflict: null };
}

export type DuplicateProposal = { survivorId: string; duplicateId: string; score: number; reasons: string[] };

export type DuplicateScan = {
  proposals: DuplicateProposal[];
  /** Look-alikes that must not be merged, and why. */
  conflicts: { a: string; b: string; reason: string }[];
  /** Same name and nothing else: shown to staff, never proposed. */
  reviewOnly: { a: string; b: string; reasons: string[] }[];
  clusters: number;
};

/**
 * Groups companies into duplicate clusters and picks a survivor per cluster:
 * the company with the most linked records (`weight`), then the oldest, then
 * the lowest id. Every other member becomes one proposal against the survivor,
 * scored on its own evidence against the survivor, so a chain A~B~C never
 * merges A into C on B's evidence alone.
 */
export function findDuplicates(companies: CrmCompany[], weight: (companyId: string) => number = () => 0, opts: { maxProposals?: number } = {}): DuplicateScan {
  const live = companies.filter((c) => !c.deleted);
  // Blocking by first name token keeps this near-linear on a large CRM.
  const buckets = new Map<string, CrmCompany[]>();
  const keyOf = (c: CrmCompany) => normalizeCompanyName(c.name).split(" ")[0] ?? "";
  for (const c of live) {
    const k = keyOf(c);
    if (k) buckets.set(k, [...(buckets.get(k) ?? []), c]);
  }
  // Companies sharing a website host or street address are compared even when their first words differ.
  const byDomain = new Map<string, CrmCompany[]>();
  const byAddress = new Map<string, CrmCompany[]>();
  for (const c of live) {
    if (c.domain) byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), c]);
    const addr = normalizeAddress(c.address);
    if (addr) byAddress.set(addr, [...(byAddress.get(addr) ?? []), c]);
  }

  const parent = new Map<string, string>(live.map((c) => [c.id, c.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const conflicts: DuplicateScan["conflicts"] = [];
  const reviewOnly: DuplicateScan["reviewOnly"] = [];
  const seen = new Set<string>();
  const consider = (group: CrmCompany[]) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const v = comparePair(a, b);
        if (v.conflict) {
          conflicts.push({ a: a.id, b: b.id, reason: v.conflict });
          continue;
        }
        if (v.score >= PAIR_THRESHOLD) parent.set(find(a.id), find(b.id));
        else if (v.reasons.includes("same_name")) reviewOnly.push({ a: a.id, b: b.id, reasons: v.reasons });
      }
    }
  };
  for (const g of [...buckets.values(), ...byDomain.values(), ...byAddress.values()]) if (g.length > 1) consider(g);

  const groups = new Map<string, CrmCompany[]>();
  for (const c of live) groups.set(find(c.id), [...(groups.get(find(c.id)) ?? []), c]);

  const proposals: DuplicateProposal[] = [];
  let clusters = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    clusters += 1;
    const ranked = [...members].sort((a, b) => weight(b.id) - weight(a.id) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : 1));
    const survivor = ranked[0]!;
    for (const dup of ranked.slice(1)) {
      const v = comparePair(survivor, dup);
      // Evidence must hold against the survivor itself, not just through a chain.
      if (v.conflict || v.score < PAIR_THRESHOLD) continue;
      proposals.push({ survivorId: survivor.id, duplicateId: dup.id, score: Math.round(v.score * 100) / 100, reasons: v.reasons });
    }
  }
  proposals.sort((a, b) => b.score - a.score || (a.duplicateId < b.duplicateId ? -1 : 1));
  return { proposals: proposals.slice(0, opts.maxProposals ?? 25), conflicts, reviewOnly, clusters };
}
