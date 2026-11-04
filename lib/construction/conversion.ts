// Conversion and payoff tracker rules: lease-up metrics, the stabilization
// test and the take-out refinance trigger. Pure functions.
//
// Corin tracks dates and statuses only. The construction lender of record
// funds, administers and is paid off by the take-out; there are no payoff
// amounts or draw data here (Global rule 1).

import { civilDateOf, addCalendarDays } from "@/lib/disclosures/business-days";
import type {
  AssetType,
  ConstructionConversion,
  ConstructionProgram,
  ConstructionProject,
  HudCostCertStatus,
  LeaseUpSnapshot,
  TakeoutPath,
  TakeoutProgramRef,
  TakeoutReason,
} from "./types";

/**
 * Take-out readiness thresholds. Permanent lenders commonly ask for about 90%
 * physical occupancy sustained for about 90 days. VERIFY against the take-out
 * lender's term sheet before telling a borrower a loan is takeable.
 */
export const STABILIZATION = {
  occupancyPct: 90,
  sustainedDays: 90,
  /** Start take-out work this many days before the construction loan matures. */
  maturityRunwayDays: 180,
  /** Flag an extension option this many days before its deadline. */
  extensionWarningDays: 60,
  /** Lease-up data older than this is stale. */
  staleSnapshotDays: 45,
} as const;

