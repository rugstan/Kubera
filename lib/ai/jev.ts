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
import { BRIDGE, CAP_RATES, FALLBACK_BENCHMARKS, HUD } from "@/lib/sizing/assumptions";
import { sizeHospitality, sizeSenior } from "@/lib/sizing/programs";
import { CONSTRUCTION } from "@/lib/sizing/programs/assumptions";
import { sizeConstruction } from "@/lib/sizing/programs/construction";
import { sizeHardMoney, type HardMoneyPropertyType } from "@/lib/sizing/programs/hardMoney";
import { sizeMultifamilyPlus } from "@/lib/sizing/programs/multifamily";
import { NEW_PROGRAM_IDS, type NewProgramId, type SizerProgramId, type SizerQuote, type SizerResult } from "@/lib/sizing/programs/types";
import type { ProgramId } from "@/lib/sizing/types";
import type { Intake } from "@/lib/validation";
import { LENDER_ROUTING, WHOLESALE_LENDERS, type WholesaleLender } from "./lenders";
import { prepareForRoute } from "./routing";

export const ASSET_VERTICALS = [
  "SENIOR_LIVING_CARE",
  "HOSPITALITY_HOTEL",
  "HOTEL_TO_CARE_CONVERSION",
  "MULTIFAMILY",
  "GENERAL_CRE_OR_CONSTRUCTION",
  // Short-term private loans (fix-and-flip, bridge) and 2–4 unit investor rentals.
  "HARD_MONEY_PRIVATE",
  "RESIDENTIAL_INVESTOR",
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
  // Hard money, construction, tiered agency, DSCR investor and HUD 223(a)(7) boxes.
  ...NEW_PROGRAM_IDS,
] as const satisfies readonly SizerProgramId[];

export const OPTIMIZATION_FLAGS = [
  "OPTIMAL_FOR_HUD_232",
  "LOAN_UNDER_3_5M_USE_SBA_504_TO_AVOID_HUD_COSTS",
  "USE_2026_SBA_10M_STACK_FOR_LARGE_HOTEL_OR_CARE_FACILITY",
  "NEEDS_STABILIZATION_OR_PIP_BRIDGE_FIRST",
  // Non-HUD structures that are already the right answer.
  "OPTIMAL_AS_STRUCTURED",
  // A bridge, hard money or construction loan whose exit (sale, refinance or take-out) does not cover the payoff.
  "EXIT_SHORTFALL_NEEDS_RESTRUCTURE",
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
  primaryQuote: SizerQuote | null;
  sizing: SizerResult;
  engine: "jev-remote" | "rules";
  latencyMs: number;
};

const REMOTE_BUDGET_MS = 180;

export function verticalFor(intake: Intake): JevLoanDecisionSchema["assetVertical"] {
  if (intake.transaction === "HARD_MONEY") return "HARD_MONEY_PRIVATE";
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
    case "RESIDENTIAL_2_4":
      return intake.transaction === "CONSTRUCTION" ? "GENERAL_CRE_OR_CONSTRUCTION" : "RESIDENTIAL_INVESTOR";
    default:
      return "GENERAL_CRE_OR_CONSTRUCTION";
  }
}

/** Representative score for a self-reported credit band (the bottom of the band). */
const BAND_FICO: Record<NonNullable<Intake["creditBand"]>, number> = { "740_PLUS": 740, "700_739": 700, "660_699": 660, BELOW_660: 620 };
/** Without a band, size DSCR boxes on the middle tier. */
const DEFAULT_FICO = 700;

/** Without a construction budget the request is read as a bank-sized (65%) share of total cost. */
const ASSUMED_LTC_WITHOUT_BUDGET = CONSTRUCTION.boxes.BANK.maxLtc;

const constructionRouted = (intake: Intake) =>
  intake.transaction === "CONSTRUCTION" && ["MULTIFAMILY", "MIXED_USE", "COMMERCIAL", "RESIDENTIAL_2_4"].includes(intake.assetType);

