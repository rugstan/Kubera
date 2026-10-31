// Jev — Kubera's "System One" decision engine.
//
// Every intake is classified into a strictly typed JevLoanDecisionSchema in
// well under 200ms. The deterministic rules engine below runs on every request
// and reuses the same sizing math the public sizer shows borrowers, so the CRM
// decision and the on-screen numbers can never disagree. When JEV_API_URL is
// configured, the hosted Jev model is asked to refine the draft under a hard
// latency budget; its answer is schema-validated and we fall back to the rules
// result on timeout, error, or invalid output.

import { z } from "zod";
import type { Benchmarks } from "@/lib/rates";
import { FALLBACK_BENCHMARKS, HUD } from "@/lib/sizing/assumptions";
import { sizeHospitality, sizeMultifamily, sizeSenior } from "@/lib/sizing/programs";
import type { ProgramId, ProgramQuote, SizingResult } from "@/lib/sizing/types";
import type { Intake } from "@/lib/validation";
import { LENDER_ROUTING, WHOLESALE_LENDERS, type WholesaleLender } from "./lenders";

export const ASSET_VERTICALS = [
  "SENIOR_LIVING_CARE",
  "HOSPITALITY_HOTEL",
  "HOTEL_TO_CARE_CONVERSION",
  "MULTIFAMILY",
  "GENERAL_CRE_OR_CONSTRUCTION",
] as const;

export const PROGRAM_FITS = [
  "HUD_232_223F",
  "HUD_232_NEW_CONST",
  "SBA_504_STANDARD",
  "SBA_504_PLUS_7A_10M_STACK",
  "HOSPITALITY_CMBS_NON_RECOURSE",
  "HOSPITALITY_PIP_BRIDGE",
  "BRIDGE_TO_HUD_232",
  "WHITE_LABEL_CRE_BRIDGE",
  // Multifamily permanent programs the sizer also quotes.
  "HUD_221D4_223F_MULTIFAMILY",
  "AGENCY_FANNIE_FREDDIE",
] as const satisfies readonly ProgramId[];

export const OPTIMIZATION_FLAGS = [
  "OPTIMAL_FOR_HUD_232",
  "LOAN_UNDER_3_5M_USE_SBA_504_TO_AVOID_HUD_COSTS",
  "USE_2026_SBA_10M_STACK_FOR_LARGE_HOTEL_OR_CARE_FACILITY",
  "NEEDS_STABILIZATION_OR_PIP_BRIDGE_FIRST",
  // Non-HUD structures that are already the right answer.
  "OPTIMAL_AS_STRUCTURED",
] as const;

export const URGENCY_TIERS = ["TIER_1_INSTITUTIONAL_HOT", "TIER_2_QUALIFIED_MIDMARKET", "TIER_3_NURTURE", "UNQUALIFIED"] as const;

export const jevDecisionSchema = z.object({
  assetVertical: z.enum(ASSET_VERTICALS),
  primaryProgramFit: z.enum(PROGRAM_FITS),
  secondaryProgramFit: z.string(),
  sizingOptimizationFlag: z.enum(OPTIMIZATION_FLAGS),
  greenMipOrGreen504Candidate: z.boolean(),
  leadUrgencyTier: z.enum(URGENCY_TIERS),
  recommendedWholesaleLenders: z.array(z.enum(WHOLESALE_LENDERS)),
  estimatedBrokerCommissionUsd: z.number().nonnegative(),
  requiresImmediateBrokerCall: z.boolean(),
});

export type JevLoanDecisionSchema = z.infer<typeof jevDecisionSchema>;

export type JevResult = {
  decision: JevLoanDecisionSchema;
  /** Human-readable reasons, written to the CRM note. */
  rationale: string[];
  primaryQuote: ProgramQuote | null;
  sizing: SizingResult;
  engine: "jev-remote" | "rules";
  latencyMs: number;
};

const REMOTE_BUDGET_MS = 180;

export function verticalFor(intake: Intake): JevLoanDecisionSchema["assetVertical"] {
  switch (intake.assetType) {
    case "ASSISTED_LIVING":
    case "MEMORY_CARE":
    case "RCFE":
    case "SNF":
      return "SENIOR_LIVING_CARE";
    case "HOTEL_FLAGGED":
    case "HOTEL_BOUTIQUE":
      return "HOSPITALITY_HOTEL";
    case "HOTEL_TO_SENIOR_CONVERSION":
      return "HOTEL_TO_CARE_CONVERSION";
    case "MULTIFAMILY":
      return intake.transaction === "CONSTRUCTION" ? "GENERAL_CRE_OR_CONSTRUCTION" : "MULTIFAMILY";
    default:
      return "GENERAL_CRE_OR_CONSTRUCTION";
  }
}