export type StabilizationThresholds = { occupancyPct: number; sustainedDays: number };

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export type LeaseUpMetrics = {
  asOf: string | null;
  unitsTotal: number;
  unitsOccupied: number;
  unitsLeased: number;
  occupancyPct: number;
  leasedPct: number;
  /** Net units leased per month between the first and latest snapshot (null with under two weeks of history). */
  absorptionPerMonth: number | null;
  /** First snapshot date of the current unbroken run at or above the occupancy threshold. */
  stabilizedSince: string | null;
  daysAtThreshold: number;
  stabilized: boolean;
  /** Projected date the sustained-occupancy test would pass at the current pace (null when it cannot be projected). */
  projectedStabilizationDate: string | null;
  stale: boolean;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export function computeLeaseUpMetrics(
  snapshots: readonly LeaseUpSnapshot[],
  unitsTotal: number,
  now: Date,
  thresholds: StabilizationThresholds = STABILIZATION,
): LeaseUpMetrics {
  const sorted = [...snapshots].sort((a, b) => a.asOf.localeCompare(b.asOf));
  const latest = sorted.at(-1);
  const empty: LeaseUpMetrics = {
    asOf: null,
    unitsTotal,
    unitsOccupied: 0,
    unitsLeased: 0,
    occupancyPct: 0,
    leasedPct: 0,
    absorptionPerMonth: null,
    stabilizedSince: null,
    daysAtThreshold: 0,
    stabilized: false,
    projectedStabilizationDate: null,
    stale: true,
  };
  if (!latest || unitsTotal <= 0) return empty;

  const meets = (s: LeaseUpSnapshot) => pct(s.unitsOccupied, unitsTotal) >= thresholds.occupancyPct;
  let runStart: LeaseUpSnapshot | undefined;
  for (let i = sorted.length - 1; i >= 0 && meets(sorted[i]!); i--) runStart = sorted[i];
  const daysAtThreshold = runStart ? daysBetween(runStart.asOf, latest.asOf) : 0;
  const stabilized = Boolean(runStart) && sorted.length >= 2 && daysAtThreshold >= thresholds.sustainedDays;

  const first = sorted[0]!;
  const spanDays = daysBetween(first.asOf, latest.asOf);
  const absorptionPerMonth = spanDays >= 14 ? Math.round(((latest.unitsLeased - first.unitsLeased) / (spanDays / 30.4375)) * 10) / 10 : null;

  let projectedStabilizationDate: string | null = null;
  if (!stabilized) {
    const target = Math.ceil((thresholds.occupancyPct / 100) * unitsTotal);
    if (meets(latest) && runStart) {
      projectedStabilizationDate = addCalendarDays(latest.asOf, thresholds.sustainedDays - daysAtThreshold);
    } else if (absorptionPerMonth && absorptionPerMonth > 0) {
      const monthsToTarget = Math.max(0, target - latest.unitsOccupied) / absorptionPerMonth;
      projectedStabilizationDate = addCalendarDays(latest.asOf, Math.ceil(monthsToTarget * 30.4375) + thresholds.sustainedDays);
    }
  }

  return {
    asOf: latest.asOf,
    unitsTotal,
    unitsOccupied: latest.unitsOccupied,
    unitsLeased: latest.unitsLeased,
    occupancyPct: pct(latest.unitsOccupied, unitsTotal),
    leasedPct: pct(latest.unitsLeased, unitsTotal),
    absorptionPerMonth,
    stabilizedSince: runStart?.asOf ?? null,
    daysAtThreshold,
    stabilized,
    projectedStabilizationDate,
    stale: daysBetween(latest.asOf, civilDateOf(now)) > STABILIZATION.staleSnapshotDays,
  };
}

// Defaults by program -----------------------------------------------------------------

const HUD_IN_PLACE: ReadonlySet<ConstructionProgram> = new Set(["HUD_221D4", "HUD_232_NEW_CONSTRUCTION"]);

/** HUD new-construction loans convert in place at final endorsement; every other construction loan is taken out by a refinance. */
export function defaultTakeoutPath(program: ConstructionProgram): TakeoutPath {
  return HUD_IN_PLACE.has(program) ? "hud_conversion" : "refinance";
}

export function defaultHudCostCertStatus(program: ConstructionProgram): HudCostCertStatus {
  return HUD_IN_PLACE.has(program) ? "not_started" : "not_applicable";
}

export function suggestTakeoutPrograms(assetType: AssetType): TakeoutProgramRef[] {
  switch (assetType) {
    case "MULTIFAMILY":
      return ["HUD_221D4_223F_MULTIFAMILY", "AGENCY_FANNIE_FREDDIE", "BANK_LIFE_CO"];
    case "SENIOR_HOUSING":
      return ["HUD_232_223F", "BANK_LIFE_CO"];
    case "HOTEL":
      return ["HOSPITALITY_CMBS_NON_RECOURSE", "BANK_LIFE_CO"];
    default:
      return ["BANK_LIFE_CO", "AGENCY_FANNIE_FREDDIE"];
  }
}

// Take-out trigger ----------------------------------------------------------------------

export type TakeoutEvaluation = {
  /** False when the loan converts in place (HUD) or the take-out is already done. */
  applicable: boolean;
  triggered: boolean;
  reasons: TakeoutReason[];
  suggestedPrograms: TakeoutProgramRef[];
  /** Plain-language lines for the staff view. */
  notes: string[];
};

export function evaluateTakeout(args: {
  project: Pick<ConstructionProject, "phase" | "assetType">;
  conversion: ConstructionConversion;
  metrics: LeaseUpMetrics;
  now: Date;
}): TakeoutEvaluation {
  const { project, conversion, metrics, now } = args;
  const today = civilDateOf(now);
  const none = (notes: string[], applicable = true): TakeoutEvaluation => ({
    applicable,
    triggered: false,
    reasons: [],
    suggestedPrograms: suggestTakeoutPrograms(project.assetType),
    notes,
  });

  if (conversion.takeoutPath === "hud_conversion") {
    const status = conversion.hudCostCertStatus;
    return none(
      [
        status === "approved"
          ? "HUD cost certification approved. The loan converts in place at final endorsement; no refinance take-out is needed."
          : `The loan converts in place with HUD. Cost certification status: ${status.replaceAll("_", " ")}.`,
      ],
      false,
    );
  }
  if (project.phase === "pre_closing") return none(["Closing has not happened yet; the take-out trigger starts after the construction loan closes."]);
  if (project.phase === "taken_out" || project.phase === "closed_out" || conversion.payoffStatus === "payoff_confirmed") {
    return none(["The construction loan has been paid off or the take-out is already under way."], false);
  }

  const reasons: TakeoutReason[] = [];
  const notes: string[] = [];

  if (metrics.stabilized) {
    reasons.push("stabilized_occupancy");
    notes.push(`${metrics.occupancyPct}% occupied; at or above ${STABILIZATION.occupancyPct}% for ${metrics.daysAtThreshold} days.`);
  } else if (metrics.asOf) {
    notes.push(`${metrics.occupancyPct}% occupied (${metrics.daysAtThreshold} days at or above ${STABILIZATION.occupancyPct}%; ${STABILIZATION.sustainedDays} needed).`);
  } else {
    notes.push("No lease-up snapshots recorded yet.");
  }

  if (conversion.loanMaturityDate) {
    const left = daysBetween(today, conversion.loanMaturityDate);
    if (left <= STABILIZATION.maturityRunwayDays) {
      reasons.push("maturity_runway");
      notes.push(left >= 0 ? `Construction loan matures in ${left} days.` : `Construction loan matured ${-left} days ago.`);
    }
  }
  if (conversion.extensionDeadline) {
    const left = daysBetween(today, conversion.extensionDeadline);
    if (left <= STABILIZATION.extensionWarningDays) {
      reasons.push("extension_deadline");
      notes.push(left >= 0 ? `Extension option deadline in ${left} days.` : `Extension option deadline passed ${-left} days ago.`);
    }
  }
  if (metrics.stale && metrics.asOf) notes.push("Latest lease-up snapshot is more than 45 days old; refresh before relying on it.");

  return { applicable: true, triggered: reasons.length > 0, reasons, suggestedPrograms: suggestTakeoutPrograms(project.assetType), notes };
}

// Deal hand-off ---------------------------------------------------------------------------

/** What the deals module needs to open the refinance deal. Carries no money fields. */
export type NewTakeoutDeal = {
  /** Same key always maps to the same deal, so a retry never opens a second one. */
  idempotencyKey: string;
  name: string;
  sourceProjectId: string;
  sourceDealId: string | null;
  leadId: string | null;
  loanPurpose: "refinance";
  assetType: AssetType;
  suggestedPrograms: TakeoutProgramRef[];
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  units: number | null;
  occupancyPct: number | null;
  noiT3Annualized: number | null;
  notes: string;
};

export function buildTakeoutDeal(args: {
  project: ConstructionProject;
  takeoutId: string;
  suggestedPrograms: TakeoutProgramRef[];
  reasons: TakeoutReason[];
  metrics: LeaseUpMetrics;
  latestSnapshot: LeaseUpSnapshot | undefined;
}): NewTakeoutDeal {
  const { project, metrics } = args;
  const why = args.reasons.length ? args.reasons.map((r) => r.replaceAll("_", " ")).join(", ") : "staff request";
  return {
    idempotencyKey: `construction-takeout:${args.takeoutId}`,
    name: `${project.name}: take-out refinance`,
    sourceProjectId: project.id,
    sourceDealId: project.dealId,
    leadId: project.leadId,
    loanPurpose: "refinance",
    assetType: project.assetType,
    suggestedPrograms: args.suggestedPrograms,
    propertyAddress: project.propertyAddress,
    city: project.city,
    state: project.state,
    zip: project.zip,
    units: project.units,
    occupancyPct: metrics.asOf ? metrics.occupancyPct : null,
    noiT3Annualized: args.latestSnapshot?.noiT3Annualized ?? null,
    notes: `Opened from the construction desk (${why}). Lender outreach goes through the broker approval gate.`,
  };
}