/**
 * Ground-up care facilities and hotels size on the senior / hospitality boxes, which apply
 * LTC to the value they are given. The qualifier asks for "Acquisition or land cost" on a
 * construction deal, so that field is a land figure, not the total development cost.
 */
const careOrHotelConstruction = (intake: Intake): "SENIOR" | "HOTEL" | null => {
  if (intake.transaction !== "CONSTRUCTION") return null;
  const vertical = verticalFor(intake);
  if (vertical === "SENIOR_LIVING_CARE") return "SENIOR";
  if (vertical === "HOSPITALITY_HOTEL") return "HOTEL";
  return null;
};

/** LTC used to read a care or hotel construction request as a share of total cost when no budget is given. */
const CARE_HOTEL_ASSUMED_LTC = { SENIOR: HUD.section232.newConstruction.maxLtc, HOTEL: BRIDGE.construction.maxLtc } as const;

/**
 * The total-cost basis for a care or hotel construction intake: land plus the budget when
 * one is given, otherwise the request read at the program's construction LTC (never below
 * the figure the borrower entered). Undefined when the intake is not care/hotel construction.
 */
export function careOrHotelConstructionCost(intake: Intake): number | undefined {
  const kind = careOrHotelConstruction(intake);
  if (!kind) return undefined;
  const c = intake.construction;
  if (c) {
    const contingency = c.hardCosts * ((c.contingencyPct ?? 0) / 100);
    const developerFee = (c.hardCosts + (c.softCosts ?? 0)) * ((c.developerFeePct ?? 0) / 100);
    return (c.landCost || intake.value || 0) + c.hardCosts + (c.softCosts ?? 0) + contingency + developerFee;
  }
  return Math.max(intake.value ?? 0, intake.loanAmount / CARE_HOTEL_ASSUMED_LTC[kind]);
}

/**
 * Cap rate for a hotel-to-care conversion's as-is value when none is entered. The
 * property is still a hotel, so its NOI is capped at the hotel rate for its tier
 * (the highest hotel rate when no tier is given), never below the senior rate.
 * Capping hotel NOI at the multifamily rate would overstate the value by about half.
 */
export function conversionCapRate(intake: Intake): number {
  const hotel = intake.franchiseTier ? CAP_RATES.hotel[intake.franchiseTier] : Math.max(...Object.values(CAP_RATES.hotel));
  return Math.max(hotel, CAP_RATES.senior);
}

/**
 * The as-is value a hotel-to-care conversion sizes on: the entered value, or NOI at
 * the conversion cap rate when it is blank. Undefined when neither is available.
 */
export function conversionValue(intake: Intake): number | undefined {
  if (verticalFor(intake) !== "HOTEL_TO_CARE_CONVERSION") return undefined;
  if (intake.value) return intake.value;
  return intake.noi > 0 ? intake.noi / conversionCapRate(intake) : undefined;
}

function hardMoneyPropertyType(intake: Intake): HardMoneyPropertyType {
  if (intake.assetType === "RESIDENTIAL_2_4") return "RESIDENTIAL_1_4";
  if (intake.assetType === "MULTIFAMILY" || intake.assetType === "MIXED_USE") return "MULTIFAMILY";
  return "COMMERCIAL";
}