export function sizeIntake(intake: Intake, rates: Benchmarks): SizingResult {
  const vertical = verticalFor(intake);
  if (vertical === "SENIOR_LIVING_CARE") {
    const facilityType = intake.assetType as "ASSISTED_LIVING" | "MEMORY_CARE" | "RCFE" | "SNF";
    return sizeSenior(
      {
        facilityType,
        beds: intake.unitCount,
        occupancyPct: intake.occupancyPct,
        loanAmount: intake.loanAmount,
        noi: intake.noi,
        value: intake.value,
        transaction: intake.transaction === "CONSTRUCTION" ? "NEW_CONSTRUCTION" : intake.transaction === "PURCHASE" ? "PURCHASE" : "REFINANCE",
        nonRecourseOnly: intake.nonRecourseOnly,
        green: intake.green,
      },
      rates,
    );
  }
  if (vertical === "HOSPITALITY_HOTEL") {
    return sizeHospitality(
      {
        keys: intake.unitCount,
        tier: intake.franchiseTier ?? (intake.assetType === "HOTEL_BOUTIQUE" ? "BOUTIQUE_INDEPENDENT" : "PREMIUM_FLAG"),
        loanAmount: intake.loanAmount,
        noi: intake.noi,
        adr: intake.adr ?? 0,
        occupancyPct: intake.occupancyPct,
        pipBudget: intake.pipBudget ?? 0,
        value: intake.value,
        transaction: intake.transaction === "CONSTRUCTION" ? "CONSTRUCTION" : intake.transaction === "PURCHASE" ? "PURCHASE" : "REFINANCE",
        nonRecourseOnly: intake.nonRecourseOnly,
        green: intake.green,
      },
      rates,
    );
  }
  // Multifamily, commercial, construction, and hotel-to-care conversions. A
  // conversion is sized like a value-add construction loan on acquisition +
  // conversion budget, with a HUD 232 takeout once licensed and stabilized.
  const isConversion = vertical === "HOTEL_TO_CARE_CONVERSION";
  const construction = isConversion || intake.transaction === "CONSTRUCTION" || intake.transaction === "CONVERSION";
  return sizeMultifamily(
    {
      assetType: isConversion ? "MULTIFAMILY" : intake.assetType === "MIXED_USE" ? "MIXED_USE" : intake.assetType === "COMMERCIAL" ? "COMMERCIAL" : "MULTIFAMILY",
      units: intake.unitCount,
      sqft: 0,
      loanAmount: intake.loanAmount,
      noi: intake.noi,
      value: intake.value,
      totalCost: construction && intake.value ? intake.value + (intake.pipBudget ?? 0) : undefined,
      transaction: construction ? "CONSTRUCTION" : intake.transaction === "PURCHASE" ? "PURCHASE" : "REFINANCE",
      affordable: false,
      green: intake.green,
    },
    rates,
  );
}

