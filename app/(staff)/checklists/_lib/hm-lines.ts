// Line formats for the hard money file's scope of work and track record, so
// staff can paste from a spreadsheet: one row per line, fields separated by "|".
//   scope:  category | description | cost | weeks | licensed (yes/no)
//   track:  address | strategy | purchase date | purchase price | rehab cost | exit date | exit type | exit value | role | verified (yes/no)

import { ChecklistError } from "@/lib/checklists/service";
import { scopeLineSchema, trackRecordSchema, type ScopeLine, type TrackRecordEntry } from "@/lib/checklists/hm-underwriting";

const money = (s: string | undefined) => (s && s.trim() ? Number(s.replace(/[$,\s]/g, "")) : undefined);
const yes = (s: string | undefined) => /^(y|yes|true|1)$/i.test((s ?? "").trim());
const rows = (raw: string) =>
  raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

export function parseScopeLines(raw: string): ScopeLine[] {
  return rows(raw).map((line, i) => {
    const [category, description, cost, weeks, licensed] = line.split("|").map((p) => p.trim());
    const parsed = scopeLineSchema.safeParse({ category: category?.toLowerCase().replace(/[\s/&-]+/g, "_"), description, cost: money(cost), weeks: weeks ? Number(weeks) : undefined, licensedTrade: yes(licensed) });
    if (!parsed.success) throw new ChecklistError(`Scope of work line ${i + 1}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  });
}

export function parseTrackRecordLines(raw: string): TrackRecordEntry[] {
  return rows(raw).map((line, i) => {
    const [address, strategy, purchaseDate, purchasePrice, rehabCost, exitDate, exitType, exitValue, role, verified] = line.split("|").map((p) => p.trim());
    const parsed = trackRecordSchema.safeParse({
      address,
      strategy: strategy?.toLowerCase().replace(/[\s-]+/g, "_"),
      purchaseDate,
      purchasePrice: money(purchasePrice),
      rehabCost: money(rehabCost) ?? 0,
      exitDate: exitDate || undefined,
      exitType: exitType?.toLowerCase().replace(/[\s-]+/g, "_"),
      exitValue: money(exitValue),
      role: (role || "sponsor").toLowerCase().replace(/[\s-]+/g, "_"),
      verified: yes(verified),
    });
    if (!parsed.success) throw new ChecklistError(`Track record line ${i + 1}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  });
}

export function formatScopeLines(lines: readonly ScopeLine[]): string {
  return lines.map((l) => [l.category, l.description, l.cost, l.weeks ?? "", l.licensedTrade ? "yes" : "no"].join(" | ")).join("\n");
}

export function formatTrackRecordLines(lines: readonly TrackRecordEntry[]): string {
  return lines.map((t) => [t.address, t.strategy, t.purchaseDate, t.purchasePrice, t.rehabCost, t.exitDate ?? "", t.exitType, t.exitValue ?? "", t.role, t.verified ? "yes" : "no"].join(" | ")).join("\n");
}