/** What Jev had to assume about a thin intake, written to the CRM rationale. */
export function intakeAssumptions(intake: Intake): string[] {
  const out: string[] = [];
  if (intake.transaction === "HARD_MONEY" && !intake.hardMoney) out.push("Hard money intake without rehab or ARV detail: sized as a no-rehab purchase on the stated value.");
  if (intake.transaction === "HARD_MONEY" && !intake.value) out.push("No purchase price or value: estimated as the request at 75% of value.");
  if (constructionRouted(intake) && !intake.construction)
    out.push(`No construction budget: total cost estimated as the request at ${Math.round(ASSUMED_LTC_WITHOUT_BUDGET * 100)}% LTC; the desk needs the budget.`);
  const careHotel = careOrHotelConstruction(intake);
  if (careHotel && !intake.construction)
    out.push(
      `No construction budget: ${intake.value ? "the entered value is read as land cost, and " : ""}total cost is estimated as the request at ${Math.round(CARE_HOTEL_ASSUMED_LTC[careHotel] * 100)}% LTC; the desk needs the budget.`,
    );
  if (verticalFor(intake) === "HOTEL_TO_CARE_CONVERSION" && !intake.value)
    out.push(
      `No purchase price or value: the as-is value is estimated from NOI at a ${(conversionCapRate(intake) * 100).toFixed(2)}% hotel cap rate and total cost as that value plus the conversion budget; the desk needs the purchase price and conversion budget.`,
    );
  if (intake.assetType === "RESIDENTIAL_2_4" && !intake.rental && intake.transaction !== "HARD_MONEY" && !constructionRouted(intake))
    out.push("No rent detail: NOI stands in for rent less taxes, insurance and HOA.");
  return out;
}

function sizeHardMoneyIntake(intake: Intake, rates: Benchmarks): SizerResult {
  const hm = intake.hardMoney;
  const price = intake.value ?? intake.loanAmount / 0.75;
  const term = hm?.termMonths ?? 12;
  return sizeHardMoney(
    {
      // A rental hold is a bridge whose exit is a long-term (DSCR) refinance.
      strategy: hm?.strategy === "RENTAL" ? "BRIDGE" : (hm?.strategy ?? "FIX_AND_FLIP"),
      purpose: hm?.purpose ?? "PURCHASE",
      propertyType: hardMoneyPropertyType(intake),
      units: intake.unitCount,
      purchasePrice: price,
      rehabBudget: hm?.rehabBudget ?? 0,
      arv: hm?.arv,
      loanAmount: intake.loanAmount,
      completedProjects: hm?.completedProjects ?? 0,
      termMonths: term,
      holdMonths: hm?.holdMonths ?? term,
      interestReserveMonths: 0,
      interestBasis: "OUTSTANDING",
      existingPayoff: hm?.existingPayoff,
      stabilizedNoi: intake.noi > 0 ? intake.noi : undefined,
      // As for DSCR rentals, NOI stands in for rent less taxes, insurance and HOA when no rent detail is given.
      monthlyRent: intake.rental?.monthlyRent ?? (intake.noi > 0 ? intake.noi / 12 : undefined),
      monthlyTaxesInsuranceHoa: intake.rental?.monthlyTaxesInsuranceHoa ?? 0,
      fico: intake.creditBand ? BAND_FICO[intake.creditBand] : DEFAULT_FICO,
    },
    rates,
  );
}

/**
 * Why a hard money exit could not be tested from the intake, or null when it could.
 * A sale exit needs an after-repair value (without one the sizer prices the sale at
 * the as-is price, which can never cover selling and financing costs); a 1–4 unit
 * refinance exit needs rent or NOI.
 */
export function untestedHardMoneyExit(intake: Intake, exit: SizerQuote["exit"]): string | null {
  if (intake.transaction !== "HARD_MONEY" || !exit) return null;
  if (exit.kind === "SALE" && !intake.hardMoney?.arv)
    return "No after-repair value given, so the sale exit was not tested; the desk needs the ARV and rehab budget to confirm it.";
  if (exit.kind === "DSCR_REFINANCE" && !intake.rental && intake.noi <= 0)
    return "No rent or NOI given, so the refinance exit was not tested; the desk needs the projected rent to confirm it.";
  return null;
}