/** Pure, synchronous rules engine. Runs in well under a millisecond. */
export function decideWithRules(intake: Intake, rates: Benchmarks = FALLBACK_BENCHMARKS): Omit<JevResult, "engine" | "latencyMs"> {
  const vertical = verticalFor(intake);
  const sizing = sizeIntake(intake, rates);
  const rationale: string[] = [];
  const byId = new Map(sizing.quotes.map((q) => [q.id, q]));

  let primaryId: ProgramId | null = sizing.bestFit;
  if (vertical === "HOTEL_TO_CARE_CONVERSION") {
    primaryId = "WHITE_LABEL_CRE_BRIDGE";
    rationale.push("Hotel-to-care conversion: acquisition + conversion bridge, HUD 232 takeout after RCFE licensing and stabilization.");
  }
  const primary = primaryId ? byId.get(primaryId) ?? null : null;

  const alternatives = sizing.quotes
    .filter((q) => q.eligible && q.id !== primaryId)
    .sort((a, b) => b.loanAmount - a.loanAmount);
  const secondary =
    vertical === "HOTEL_TO_CARE_CONVERSION" ? "BRIDGE_TO_HUD_232" : alternatives[0]?.id ?? "NONE";

  const coverage = primary ? primary.loanAmount / intake.loanAmount : 0;
  const hudQuote = sizing.quotes.find((q) => q.id.startsWith("HUD_"));
  const sbaQuote = sizing.quotes.find((q) => q.id.startsWith("SBA_"));

  let flag: JevLoanDecisionSchema["sizingOptimizationFlag"] = "OPTIMAL_AS_STRUCTURED";
  if (primaryId === "BRIDGE_TO_HUD_232" || primaryId === "HOSPITALITY_PIP_BRIDGE" || vertical === "HOTEL_TO_CARE_CONVERSION" ||
      (vertical === "SENIOR_LIVING_CARE" && intake.occupancyPct < HUD.section232.stabilizedOccupancy * 100 && intake.transaction !== "CONSTRUCTION")) {
    flag = "NEEDS_STABILIZATION_OR_PIP_BRIDGE_FIRST";
  } else if (primaryId === "SBA_504_PLUS_7A_10M_STACK") {
    flag = "USE_2026_SBA_10M_STACK_FOR_LARGE_HOTEL_OR_CARE_FACILITY";
  } else if (hudQuote && sbaQuote?.eligible && intake.loanAmount < HUD.smallLoanThreshold && vertical !== "HOSPITALITY_HOTEL") {
    flag = "LOAN_UNDER_3_5M_USE_SBA_504_TO_AVOID_HUD_COSTS";
  } else if (primaryId === "HUD_232_223F" || primaryId === "HUD_232_NEW_CONST") {
    flag = "OPTIMAL_FOR_HUD_232";
  }

  const green = intake.green && sizing.quotes.some((q) => q.eligible && (q.id === "HUD_221D4_223F_MULTIFAMILY" || q.id.startsWith("SBA_")));

  let tier: JevLoanDecisionSchema["leadUrgencyTier"];
  const noIncome = intake.noi <= 0 && intake.transaction !== "CONSTRUCTION" && intake.transaction !== "CONVERSION";
  if (!primary || !primary.eligible || coverage < 0.5 || noIncome) {
    tier = "UNQUALIFIED";
    rationale.push(primary ? `Best structure covers only ${Math.round(coverage * 100)}% of the request.` : "No program fits the submitted profile.");
  } else if (intake.loanAmount >= 10_000_000 && coverage >= 0.9 && intake.timelineDays <= 120) {
    tier = "TIER_1_INSTITUTIONAL_HOT";
  } else if (intake.loanAmount >= 2_000_000 && coverage >= 0.8) {
    tier = "TIER_2_QUALIFIED_MIDMARKET";
  } else {
    tier = "TIER_3_NURTURE";
  }

  const lenders = [
    ...new Set<WholesaleLender>([
      ...(primaryId ? LENDER_ROUTING[primaryId] : []),
      ...((PROGRAM_FITS as readonly string[]).includes(secondary) ? LENDER_ROUTING[secondary as ProgramId] : []),
    ]),
  ].slice(0, 5);

  const commission = tier === "UNQUALIFIED" ? 0 : Math.round(primary?.estimatedAdvisoryFee ?? 0);
  const callNow =
    tier === "TIER_1_INSTITUTIONAL_HOT" ||
    (tier !== "UNQUALIFIED" && (intake.timelineDays <= 30 || intake.loanAmount >= 15_000_000));

  if (primary) {
    rationale.push(
      `${primary.name}: ${fmt(primary.loanAmount)} sized (${Math.round(coverage * 100)}% of request), ` +
        `${primary.ratePct.toFixed(2)}% note, ${primary.dscr.toFixed(2)}x DSCR, ${(primary.ltv * 100).toFixed(0)}% LTV.`,
    );
    rationale.push(...primary.warnings);
  }

  return {
    decision: {
      assetVertical: vertical,
      // With nothing eligible, keep the schema valid with the closest structure for the desk to review.
      primaryProgramFit: (primaryId ?? sizing.quotes[0]?.id ?? "WHITE_LABEL_CRE_BRIDGE") as JevLoanDecisionSchema["primaryProgramFit"],
      secondaryProgramFit: secondary,
      sizingOptimizationFlag: flag,
      greenMipOrGreen504Candidate: green,
      leadUrgencyTier: tier,
      recommendedWholesaleLenders: lenders,
      estimatedBrokerCommissionUsd: commission,
      requiresImmediateBrokerCall: callNow,
    },
    rationale,
    primaryQuote: primary,
    sizing,
  };
}

async function refineWithRemoteJev(intake: Intake, draft: JevLoanDecisionSchema): Promise<JevLoanDecisionSchema | null> {
  const url = process.env.JEV_API_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.JEV_API_KEY ?? ""}` },
      body: JSON.stringify({ schema: "JevLoanDecisionSchema", input: intake, draft, jsonSchema: z.toJSONSchema(jevDecisionSchema) }),
      signal: AbortSignal.timeout(REMOTE_BUDGET_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const parsed = jevDecisionSchema.safeParse((body as { output?: unknown })?.output ?? body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function decide(intake: Intake, rates: Benchmarks = FALLBACK_BENCHMARKS): Promise<JevResult> {
  const started = performance.now();
  const local = decideWithRules(intake, rates);
  const remote = await refineWithRemoteJev(intake, local.decision);
  return {
    ...local,
    // Financial fields always come from the sizer, never from the model.
    decision: remote
      ? { ...remote, estimatedBrokerCommissionUsd: local.decision.estimatedBrokerCommissionUsd }
      : local.decision,
    engine: remote ? "jev-remote" : "rules",
    latencyMs: Math.round(performance.now() - started),
  };
}

const fmt = (n: number) => `$${(n / 1_000_000).toFixed(2)}M`;

/** What a borrower may see. Tier, commission, and lender routing stay internal. */
export function publicSummary(r: JevResult) {
  const q = r.primaryQuote;
  return {
    program: q?.name ?? null,
    secondary: r.sizing.quotes.find((x) => x.id === r.decision.secondaryProgramFit)?.name ?? null,
    flag: r.decision.sizingOptimizationFlag,
    indicativeLoan: q?.loanAmount ?? 0,
    indicativeRatePct: q ? Number(q.ratePct.toFixed(2)) : null,
    term: q?.termLabel ?? null,
    recourse: q?.recourse ?? null,
    closeTimeline: q?.closeTimeline ?? null,
    callScheduled: r.decision.requiresImmediateBrokerCall,
    qualified: r.decision.leadUrgencyTier !== "UNQUALIFIED",
  };
}
