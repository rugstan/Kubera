// Feeds the spreads back into Jev: the intake's self-reported NOI, occupancy,
// ADR, unit count and construction budget are replaced by what the documents
// support, and the deal is re-sized with the same rules engine the sizer and
// CRM use (lib/ai/jev.ts). Internal analysis only; nothing is sent anywhere.

import { decideWithRules } from "@/lib/ai/jev";
import type { Benchmarks } from "@/lib/rates";
import { FALLBACK_BENCHMARKS } from "@/lib/sizing/assumptions";
import type { Intake } from "@/lib/validation";
import type { LenderProfileId } from "./assumptions";
import type { SpreadBundle } from "./deal";

export type IntakeChange = { field: string; from: unknown; to: unknown; source: string };

const pct100 = (f: number) => Math.round(f * 1000) / 10;

/** Which lender profile's NOI Jev should size on, from the intake's program family. */
export function profileForIntake(intake: Intake): LenderProfileId {
  if (intake.transaction === "HARD_MONEY") return "BRIDGE";
  if (["HOTEL_FLAGGED", "HOTEL_BOUTIQUE"].includes(intake.assetType)) return "CMBS";
  if (["ASSISTED_LIVING", "MEMORY_CARE", "RCFE", "SNF"].includes(intake.assetType)) return "HUD";
  if (intake.assetType === "MULTIFAMILY") return "AGENCY";
  return "BANK";
}

export function intakeFromSpreads(intake: Intake, bundle: SpreadBundle, opts: { profile?: LenderProfileId } = {}): { intake: Intake; changes: IntakeChange[] } {
  const next: Intake = structuredClone(intake);
  const changes: IntakeChange[] = [];
  const set = <K extends keyof Intake>(field: K, to: Intake[K], source: string) => {
    if (to === undefined || to === null || next[field] === to) return;
    changes.push({ field: String(field), from: next[field], to, source });
    next[field] = to;
  };

  const profile = opts.profile ?? profileForIntake(intake);
  const noi = bundle.operating[profile] ?? (bundle.quoteNoi ? bundle.operating[bundle.quoteNoi.profile] : undefined);
  if (noi && noi.underwrittenNoi > 0) set("noi", Math.round(noi.underwrittenNoi), `T-12 normalized (${noi.profile})`);

  if (bundle.rentRoll) {
    set("occupancyPct", pct100(bundle.rentRoll.physicalOccupancy), "rent roll");
    if (!intake.unitCount) set("unitCount", bundle.rentRoll.units, "rent roll");
  } else if (bundle.census) {
    set("occupancyPct", pct100(bundle.census.occupancy), "census");
    if (!intake.unitCount) set("unitCount", bundle.census.capacity, "census");
  } else if (bundle.str) {
    set("occupancyPct", pct100(bundle.str.ttm.occupancy), "STR trailing twelve");
    if (bundle.str.ttm.adr) set("adr", Math.round(bundle.str.ttm.adr * 100) / 100, "STR trailing twelve");
  }

  if (bundle.construction && intake.transaction === "CONSTRUCTION") {
    const t = bundle.construction.totals;
    const hard = t.hard;
    const construction = {
      ...(intake.construction ?? { gmpContract: false, constructionMonths: 18, leaseUpMonths: 6, completedProjects: 0, contingencyPct: 5, developerFeePct: 3, softCosts: 0 }),
      landCost: t.land,
      hardCosts: hard,
      softCosts: t.soft,
      contingencyPct: hard ? Math.min(50, pct100(t.contingency / hard)) : 0,
      developerFeePct: hard + t.soft ? Math.min(10, pct100(t.developerFee / (hard + t.soft))) : 0,
      ...(bundle.construction.gmpContract !== null ? { gmpContract: bundle.construction.gmpContract } : {}),
    } as NonNullable<Intake["construction"]>;
    changes.push({ field: "construction", from: intake.construction ?? null, to: construction, source: "construction budget" });
    next.construction = construction;
  }
  return { intake: next, changes };
}

/** Re-runs Jev's rules engine on the document-backed intake and reports both decisions. */
export function resizeWithSpreads(intake: Intake, bundle: SpreadBundle, rates: Benchmarks = FALLBACK_BENCHMARKS, opts: { profile?: LenderProfileId } = {}) {
  const before = decideWithRules(intake, rates);
  const { intake: updated, changes } = intakeFromSpreads(intake, bundle, opts);
  const after = decideWithRules(updated, rates);
  const rationale = changes.map((c) => `${c.field} from ${c.source}`);
  return {
    intake: updated,
    changes,
    before,
    after,
    rationale: [...rationale.map((r) => `Re-sized on documents: ${r}.`), ...after.rationale],
    primaryLoanBefore: before.primaryQuote?.loanAmount ?? null,
    primaryLoanAfter: after.primaryQuote?.loanAmount ?? null,
  };
}