function sizeConstructionIntake(intake: Intake, rates: Benchmarks): SizerResult {
  const c = intake.construction;
  const land = c?.landCost ?? intake.value ?? 0;
  // Without a budget, everything above land is treated as hard cost.
  const hardCosts = c?.hardCosts ?? Math.max(0, intake.loanAmount / ASSUMED_LTC_WITHOUT_BUDGET - land);
  return sizeConstruction(
    {
      assetType: intake.assetType === "COMMERCIAL" ? "COMMERCIAL" : intake.assetType === "MIXED_USE" ? "MIXED_USE" : "MULTIFAMILY",
      units: intake.unitCount,
      landCost: land,
      hardCosts,
      softCosts: c?.softCosts ?? 0,
      contingencyPct: (c?.contingencyPct ?? 5) / 100,
      developerFeePct: (c?.developerFeePct ?? 0) / 100,
      gmpContract: c?.gmpContract ?? false,
      constructionMonths: c?.constructionMonths ?? 18,
      leaseUpMonths: c?.leaseUpMonths ?? 6,
      stabilizedNoi: intake.noi,
      asCompletedValue: c?.asCompletedValue,
      loanAmount: intake.loanAmount,
      completedProjects: c?.completedProjects ?? 0,
      mezzTargetLtc: 0,
      prefTargetLtc: 0,
      cpaceAmount: 0,
    },
    rates,
  );
}

export function sizeIntake(intake: Intake, rates: Benchmarks): SizerResult {
  const vertical = verticalFor(intake);
  if (vertical === "HARD_MONEY_PRIVATE") return sizeHardMoneyIntake(intake, rates);
  if (vertical === "SENIOR_LIVING_CARE") {
    const facilityType = intake.assetType as "ASSISTED_LIVING" | "MEMORY_CARE" | "RCFE" | "SNF";
    return sizeSenior(
      {
        facilityType,
        beds: intake.unitCount,
        occupancyPct: intake.occupancyPct,
        loanAmount: intake.loanAmount,
        noi: intake.noi,
        value: careOrHotelConstructionCost(intake) ?? intake.value,
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
        value: careOrHotelConstructionCost(intake) ?? intake.value,
        transaction: intake.transaction === "CONSTRUCTION" ? "CONSTRUCTION" : intake.transaction === "PURCHASE" ? "PURCHASE" : "REFINANCE",
        nonRecourseOnly: intake.nonRecourseOnly,
        green: intake.green,
      },
      rates,
    );
  }
  // Ground-up multifamily, mixed-use, commercial and small residential: the construction boxes.
  if (constructionRouted(intake)) return sizeConstructionIntake(intake, rates);

  // Multifamily, commercial, small residential and hotel-to-care conversions. A
  // conversion is sized like a value-add construction loan on acquisition +
  // conversion budget, with a HUD 232 takeout once licensed and stabilized.
  const isConversion = vertical === "HOTEL_TO_CARE_CONVERSION";
  const construction = isConversion || intake.transaction === "CONVERSION";
  const smallResidential = intake.assetType === "RESIDENTIAL_2_4";
  // A blank conversion value is estimated at the hotel cap rate (see conversionValue), so
  // leaving it blank never sizes better than entering it.
  const value = isConversion ? conversionValue(intake) : intake.value;
  const result = sizeMultifamilyPlus(
    {
      assetType: isConversion || smallResidential ? "MULTIFAMILY" : intake.assetType === "MIXED_USE" ? "MIXED_USE" : intake.assetType === "COMMERCIAL" ? "COMMERCIAL" : "MULTIFAMILY",
      // A 2–4 unit property never sizes on the 5+ unit boxes, whatever the unit count says.
      units: smallResidential ? Math.min(4, Math.max(2, intake.unitCount)) : intake.unitCount,
      sqft: 0,
      loanAmount: intake.loanAmount,
      noi: intake.noi,
      value,
      totalCost: construction && value ? value + (intake.pipBudget ?? 0) : undefined,
      transaction: construction ? "CONSTRUCTION" : intake.transaction === "PURCHASE" ? "PURCHASE" : "REFINANCE",
      affordable: false,
      green: intake.green,
      occupancyPct: intake.occupancyPct,
      agencyTermYears: 10,
      agencyIoYears: 0,
      fico: intake.creditBand ? BAND_FICO[intake.creditBand] : DEFAULT_FICO,
      monthlyRent: intake.rental?.monthlyRent ?? (smallResidential ? intake.noi / 12 : undefined),
      monthlyTaxesInsuranceHoa: intake.rental?.monthlyTaxesInsuranceHoa ?? 0,
    },
    rates,
  );
  return isConversion && !intake.value ? { ...result, valueEstimated: true } : result;
}

