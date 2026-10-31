// kubera/document.extracted → spreads → Jev re-sizing (WS-L).
//
// When an extraction finishes (or a reviewer approves one), every spread for
// its deal (or lead) is recalculated from the accepted extractions and saved
// as a new version, and the lead's intake is re-sized with Jev on the numbers
// the documents support (lib/spreads/jev.ts). The re-size is saved as a
// `jev_resize` spread row for staff. Internal analysis only: nothing is sent.
//
// `packageSpreadsFromSaved` turns the latest saved rows into the metrics the
// lenders desk and the executive-summary PDF start from (staff can override).

import { z } from "zod";
import type { DealProgram } from "@/lib/deals/types";
import type { Benchmarks } from "@/lib/rates";
import { FALLBACK_BENCHMARKS } from "@/lib/sizing/assumptions";
import type { Intake } from "@/lib/validation";
import { LENDER_PROFILE_IDS, type AssetClass, type LenderProfileId } from "./assumptions";
import type { CensusResult } from "./senior";
import type { NoiResult } from "./noi";
import type { RentRollResult } from "./rentroll";
import type { StrResult } from "./hotel";
import { profileForIntake, resizeWithSpreads } from "./jev";
import { recalculateSpreads, type SpreadServiceDeps } from "./service";
import type { SpreadRecord, SpreadStore, SpreadSubject } from "./store";

export const documentExtractedSchema = z.object({
  extractionId: z.string().uuid(),
  documentId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  docType: z.string().nullable().optional(),
  status: z.string().min(1).max(40),
});

/** Extraction statuses whose numbers feed spreads (needs_review waits for a reviewer). */
const FEEDS_SPREADS = new Set(["extracted", "approved"]);

export type SpreadSubjectInfo = {
  dealId: string | null;
  leadId: string | null;
  /** The lead's qualifier intake (what Jev re-sizes), when there is a lead. */
  intake: Intake | null;
  program: DealProgram | null;
};

export type SpreadWorkflowDeps = SpreadServiceDeps & {
  /** Resolves the deal / lead behind an extraction (deal → its lead, lead → its deal). */
  subject(input: { dealId: string | null; leadId: string | null }): Promise<SpreadSubjectInfo>;
  rates?: () => Promise<Benchmarks>;
  now: () => Date;
};

export const SPREADS_ACTOR = "agent:spreads";

/** Spread asset class from the intake, else from the deal program. */
export function assetFor(intake: Intake | null, program: DealProgram | null): AssetClass {
  if (intake) {
    if (["ASSISTED_LIVING", "MEMORY_CARE", "RCFE", "SNF", "HOTEL_TO_SENIOR_CONVERSION"].includes(intake.assetType)) return "senior";
    if (["HOTEL_FLAGGED", "HOTEL_BOUTIQUE"].includes(intake.assetType)) return "hotel";
    if (intake.assetType === "MULTIFAMILY" || intake.assetType === "RESIDENTIAL_2_4") return "multifamily";
    return "commercial";
  }
  if (program === "HUD_232") return "senior";
  if (program === "HOTEL_CMBS" || program === "PIP_BRIDGE") return "hotel";
  if (program === "HUD_MULTIFAMILY" || program === "AGENCY") return "multifamily";
  return "commercial";
}

export type DocumentExtractedResult =
  | { status: "skipped"; reason: string }
  | { status: "recalculated"; spreads: number; jev: { primaryLoanBefore: number | null; primaryLoanAfter: number | null; changes: number } | null };

export async function documentExtractedHandler(data: unknown, deps: SpreadWorkflowDeps): Promise<DocumentExtractedResult> {
  const input = documentExtractedSchema.parse(data);
  if (!FEEDS_SPREADS.has(input.status)) return { status: "skipped", reason: `extraction_${input.status}` };
  const info = await deps.subject({ dealId: input.dealId ?? null, leadId: input.leadId ?? null });
  if (!info.dealId && !info.leadId) return { status: "skipped", reason: "no_deal_or_lead" };
  const subject: SpreadSubject = { dealId: info.dealId, leadId: info.dealId ? null : info.leadId };
  const now = deps.now();
  const { bundle, saved } = await recalculateSpreads(
    deps,
    subject,
    {
      asset: assetFor(info.intake, info.program),
      asOf: now.toISOString().slice(0, 10),
      ...(info.intake?.unitCount ? { units: info.intake.unitCount } : {}),
      ...(info.intake?.value ? { value: info.intake.value } : {}),
    },
    SPREADS_ACTOR,
  );

  let jev: Extract<DocumentExtractedResult, { status: "recalculated" }>["jev"] = null;
  if (info.intake) {
    const rates = deps.rates ? await deps.rates().catch(() => FALLBACK_BENCHMARKS) : FALLBACK_BENCHMARKS;
    const r = resizeWithSpreads(info.intake, bundle, rates);
    const sources = [...new Set(Object.values(bundle.sources).flat())];
    await deps.spreads.insert({
      ...subject,
      kind: "jev_resize",
      lenderProfile: profileForIntake(info.intake),
      sourceExtractionIds: sources,
      inputs: { trigger: "document.extracted", extractionId: input.extractionId },
      results: {
        primaryLoanBefore: r.primaryLoanBefore,
        primaryLoanAfter: r.primaryLoanAfter,
        programBefore: r.before.decision.primaryProgramFit,
        programAfter: r.after.decision.primaryProgramFit,
        tierBefore: r.before.decision.leadUrgencyTier,
        tierAfter: r.after.decision.leadUrgencyTier,
        changes: r.changes.map((c) => ({ field: c.field, source: c.source, from: typeof c.from === "object" ? null : c.from, to: typeof c.to === "object" ? null : c.to })),
        rationale: r.rationale.slice(0, 20),
      },
      flags: bundle.flags,
      createdBy: SPREADS_ACTOR,
    });
    jev = { primaryLoanBefore: r.primaryLoanBefore, primaryLoanAfter: r.primaryLoanAfter, changes: r.changes.length };
  }
  return { status: "recalculated", spreads: saved.length, jev };
}

