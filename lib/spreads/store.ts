// Versioned spread records. Every calculation is a new row (version n+1); rows
// are never edited (the table's trigger refuses updates).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LenderProfileId } from "./assumptions";
import type { SpreadBundle } from "./deal";

export const SPREAD_KINDS = ["operating_statement", "quotes", "global_cash_flow", "hotel_str", "senior_census", "rent_roll", "construction_budget", "deal_summary", "jev_resize"] as const;
export type SpreadKind = (typeof SPREAD_KINDS)[number];

export type SpreadSubject = { dealId: string | null; leadId: string | null };

export type NewSpread = SpreadSubject & {
  kind: SpreadKind;
  lenderProfile: LenderProfileId | null;
  sourceExtractionIds: string[];
  inputs: Record<string, unknown>;
  results: unknown;
  flags: string[];
  createdBy: string;
};

export type SpreadRecord = NewSpread & { id: string; version: number; createdAt: string };

export interface SpreadStore {
  /** Inserts the next version for (subject, kind, profile). */
  insert(spread: NewSpread): Promise<SpreadRecord>;
  latest(subject: SpreadSubject, kind: SpreadKind, lenderProfile?: LenderProfileId | null): Promise<SpreadRecord | null>;
}

const sameSubject = (a: SpreadSubject, b: SpreadSubject) => (a.dealId ? a.dealId === b.dealId : !b.dealId && a.leadId === b.leadId);

export class MemorySpreadStore implements SpreadStore {
  readonly rows: SpreadRecord[] = [];
  async insert(s: NewSpread): Promise<SpreadRecord> {
    const prior = this.rows.filter((r) => sameSubject(r, s) && r.kind === s.kind && r.lenderProfile === s.lenderProfile);
    const rec: SpreadRecord = { ...structuredClone(s), id: globalThis.crypto.randomUUID(), version: prior.length + 1, createdAt: new Date().toISOString() };
    this.rows.push(rec);
    return structuredClone(rec);
  }
  async latest(subject: SpreadSubject, kind: SpreadKind, lenderProfile: LenderProfileId | null = null) {
    const hits = this.rows.filter((r) => sameSubject(r, subject) && r.kind === kind && r.lenderProfile === lenderProfile);
    return hits.length ? structuredClone(hits[hits.length - 1]!) : null;
  }
}

type Row = {
  id: string;
  created_at: string;
  deal_id: string | null;
  lead_id: string | null;
  kind: SpreadKind;
  version: number;
  lender_profile: LenderProfileId | null;
  source_extraction_ids: string[];
  inputs: Record<string, unknown>;
  results: unknown;
  flags: string[];
  created_by: string;
};

const fromRow = (r: Row): SpreadRecord => ({
  id: r.id,
  createdAt: r.created_at,
  dealId: r.deal_id,
  leadId: r.lead_id,
  kind: r.kind,
  version: r.version,
  lenderProfile: r.lender_profile,
  sourceExtractionIds: r.source_extraction_ids,
  inputs: r.inputs,
  results: r.results,
  flags: r.flags,
  createdBy: r.created_by,
});

export function supabaseSpreadStore(db: SupabaseClient): SpreadStore {
  const latest: SpreadStore["latest"] = async (subject, kind, lenderProfile = null) => {
    let q = db.from("spreads").select("*").eq("kind", kind);
    q = subject.dealId ? q.eq("deal_id", subject.dealId) : q.is("deal_id", null).eq("lead_id", subject.leadId);
    q = lenderProfile ? q.eq("lender_profile", lenderProfile) : q.is("lender_profile", null);
    const { data, error } = await q.order("version", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`spreads.latest: ${error.message}`);
    return data ? fromRow(data as Row) : null;
  };
  return {
    latest,
    async insert(s) {
      // Two writers may race for the same version; the unique index rejects one and it retries.
      for (let attempt = 0; attempt < 3; attempt++) {
        const prev = await latest(s, s.kind, s.lenderProfile);
        const { data, error } = await db
          .from("spreads")
          .insert({
            deal_id: s.dealId,
            lead_id: s.leadId,
            kind: s.kind,
            version: (prev?.version ?? 0) + 1,
            lender_profile: s.lenderProfile,
            source_extraction_ids: s.sourceExtractionIds,
            inputs: s.inputs,
            results: s.results,
            flags: s.flags,
            created_by: s.createdBy.slice(0, 200),
          })
          .select("*")
          .single();
        if (!error && data) return fromRow(data as Row);
        if (error && !/duplicate key/i.test(error.message)) throw new Error(`spreads.insert: ${error.message}`);
      }
      throw new Error("spreads.insert: could not allocate a version");
    },
  };
}

/** Writes one versioned row per spread in the bundle. */
export async function saveSpreadBundle(store: SpreadStore, subject: SpreadSubject, bundle: SpreadBundle, ctx: { inputs: Record<string, unknown>; createdBy: string }): Promise<SpreadRecord[]> {
  if (!subject.dealId && !subject.leadId) throw new Error("a spread needs a deal or a lead");
  const out: SpreadRecord[] = [];
  const put = async (kind: SpreadKind, results: unknown, flags: string[], sources: string[] = [], lenderProfile: LenderProfileId | null = null) =>
    out.push(await store.insert({ ...subject, kind, lenderProfile, sourceExtractionIds: sources, inputs: ctx.inputs, results, flags, createdBy: ctx.createdBy }));
  for (const [profile, res] of Object.entries(bundle.operating)) {
    if (res) await put("operating_statement", res, res.flags, bundle.sources.operating, profile as LenderProfileId);
  }
  if (bundle.quotes.length) await put("quotes", { noi: bundle.quoteNoi, quotes: bundle.quotes }, [], bundle.sources.quotes, bundle.quoteNoi?.profile ?? null);
  if (bundle.rentRoll) await put("rent_roll", bundle.rentRoll, bundle.rentRoll.flags, bundle.sources.rentRoll);
  if (bundle.census) await put("senior_census", bundle.census, bundle.census.flags, bundle.sources.census);
  if (bundle.str) await put("hotel_str", bundle.str, bundle.str.flags, bundle.sources.str);
  if (bundle.construction) await put("construction_budget", bundle.construction, bundle.construction.flags, bundle.sources.construction);
  if (bundle.globalCashFlow) await put("global_cash_flow", bundle.globalCashFlow, bundle.globalCashFlow.flags, bundle.sources.globalCashFlow);
  const allSources = [...new Set(Object.values(bundle.sources).flat())];
  await put("deal_summary", { quoteNoi: bundle.quoteNoi, kinds: out.map((r) => r.kind) }, bundle.flags, allSources);
  return out;
}