/** Lenders Kubera sends each new box to, in priority order (the static table covers the original programs). */
export const NEW_BOX_ROUTING: Record<NewProgramId, WholesaleLender[]> = {
  HARD_MONEY: ["FIDELIS_PRIVATE_FUND", "ROC_CAPITAL"],
  CONSTRUCTION_BANK: ["READY_CAPITAL"],
  CONSTRUCTION_DEBT_FUND: ["READY_CAPITAL", "FIDELIS_PRIVATE_FUND"],
  CONSTRUCTION_PRIVATE: ["FIDELIS_PRIVATE_FUND", "ROC_CAPITAL"],
  AGENCY_FANNIE_MAE: ["GREYSTONE", "LUMENT"],
  AGENCY_FREDDIE_MAC: ["GREYSTONE", "LUMENT"],
  DSCR_INVESTOR_2_4: ["ROC_CAPITAL"],
  DSCR_INVESTOR_5_PLUS: ["ROC_CAPITAL", "READY_CAPITAL"],
  HUD_223A7: ["GREYSTONE", "LUMENT"],
};

export function lendersFor(id: string): WholesaleLender[] {
  if (Object.hasOwn(NEW_BOX_ROUTING, id)) return NEW_BOX_ROUTING[id as NewProgramId];
  if (Object.hasOwn(LENDER_ROUTING, id)) return LENDER_ROUTING[id as ProgramId];
  return [];
}

const STABILIZATION_FIRST: ReadonlySet<SizerProgramId> = new Set(["BRIDGE_TO_HUD_232", "HOSPITALITY_PIP_BRIDGE"]);