// ---------------------------------------------------------------------------
// Saved spreads → lenders desk / executive summary metrics

/** Mirrors lib/agents/lenders/package PackageSpreads (kept structural to avoid an import cycle). */
export type SavedPackageSpreads = {
  asOf: string | null;
  noiCents: number | null;
  underwrittenNoiCents: number | null;
  revenueCents: number | null;
  expensesCents: number | null;
  occupancyPct: number | null;
  units: number | null;
  unitLabel: string | null;
  adrCents: number | null;
  revparCents: number | null;
  payorMix: Record<string, number> | null;
  /** The saved rows these came from (ids), for the page to cite. */
  sourceSpreadIds: string[];
  profile: LenderProfileId | null;
};

const cents = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : null);
const pct = (f: number | null | undefined) => (typeof f === "number" && Number.isFinite(f) ? Math.round(f * 1000) / 10 : null);

/** The latest saved spread bundle for a deal (or lead) as package metrics; null when nothing is saved. */
export async function packageSpreadsFromSaved(store: SpreadStore, subject: SpreadSubject): Promise<SavedPackageSpreads | null> {
  const summary = await store.latest(subject, "deal_summary");
  if (!summary) return null;
  const s = summary.results as { quoteNoi?: { profile?: LenderProfileId } | null } | null;
  const order: LenderProfileId[] = s?.quoteNoi?.profile ? [s.quoteNoi.profile, ...LENDER_PROFILE_IDS.filter((p) => p !== s.quoteNoi!.profile)] : [...LENDER_PROFILE_IDS];
  let operating: SpreadRecord | null = null;
  for (const p of order) {
    operating = await store.latest(subject, "operating_statement", p);
    if (operating) break;
  }
  const [rentRoll, census, str] = await Promise.all([store.latest(subject, "rent_roll"), store.latest(subject, "senior_census"), store.latest(subject, "hotel_str")]);
  const noi = (operating?.results ?? null) as NoiResult | null;
  const rr = (rentRoll?.results ?? null) as RentRollResult | null;
  const cen = (census?.results ?? null) as CensusResult | null;
  const hotel = (str?.results ?? null) as StrResult | null;
  const payor = cen?.payorMixByResidents && Object.keys(cen.payorMixByResidents).length ? Object.fromEntries(Object.entries(cen.payorMixByResidents).map(([k, v]) => [k.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), Math.round((v ?? 0) * 1000) / 10])) : null;
  return {
    asOf: summary.createdAt.slice(0, 10),
    noiCents: cents(noi?.reportedNoi),
    underwrittenNoiCents: cents(noi?.underwrittenNoi),
    revenueCents: cents(noi?.underwrittenEgi),
    expensesCents: cents(noi?.underwrittenOpex),
    occupancyPct: rr ? pct(rr.physicalOccupancy) : cen ? pct(cen.occupancy) : hotel ? pct(hotel.ttm.occupancy) : null,
    units: rr?.units ?? cen?.capacity ?? (hotel ? Math.round(hotel.ttm.roomsAvailable / Math.max(1, hotel.ttm.months * 30.4)) || null : null),
    unitLabel: rr ? "units" : cen ? "beds" : hotel ? "keys" : null,
    adrCents: cents(hotel?.ttm.adr),
    revparCents: cents(hotel?.ttm.revpar),
    payorMix: payor,
    sourceSpreadIds: [summary, operating, rentRoll, census, str].filter((r): r is SpreadRecord => Boolean(r)).map((r) => r.id),
    profile: (operating?.lenderProfile as LenderProfileId | null) ?? null,
  };
}