/** Pure, synchronous rules engine. Runs in well under a millisecond. */
export function decideWithRules(intake: Intake, rates: Benchmarks = FALLBACK_BENCHMARKS): Omit<JevResult, "engine" | "latencyMs"> {
  const vertical = verticalFor(intake);
  const sizing = sizeIntake(intake, rates);
  const rationale: string[] = [...intakeAssumptions(intake)];
  const byId = new Map(sizing.quotes.map((q) => [q.id, q]));

  let primaryId: SizerProgramId | null = sizing.bestFit;
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
  if ((primaryId && STABILIZATION_FIRST.has(primaryId)) || vertical === "HOTEL_TO_CARE_CONVERSION" ||
      (vertical === "SENIOR_LIVING_CARE" && intake.occupancyPct < HUD.section232.stabilizedOccupancy * 100 && intake.transaction !== "CONSTRUCTION")) {
    flag = "NEEDS_STABILIZATION_OR_PIP_BRIDGE_FIRST";
  } else if (primary?.exit && untestedHardMoneyExit(intake, primary.exit)) {
    rationale.push(untestedHardMoneyExit(intake, primary.exit)!);
  } else if (primary?.exit?.result === "FAIL") {
    flag = "EXIT_SHORTFALL_NEEDS_RESTRUCTURE";
    rationale.push(`${primary.exit.label} falls short by ${fmt(primary.exit.shortfall)}.`);
  } else if (primaryId === "SBA_504_PLUS_7A_10M_STACK") {
    flag = "USE_2026_SBA_10M_STACK_FOR_LARGE_HOTEL_OR_CARE_FACILITY";
  } else if (hudQuote && sbaQuote?.eligible && intake.loanAmount < HUD.smallLoanThreshold && vertical !== "HOSPITALITY_HOTEL") {
    flag = "LOAN_UNDER_3_5M_USE_SBA_504_TO_AVOID_HUD_COSTS";
  } else if (primaryId === "HUD_232_223F" || primaryId === "HUD_232_NEW_CONST") {
    flag = "OPTIMAL_FOR_HUD_232";
  }

  // Green certification no longer lowers HUD MIP, so only the SBA 504 green debenture cap counts.
  const green = intake.green && sizing.quotes.some((q) => q.eligible && q.id.startsWith("SBA_"));

  let tier: JevLoanDecisionSchema["leadUrgencyTier"];
  // Ground-up, conversion and hard money (fix-and-flip) deals have no in-place income.
  const noIncome = intake.noi <= 0 && !["CONSTRUCTION", "CONVERSION", "HARD_MONEY"].includes(intake.transaction);
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
      ...(primaryId ? lendersFor(primaryId) : []),
      ...((PROGRAM_FITS as readonly string[]).includes(secondary) ? lendersFor(secondary) : []),
    ]),
  ].slice(0, 5);

  const commission = tier === "UNQUALIFIED" ? 0 : Math.round(primary?.estimatedAdvisoryFee ?? 0);
  const callNow =
    tier === "TIER_1_INSTITUTIONAL_HOT" ||
    (tier !== "UNQUALIFIED" && (intake.timelineDays <= 30 || intake.loanAmount >= 15_000_000));

  if (primary) {
    rationale.push(
      `${primary.name}: ${fmt(primary.loanAmount)} sized (${Math.round(coverage * 100)}% of request), ` +
        `${primary.ratePct.toFixed(2)}% note, ${primary.dscr.toFixed(2)}x DSCR, ${(primary.ltv * 100).toFixed(0)}% ${primary.leverageBasis}.`,
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

/** Model id the routing guard sees for the remote Jev endpoint. */
export const JEV_REMOTE_MODEL = "jev-remote";

/**
 * What may leave for the remote Jev endpoint: the structured intake without the
 * free-text `notes` (borrowers paste account numbers, SSNs and birth dates
 * there), passed through the model routing guard so anything above the route's
 * ceiling is redacted. Null when the guard refuses the route.
 */
export function remoteJevPayload(intake: Intake, draft: JevLoanDecisionSchema): { input: Omit<Intake, "notes">; draft: JevLoanDecisionSchema } | null {
  const { notes: _notes, ...input } = intake;
  void _notes;
  const routed = prepareForRoute({ model: JEV_REMOTE_MODEL, provider: "jev", purpose: "lead_scoring", payload: { input, draft } });
  return routed?.payload ?? null;
}

async function refineWithRemoteJev(intake: Intake, draft: JevLoanDecisionSchema): Promise<JevLoanDecisionSchema | null> {
  const url = process.env.JEV_API_URL;
  if (!url) return null;
  const payload = remoteJevPayload(intake, draft);
  if (!payload) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.JEV_API_KEY ?? ""}` },
      body: JSON.stringify({ schema: "JevLoanDecisionSchema", input: payload.input, draft: payload.draft, jsonSchema: z.toJSONSchema(jevDecisionSchema) }),
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

/**
 * `leads.engine` for a submission handled under advisor-only handling
 * (privacy_preferences.human_review_only / ai_processing_opt_out): neither the
 * rules engine nor the remote model runs, and the row carries no decision.
 */
export const HUMAN_REVIEW_ENGINE = "human_review" as const;

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

export type PublicSummary = Omit<ReturnType<typeof publicSummary>, "flag"> & { flag: string };

/**
 * What a borrower with advisor-only handling on file sees: no program fit and
 * no indicative numbers, only "an advisor will review this personally".
 */
export function humanReviewSummary(): PublicSummary {
  return {
    program: null,
    secondary: null,
    flag: "ADVISOR_REVIEW",
    indicativeLoan: 0,
    indicativeRatePct: null,
    term: null,
    recourse: null,
    closeTimeline: null,
    callScheduled: false,
    qualified: false,
  };
}
