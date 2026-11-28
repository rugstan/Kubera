// What a lender needs before it can screen a deal (soft quote / LOI) or issue
// a term sheet, per playbook (spec 1.2, 1.3 and 4.5). One table of
// requirement definitions; readiness.ts evaluates it. The Underwrite level is
// not here: it is the deal checklist's required application and underwriting
// items (lib/checklists), read through SubmissionContext.checklistItems.
//
// Ids are stable: they are stored in lender_outreach.readiness_missing and
// shown to the approving broker. Thresholds marked VERIFY are market norms
// from lender and broker publications, not program law.

import { SATISFIED_STATUSES } from "@/lib/checklists/types";
import { INCOME_PLAYBOOKS, SHORT_TERM_PLAYBOOKS, defaultPlaybook, isIncomeProperty, playbookTrancheSource, sectionView } from "./playbooks";
import {
  PFS_MAX_AGE_DAYS,
  REFINANCE_PURPOSES,
  creditEventKinds,
  submissionPlaybooks,
  type FixTarget,
  type ItemStatus,
  type Requirement,
  type RequirementLevel,
  type RequirementLevels,
  type StageLevels,
  type SubmissionContext,
  type SubmissionMetrics,
  type SubmissionPlaybook,
  type SubmissionPrincipal,
  type SubmissionProfile,
} from "./types";

/**
 * A requirement with the few stage- and context-dependent rules the frozen
 * Requirement shape cannot express. readiness.ts reads these; everything else
 * reads the Requirement fields.
 */
export type SubmissionRequirement = Requirement & {
  /** A stricter check at Term sheet (default: `met`). */
  termSheetMet?: (ctx: SubmissionContext, metrics: SubmissionMetrics) => boolean;
  /** Raises the Screen level to required when true (sources and uses on an acquisition, construction or renovation). */
  screenRequiredWhen?: (ctx: SubmissionContext) => boolean;
  /** The fix target resolved against the deal (a checklist item, the construction project). */
  resolveFix?: (ctx: SubmissionContext) => FixTarget;
  /** True when the item is met only through what the sponsor stated (sponsor facts carry no document source). */
  perBorrower?: (ctx: SubmissionContext) => boolean;
};

const R: RequirementLevel = "required";
const r: RequirementLevel = "recommended";
const RR: StageLevels = { screen: R, term_sheet: R };
const rR: StageLevels = { screen: r, term_sheet: R };
const all = (levels: StageLevels): RequirementLevels => ({ all: levels });
const only = (playbooks: readonly SubmissionPlaybook[], levels: StageLevels): RequirementLevels => Object.fromEntries(playbooks.map((p) => [p, levels]));
const except = (excluded: readonly SubmissionPlaybook[], levels: StageLevels): RequirementLevels => only(submissionPlaybooks.filter((p) => !excluded.includes(p)), levels);

const DAY = 86_400_000;
const HOTEL: readonly SubmissionPlaybook[] = ["hotel_cmbs", "hotel_pip_bridge"];
const SBA: readonly SubmissionPlaybook[] = ["sba_7a", "sba_504"];
const HUD: readonly SubmissionPlaybook[] = ["hud_multifamily", "hud_232"];
const STACK: readonly SubmissionPlaybook[] = ["mezz_pref", "c_pace"];
const SENIOR_ASSETS = new Set(["ASSISTED_LIVING", "MEMORY_CARE", "RCFE", "SNF"]);
const HOTEL_ASSETS = new Set(["HOTEL_FLAGGED", "HOTEL_BOUTIQUE"]);
/** Checklist statuses at which a document counts as on hand ("submitted or better"). */
export const RECEIVED_STATUSES: readonly ItemStatus[] = ["submitted", "under_review", ...SATISFIED_STATUSES];

/** The playbook a context is evaluated under: the profile's, else the program default. */
export function playbookOf(ctx: SubmissionContext): SubmissionPlaybook {
  return ctx.profile?.playbook ?? defaultPlaybook(ctx.deal.program);
}

const has = (v: unknown): boolean => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
const prof = (ctx: SubmissionContext): SubmissionProfile | null => ctx.profile;
const details = (ctx: SubmissionContext) => ctx.profile?.programDetails ?? {};
const sum = (lines: readonly { amountCents: number }[]) => lines.reduce((s, l) => s + l.amountCents, 0);

function docOnHand(ctx: SubmissionContext, kinds: readonly string[], itemKeys: readonly string[]): boolean {
  return ctx.vaultDocuments.some((d) => kinds.includes(d.kind)) || ctx.checklistItems.some((i) => itemKeys.includes(i.templateKey) && RECEIVED_STATUSES.includes(i.status));
}

function checklistFix(itemKey: string): (ctx: SubmissionContext) => FixTarget {
  return (ctx) => ({ kind: "checklist", itemId: ctx.checklistItems.find((i) => i.templateKey === itemKey)?.id });
}

const individuals = (ctx: SubmissionContext) => ctx.principals.filter((p) => p.kind === "individual");
const isGuarantor = (p: SubmissionPrincipal) => p.isGuarantor || p.roles.includes("guarantor");

/** The principals whose strength backs the loan: the guarantors, or (no guaranty, e.g. HUD) those who owe a PFS. */
export function backingPrincipals(ctx: SubmissionContext): SubmissionPrincipal[] {
  const guarantors = ctx.principals.filter(isGuarantor);
  return guarantors.length ? guarantors : ctx.principals.filter((p) => p.owes.includes("pfs"));
}

function pfsFresh(p: SubmissionPrincipal, now: Date): boolean {
  if (!p.hasPfs || !p.pfsAsOf) return false;
  return (now.getTime() - Date.parse(`${p.pfsAsOf}T00:00:00Z`)) / DAY <= PFS_MAX_AGE_DAYS;
}

function statedStrength(ctx: SubmissionContext): boolean {
  const s = ctx.sponsor;
  return Boolean(s && s.statedNetWorthCents !== null && s.statedLiquidityCents !== null && s.statedAsOf);
}

function pfsOnFile(ctx: SubmissionContext): boolean {
  return (ctx.guarantorTotals?.pfsCount ?? 0) > 0 || ctx.principals.some((p) => p.hasPfs);
}

/** Every principal that owes `what` has it; false when nobody is on the chart to owe it. */
function everyOwing(ctx: SubmissionContext, what: "reo_schedule" | "form_1919" | "hud_2530", has1: (p: SubmissionPrincipal) => boolean, fallback: SubmissionPrincipal[] = []): boolean {
  const owing = ctx.principals.filter((p) => p.owes.includes(what));
  const set = owing.length ? owing : fallback;
  return set.length > 0 && set.every(has1);
}

function hasRenovation(ctx: SubmissionContext): boolean {
  const p = prof(ctx);
  return Boolean(p && (p.purpose === "renovation" || p.uses.some((u) => u.kind === "renovation" || u.kind === "hard_costs") || details(ctx).rehab));
}

const isIndependent = (brand: string | undefined) => !brand || /^\s*independent\s*$/i.test(brand);

const incomeWhen = (ctx: SubmissionContext) => isIncomeProperty(playbookOf(ctx), ctx.profile);

/** Playbooks under which a construction purpose is a real ground-up project (everywhere else it does not drop the in-place items). */
export const GROUND_UP_PLAYBOOKS: readonly SubmissionPlaybook[] = ["construction", "c_pace", "mezz_pref", "hud_multifamily", "hud_232"];

/**
 * A project not yet built, with no in-place occupancy, NOI, T-12 or rent
 * roll: the construction playbook; HUD 221(d)(4) (unless it is a substantial
 * rehabilitation) or 232 new construction, or a HUD deal with a construction
 * purpose and no section yet; a mezz or C-PACE piece on a CONSTRUCTION deal
 * or with a construction purpose. A construction purpose on any other
 * playbook (an income property's bank, bridge or agency loan) is not ground-up:
 * its lender still gets the T-12 and rent roll. A ground-up lender needs the
 * construction items instead: the projected stabilized NOI, the as-complete
 * value, the budget (sources and uses; the Construction section where the
 * playbook has one), the timeline and the entitlements.
 */
export function isGroundUp(ctx: SubmissionContext): boolean {
  const p = ctx.profile;
  const pb = playbookOf(ctx);
  if (pb === "construction") return true;
  if (!GROUND_UP_PLAYBOOKS.includes(pb)) return false;
  if (pb === "hud_multifamily" || pb === "hud_232") {
    const hud = p?.programDetails.hud?.section;
    if (hud === "221d4") return p?.purpose !== "renovation";
    if (hud === "232_new") return true;
    return !hud && p?.purpose === "construction";
  }
  return ctx.deal.program === "CONSTRUCTION" || p?.purpose === "construction";
}

const inPlaceWhen = (ctx: SubmissionContext) => incomeWhen(ctx) && !isGroundUp(ctx);
const INCOME_OR_RENTAL: readonly SubmissionPlaybook[] = [...INCOME_PLAYBOOKS, "dscr_rental"];

/** Requirement definitions, in display order within each section. */
export const SUBMISSION_REQUIREMENTS: readonly SubmissionRequirement[] = [
  // Loan request ------------------------------------------------------------------
  {
    id: "request.amount",
    section: "loan_request",
    label: "Loan amount",
    levels: all(RR),
    met: (ctx) => (ctx.deal.loanAmountCents ?? 0) > 0,
    fix: { target: { kind: "deal_details" }, hint: "Enter the loan amount on the deal's Details form." },
  },
  {
    id: "request.purpose",
    section: "loan_request",
    label: "Loan purpose",
    levels: all(RR),
    met: (ctx) => has(prof(ctx)?.purpose),
    fields: ["purpose"],
    fix: { target: { kind: "editor", section: "loan_request", field: "purpose" }, hint: "Pick acquisition, refinance, cash-out, construction, renovation or recapitalization." },
  },
  {
    id: "request.structure",
    section: "loan_request",
    label: "Requested term, rate type and amortization or interest-only period",
    levels: all(rR),
    met: (ctx) => {
      const p = prof(ctx);
      return Boolean(p && has(p.requestedTermMonths) && has(p.rateType) && (has(p.requestedAmortMonths) || has(p.requestedIoMonths)));
    },
    fields: ["requestedTermMonths", "rateType", "requestedAmortMonths", "requestedIoMonths"],
    fix: { target: { kind: "editor", section: "loan_request", field: "requestedTermMonths" }, hint: "Add the term, fixed or floating, and the amortization or interest-only months." },
  },
  {
    id: "request.recourse_lien",
    section: "loan_request",
    label: "Recourse sought and lien position",
    levels: all(RR),
    met: (ctx) => has(prof(ctx)?.recourse) && has(prof(ctx)?.lienPosition),
    fields: ["recourse", "lienPosition"],
    fix: { target: { kind: "editor", section: "loan_request", field: "recourse" }, hint: "Say what recourse the borrower is asking for and the lien position." },
  },
  {
    id: "request.close_date",
    section: "loan_request",
    label: "Target closing date",
    levels: all(rR),
    met: (ctx) => has(prof(ctx)?.targetCloseDate),
    fields: ["targetCloseDate", "closeDriver"],
    fix: { target: { kind: "editor", section: "loan_request", field: "targetCloseDate" }, hint: "Add the target closing date and what drives it (contract deadline, maturity)." },
  },
  {
    id: "request.existing_debt",
    section: "loan_request",
    label: "Existing debt: lender, balance and maturity",
    levels: all(RR),
    when: (ctx) => REFINANCE_PURPOSES.includes(prof(ctx)?.purpose ?? "acquisition"),
    met: (ctx) => {
      const p = prof(ctx);
      return Boolean(p && has(p.existingLender) && has(p.existingDebtCents) && has(p.existingMaturityDate));
    },
    fields: ["existingLender", "existingDebtCents", "existingMaturityDate"],
    fix: { target: { kind: "editor", section: "loan_request", field: "existingLender" }, hint: "On a refinance, name the current lender, the balance and the maturity date." },
  },
  {
    id: "request.cash_out_use",
    section: "loan_request",
    label: "Use of cash-out proceeds",
    levels: all(RR),
    when: (ctx) => (prof(ctx)?.cashOutCents ?? 0) > 0,
    met: (ctx) => has(prof(ctx)?.cashOutUse),
    fields: ["cashOutUse"],
    fix: { target: { kind: "editor", section: "loan_request", field: "cashOutUse" }, hint: "Say what the cash-out is for." },
  },

  // Property --------------------------------------------------------------------------
  {
    id: "property.identity",
    section: "property",
    label: "Property address, state and type",
    levels: all(RR),
    met: (ctx) => has(ctx.deal.propertyAddress) && has(ctx.deal.propertyState) && has(prof(ctx)?.assetType),
    fields: ["assetType"],
    fix: { target: { kind: "editor", section: "property", field: "assetType" }, hint: "Pick the property type here; the address and state are on the deal's Details form." },
  },
  {
    id: "property.size",
    section: "property",
    label: "Property size (units, keys, beds or SF)",
    levels: all(RR),
    when: (ctx) => prof(ctx)?.assetType !== "LAND",
    met: (ctx) => has(prof(ctx)?.sizeCount) && has(prof(ctx)?.sizeUnit),
    fields: ["sizeCount", "sizeUnit"],
    fix: { target: { kind: "editor", section: "property", field: "sizeCount" }, hint: "Enter the size and its unit." },
  },
  {
    id: "property.occupancy",
    section: "property",
    label: "Occupancy and its as-of date",
    levels: only(INCOME_OR_RENTAL, RR),
    // Ground-up: nothing is occupied yet.
    when: (ctx) => !isGroundUp(ctx),
    met: (ctx) => has(prof(ctx)?.occupancyPct) && has(prof(ctx)?.occupancyAsOf),
    fields: ["occupancyPct", "occupancyAsOf"],
    fix: { target: { kind: "editor", section: "property", field: "occupancyPct" }, hint: "Enter physical occupancy and the date it was measured." },
  },

  // Value -------------------------------------------------------------------------------
  {
    id: "value.basis",
    section: "value",
    label: "Purchase price (acquisition) or as-is value with its source and date",
    levels: all(RR),
    met: (ctx) => {
      const p = prof(ctx);
      if (!p) return false;
      if (p.purpose === "acquisition") return (p.purchasePriceCents ?? 0) > 0;
      return (p.asIsValueCents ?? 0) > 0 && has(p.asIsValueSource) && has(p.asIsValueAsOf);
    },
    fields: ["purchasePriceCents", "asIsValueCents", "asIsValueSource", "asIsValueAsOf"],
    fix: { target: { kind: "editor", section: "value", field: "asIsValueCents" }, hint: "On an acquisition enter the purchase price; otherwise the as-is value, where it came from and its date." },
  },
  {
    id: "value.stabilized",
    section: "value",
    label: "Stabilized, as-complete or after-repair value with its source",
    levels: all(RR),
    when: (ctx) => [...SHORT_TERM_PLAYBOOKS, "c_pace"].includes(playbookOf(ctx)) || isGroundUp(ctx),
    met: (ctx) => (prof(ctx)?.stabilizedValueCents ?? 0) > 0 && has(prof(ctx)?.stabilizedValueSource),
    fields: ["stabilizedValueCents", "stabilizedValueSource"],
    fix: { target: { kind: "editor", section: "value", field: "stabilizedValueCents" }, hint: "Enter the stabilized (or after-repair) value and its source." },
  },

  // Operating financials ----------------------------------------------------------------
  {
    id: "financials.noi_in_place",
    section: "financials",
    label: "In-place NOI with its period end and basis",
    levels: only(INCOME_OR_RENTAL, RR),
    when: inPlaceWhen,
    met: (ctx) => {
      const p = prof(ctx);
      return Boolean(p && has(p.noiInPlaceCents) && has(p.noiPeriodEnd) && has(p.noiBasis)) || (ctx.spreadBundleKinds.includes("operating_statement") && ctx.spreads?.noiCents != null);
    },
    fields: ["noiInPlaceCents", "noiPeriodEnd", "noiBasis"],
    fix: { target: { kind: "editor", section: "financials", field: "noiInPlaceCents" }, hint: "Enter NOI, the period it ends and its basis (T-12, T-3), or save an operating-statement spread." },
  },
  {
    id: "financials.noi_stabilized",
    section: "financials",
    label: "Stabilized NOI and the months to reach it",
    levels: only([...INCOME_PLAYBOOKS, "construction"], RR),
    when: (ctx) => ["bridge", "hotel_pip_bridge", "construction", "mezz_pref"].includes(playbookOf(ctx)) || isGroundUp(ctx),
    met: (ctx) => has(prof(ctx)?.noiStabilizedCents) && has(prof(ctx)?.stabilizationMonths),
    fields: ["noiStabilizedCents", "stabilizationMonths"],
    fix: { target: { kind: "editor", section: "financials", field: "noiStabilizedCents" }, hint: "Enter the pro forma NOI and how many months it takes to get there." },
    // Ground-up construction has no operating financials section; its Construction section carries the projected NOI.
    resolveFix: (ctx) => (sectionView("financials", playbookOf(ctx), ctx.profile) ? { kind: "editor", section: "financials", field: "noiStabilizedCents" } : { kind: "editor", section: "construction", field: "noiStabilizedCents" }),
  },
  {
    id: "financials.dscr_assumption",
    section: "financials",
    label: "Assumed rate and amortization, so DSCR can be shown",
    levels: only(INCOME_OR_RENTAL, rR),
    when: incomeWhen,
    met: (ctx) => has(prof(ctx)?.assumedRatePct) && has(prof(ctx)?.assumedAmortMonths),
    fields: ["assumedRatePct", "assumedAmortMonths"],
    fix: { target: { kind: "editor", section: "loan_request", field: "assumedRatePct" }, hint: "Add a sizing rate and amortization; lenders see DSCR labeled as an assumption, not a quote." },
  },
  {
    id: "docs.t12",
    section: "documents",
    label: "T-12 operating statement",
    levels: only(INCOME_OR_RENTAL, rR),
    when: inPlaceWhen,
    met: (ctx) => docOnHand(ctx, ["T12"], ["t12"]),
    resolveFix: checklistFix("t12"),
    fix: { target: { kind: "checklist" }, hint: "Upload the trailing-12-month operating statement through the latest full month." },
  },
  {
    id: "docs.rent_roll",
    section: "documents",
    label: "Rent roll, census or STR report",
    levels: only(INCOME_OR_RENTAL, rR),
    when: inPlaceWhen,
    met: (ctx) => {
      const asset = prof(ctx)?.assetType ?? null;
      if (asset && HOTEL_ASSETS.has(asset)) return docOnHand(ctx, ["STR_REPORT"], ["str_report"]);
      if (asset && SENIOR_ASSETS.has(asset)) return docOnHand(ctx, ["CENSUS"], ["census_payor_mix"]);
      if (asset) return docOnHand(ctx, ["RENT_ROLL"], ["rent_roll", "rent_roll_certified"]);
      return docOnHand(ctx, ["RENT_ROLL", "CENSUS", "STR_REPORT"], ["rent_roll", "rent_roll_certified", "census_payor_mix", "str_report"]);
    },
    resolveFix: (ctx) => {
      const asset = prof(ctx)?.assetType ?? "";
      return checklistFix(HOTEL_ASSETS.has(asset) ? "str_report" : SENIOR_ASSETS.has(asset) ? "census_payor_mix" : "rent_roll")(ctx);
    },
    fix: { target: { kind: "checklist" }, hint: "Upload the current rent roll (a census for senior housing, an STR report for a hotel)." },
  },

  // Sponsor -------------------------------------------------------------------------------
  {
    id: "sponsor.entity",
    section: "sponsor",
    label: "Borrowing entity on the org chart",
    levels: all(rR),
    met: (ctx) => has(ctx.deal.borrowerName) && ctx.principals.some((p) => p.roles.includes("borrower_entity")),
    fix: { target: { kind: "principals" }, hint: "Name the borrower on the deal and add the borrowing entity to the org chart." },
  },
  {
    id: "sponsor.guarantor",
    section: "sponsor",
    label: "Guarantor on the org chart",
    levels: except(HUD, rR),
    met: (ctx) => ctx.principals.some(isGuarantor),
    fix: { target: { kind: "principals" }, hint: "Mark who guarantees (full recourse or the carve-outs) on the org chart." },
  },
  {
    id: "sponsor.experience",
    section: "sponsor",
    label: "Sponsor experience summary and track record",
    levels: all(RR),
    met: (ctx) => {
      const s = ctx.sponsor;
      return Boolean(s && (s.experienceSummary?.trim().length ?? 0) >= 80 && (has(s.yearsExperience) || has(s.similarProjectsCount) || has(s.portfolioCount)));
    },
    perBorrower: () => true,
    fix: { target: { kind: "editor", section: "sponsor" }, hint: "Write at least a few sentences of relevant experience and add years, similar projects or portfolio size." },
  },
  {
    id: "sponsor.strength",
    section: "sponsor",
    label: "Sponsor net worth and liquidity (stated at screen; a current PFS for every guarantor by term sheet)",
    levels: all(RR),
    met: (ctx) => statedStrength(ctx) || pfsOnFile(ctx),
    // VERIFY: PFS_MAX_AGE_DAYS (90) is a market norm.
    termSheetMet: (ctx) => {
      const backers = backingPrincipals(ctx);
      return backers.length > 0 && backers.every((p) => pfsFresh(p, ctx.now));
    },
    perBorrower: (ctx) => !pfsOnFile(ctx) && statedStrength(ctx),
    fix: { target: { kind: "principals" }, hint: "At screen, enter the stated net worth and liquidity with a date; by term sheet, a PFS under 90 days old for each guarantor." },
  },
  {
    id: "sponsor.reo",
    section: "sponsor",
    label: "Schedule of real estate owned for each key principal",
    levels: except(["hard_money", "fix_flip"], rR),
    met: (ctx) => everyOwing(ctx, "reo_schedule", (p) => p.hasReoSchedule, backingPrincipals(ctx)),
    fix: { target: { kind: "principals" }, hint: "Add the REO schedule (with debt and maturities) for each key principal." },
  },
  {
    id: "sponsor.credit",
    section: "sponsor",
    label: "Credit band and credit events answered",
    levels: only(["hard_money", "fix_flip", "dscr_rental", ...SBA, "bank", "bridge"], RR),
    met: (ctx) => {
      const s = ctx.sponsor;
      return Boolean(s && has(s.creditBand) && creditEventKinds.every((k) => typeof s.creditEvents[k]?.occurred === "boolean"));
    },
    perBorrower: () => true,
    fix: { target: { kind: "editor", section: "sponsor" }, hint: "Enter the self-reported credit band and answer yes or no for bankruptcy, foreclosure, judgments and litigation." },
  },

  // Plan and exit ------------------------------------------------------------------------
  {
    id: "plan.narrative",
    section: "plan_exit",
    label: "Business plan in a paragraph",
    levels: { all: rR, ...only(SHORT_TERM_PLAYBOOKS, RR) },
    met: (ctx) => (prof(ctx)?.businessPlan?.trim().length ?? 0) >= 200,
    fields: ["businessPlan"],
    fix: { target: { kind: "editor", section: "plan_exit", field: "businessPlan" }, hint: "Describe the plan in a paragraph (200 characters or more)." },
  },
  {
    id: "plan.exit",
    section: "plan_exit",
    label: "Exit strategy, timing and detail",
    levels: only(SHORT_TERM_PLAYBOOKS, RR),
    met: (ctx) => has(prof(ctx)?.exitStrategy) && has(prof(ctx)?.exitMonths) && has(prof(ctx)?.exitDetail),
    fields: ["exitStrategy", "exitMonths", "exitDetail"],
    fix: { target: { kind: "editor", section: "plan_exit", field: "exitStrategy" }, hint: "Say how the loan is repaid (sale or refinance), in how many months, and the take-out." },
  },
  {
    id: "plan.risks",
    section: "plan_exit",
    label: "Known weaknesses, each with a mitigant",
    levels: all(rR),
    met: (ctx) => (prof(ctx)?.risks ?? []).some((x) => x.risk.trim() && x.mitigant.trim()),
    fields: ["risks"],
    fix: { target: { kind: "editor", section: "plan_exit", field: "risks" }, hint: "State the weak spot plainly and how it is mitigated." },
  },

  // Sources and uses ----------------------------------------------------------------------
  {
    id: "capital.sources_uses",
    section: "sources_uses",
    label: "Sources and uses that balance, with the loan line equal to the loan amount",
    levels: all(rR),
    // A ground-up project without a Construction section (HUD 221(d)(4) or 232, mezz) carries its budget in its sources and uses.
    screenRequiredWhen: (ctx) => ["acquisition", "construction", "renovation"].includes(prof(ctx)?.purpose ?? "") || (isGroundUp(ctx) && !["construction", "c_pace"].includes(playbookOf(ctx))),
    met: (ctx) => {
      const p = prof(ctx);
      if (!p || !p.sources.length || !p.uses.length) return false;
      const loan = ctx.deal.loanAmountCents;
      const tranche = sum(p.sources.filter((l) => l.kind === playbookTrancheSource[p.playbook]));
      return sum(p.sources) === sum(p.uses) && loan !== null && tranche === loan;
    },
    fields: ["sources", "uses"],
    fix: { target: { kind: "editor", section: "sources_uses" }, hint: "Add every source and use; the totals must match and the loan line must equal the loan amount." },
  },

  // Construction -----------------------------------------------------------------------------
  {
    id: "construction.budget",
    section: "construction",
    label: "Budget by category",
    levels: only(["construction", "c_pace"], RR),
    met: (ctx) => Boolean(details(ctx).construction?.budget) || ctx.spreadFigures.constructionBudget !== null,
    fields: ["programDetails.construction.budget"],
    fix: { target: { kind: "editor", section: "construction", field: "programDetails.construction.budget" }, hint: "Enter land, hard, soft, contingency, developer fee, financing and reserves, or save a budget spread." },
  },
  {
    id: "construction.timeline",
    section: "construction",
    label: "Construction and lease-up months",
    levels: only(["construction", "c_pace"], RR),
    // C-PACE has the Construction section; it applies when the improvements are new construction.
    when: (ctx) => playbookOf(ctx) === "construction" || isGroundUp(ctx),
    met: (ctx) => has(details(ctx).construction?.constructionMonths) && has(details(ctx).construction?.leaseUpMonths),
    fields: ["programDetails.construction.constructionMonths", "programDetails.construction.leaseUpMonths"],
    fix: { target: { kind: "editor", section: "construction", field: "programDetails.construction.constructionMonths" }, hint: "Enter the build months and the lease-up (or sell-out) months." },
  },
  {
    id: "construction.entitlements",
    section: "construction",
    label: "Entitlement and permit status",
    levels: only(["construction", "c_pace"], RR),
    when: (ctx) => playbookOf(ctx) === "construction" || isGroundUp(ctx),
    met: (ctx) => has(details(ctx).construction?.entitlementStatus) && has(details(ctx).construction?.permitStatus),
    fields: ["programDetails.construction.entitlementStatus", "programDetails.construction.permitStatus"],
    fix: { target: { kind: "editor", section: "construction", field: "programDetails.construction.entitlementStatus" }, hint: "Say where entitlements and building permits stand." },
  },
  {
    id: "construction.gc",
    section: "construction",
    label: "General contractor named, with license and a CSLB check on file",
    levels: only(["construction"], rR),
    met: (ctx) => {
      const c = ctx.construction;
      return Boolean(c && has(c.project.generalContractorName) && has(c.project.generalContractorLicense) && c.licenseCheck);
    },
    resolveFix: (ctx) => ({ kind: "construction_project", projectId: ctx.construction?.project.id ?? null }),
    fix: { target: { kind: "construction_project", projectId: null }, hint: "Name the GC and license on the construction project and run the CSLB check." },
  },
  {
    id: "construction.track_record",
    section: "construction",
    label: "Ground-up projects the sponsor has completed",
    levels: only(["construction"], RR),
    met: (ctx) => has(details(ctx).construction?.groundUpProjectsCompleted),
    fields: ["programDetails.construction.groundUpProjectsCompleted"],
    fix: { target: { kind: "editor", section: "construction", field: "programDetails.construction.groundUpProjectsCompleted" }, hint: "Enter how many ground-up projects the sponsor has completed." },
  },

  // Rehab and the hard money file ---------------------------------------------------------
  {
    id: "rehab.budget",
    section: "rehab",
    label: "Rehab or capex budget",
    levels: only(["bridge", "hotel_pip_bridge"], RR),
    when: (ctx) => playbookOf(ctx) !== "bridge" || hasRenovation(ctx),
    met: (ctx) => (details(ctx).rehab?.budgetCents ?? 0) > 0 || (playbookOf(ctx) === "hotel_pip_bridge" && (details(ctx).hotel?.pip?.budgetCents ?? 0) > 0),
    fields: ["programDetails.rehab.budgetCents"],
    fix: { target: { kind: "editor", section: "rehab", field: "programDetails.rehab.budgetCents" }, hint: "Enter the renovation budget, scope and months." },
  },
  {
    id: "hm.file",
    section: "rehab",
    label: "Hard money file (purchase price, ARV, scope, track record, exit)",
    levels: only(["hard_money", "fix_flip"], RR),
    met: (ctx) => ctx.hardMoney !== null,
    fix: { target: { kind: "hard_money_file" }, hint: "Open the hard money file on the deal checklist." },
  },
  {
    id: "hm.values_agree",
    section: "value",
    label: "As-is value and purchase price agree with the hard money file",
    levels: only(["hard_money", "fix_flip"], RR),
    when: (ctx) => ctx.hardMoney !== null && (prof(ctx)?.asIsValueCents != null || prof(ctx)?.purchasePriceCents != null),
    met: (ctx) => {
      const p = prof(ctx);
      const hm = ctx.hardMoney!;
      const cents = (d: number) => Math.round(d * 100);
      return (p?.asIsValueCents == null || p.asIsValueCents === cents(hm.asIsValue)) && (p?.purchasePriceCents == null || p.purchasePriceCents === cents(hm.purchasePrice));
    },
    fields: ["asIsValueCents", "purchasePriceCents"],
    fix: { target: { kind: "editor", section: "value", field: "asIsValueCents" }, hint: "The email shows one as-is value and purchase price, from the hard money file; correct whichever record is wrong." },
  },
  {
    id: "hm.scope_lines",
    section: "rehab",
    label: "Scope of work with line costs",
    levels: only(["fix_flip"], rR),
    met: (ctx) => (ctx.hardMoney?.scopeOfWork.length ?? 0) > 0,
    fix: { target: { kind: "hard_money_file" }, hint: "Add the scope-of-work lines with costs and weeks." },
  },

  // Rental (DSCR) -------------------------------------------------------------------------------
  {
    id: "rental.rent",
    section: "rental",
    label: "Monthly rent (lease or market), taxes and insurance",
    levels: only(["dscr_rental"], RR),
    met: (ctx) => {
      const x = details(ctx).rental;
      return Boolean(x && (has(x.monthlyRentCents) || has(x.marketRentCents)) && has(x.monthlyTaxesCents) && has(x.monthlyInsuranceCents));
    },
    fields: ["programDetails.rental.monthlyRentCents", "programDetails.rental.marketRentCents", "programDetails.rental.monthlyTaxesCents", "programDetails.rental.monthlyInsuranceCents"],
    fix: { target: { kind: "editor", section: "rental", field: "programDetails.rental.monthlyRentCents" }, hint: "Enter the lease rent and market rent, and the monthly taxes and insurance." },
  },
  {
    id: "rental.lease_status",
    section: "rental",
    label: "Lease status (leased, vacant or short-term)",
    levels: only(["dscr_rental"], RR),
    met: (ctx) => has(details(ctx).rental?.leaseStatus),
    fields: ["programDetails.rental.leaseStatus"],
    fix: { target: { kind: "editor", section: "rental", field: "programDetails.rental.leaseStatus" }, hint: "Say whether the property is leased, vacant or a short-term rental." },
  },

  // SBA ------------------------------------------------------------------------------------------
  {
    id: "sba.business",
    section: "sba",
    label: "Operating business: name, NAICS and years in business",
    levels: only(SBA, RR),
    met: (ctx) => {
      const x = details(ctx).sba;
      return Boolean(x && has(x.businessName) && has(x.naics) && has(x.yearsInBusiness));
    },
    fields: ["programDetails.sba.businessName", "programDetails.sba.naics", "programDetails.sba.yearsInBusiness"],
    fix: { target: { kind: "editor", section: "sba", field: "programDetails.sba.businessName" }, hint: "Name the operating business, its NAICS code and years in business." },
  },
  {
    id: "sba.occupancy",
    section: "sba",
    label: "Owner-occupied share of the property",
    levels: only(SBA, RR),
    met: (ctx) => has(prof(ctx)?.ownerOccupiedPct),
    fields: ["ownerOccupiedPct"],
    fix: { target: { kind: "editor", section: "property", field: "ownerOccupiedPct" }, hint: "Enter the share the business occupies (VERIFY: 51% for an existing building, 60% for new construction)." },
  },
  {
    id: "sba.cash_flow",
    section: "sba",
    label: "Business revenue, EBITDA and existing debt service, or a global cash flow spread",
    levels: only(SBA, RR),
    met: (ctx) => {
      const x = details(ctx).sba;
      return Boolean(x && has(x.businessRevenueCents) && has(x.businessEbitdaCents) && has(x.existingBusinessDebtServiceCents)) || ctx.spreadFigures.globalCashFlow !== null;
    },
    fields: ["programDetails.sba.businessRevenueCents", "programDetails.sba.businessEbitdaCents", "programDetails.sba.existingBusinessDebtServiceCents"],
    fix: { target: { kind: "editor", section: "sba", field: "programDetails.sba.businessRevenueCents" }, hint: "Enter revenue, EBITDA and current debt service, or save a global cash flow spread." },
  },
  {
    id: "sba.injection",
    section: "sba",
    label: "Equity injection and its source",
    levels: only(SBA, RR),
    met: (ctx) => has(details(ctx).sba?.equityInjectionCents) && has(details(ctx).sba?.equityInjectionSource),
    fields: ["programDetails.sba.equityInjectionCents", "programDetails.sba.equityInjectionSource"],
    fix: { target: { kind: "editor", section: "sba", field: "programDetails.sba.equityInjectionCents" }, hint: "Enter the equity injection and where it comes from." },
  },
  {
    id: "sba.eligibility_flags",
    section: "sba",
    label: "Franchise, change of ownership and affiliates answered",
    levels: only(SBA, rR),
    met: (ctx) => {
      const x = details(ctx).sba;
      return Boolean(x && typeof x.franchise === "boolean" && typeof x.changeOfOwnership === "boolean" && typeof x.affiliates === "boolean");
    },
    fields: ["programDetails.sba.franchise", "programDetails.sba.changeOfOwnership", "programDetails.sba.affiliates"],
    fix: { target: { kind: "editor", section: "sba", field: "programDetails.sba.franchise" }, hint: "Answer yes or no for franchise, change of ownership and affiliates." },
  },
  {
    id: "sba.forms",
    section: "sba",
    label: "SBA Form 1919 for each principal that owes it",
    levels: only(SBA, { term_sheet: r }),
    met: (ctx) => everyOwing(ctx, "form_1919", (p) => p.hasForm1919),
    fix: { target: { kind: "principals" }, hint: "Collect Form 1919 from each 20%+ owner and controlling person." },
  },

  // Hotel ------------------------------------------------------------------------------------------
  {
    id: "hotel.identity",
    section: "hotel",
    label: "Keys, brand (or independent) and management company",
    levels: only(HOTEL, RR),
    met: (ctx) => {
      const p = prof(ctx);
      return Boolean(p && p.sizeUnit === "keys" && (p.sizeCount ?? 0) > 0 && has(details(ctx).hotel?.brand) && has(ctx.sponsor?.managementCompany));
    },
    fields: ["sizeCount", "programDetails.hotel.brand"],
    fix: { target: { kind: "editor", section: "hotel", field: "programDetails.hotel.brand" }, hint: "Enter the keys, the flag (or Independent) and the management company (sponsor section)." },
  },
  {
    id: "hotel.performance",
    section: "hotel",
    label: "Occupancy, ADR and RevPAR",
    levels: only(HOTEL, RR),
    met: (ctx) => {
      const h = details(ctx).hotel;
      const str = ctx.spreadFigures.hotelStr;
      return (has(prof(ctx)?.occupancyPct) || str !== null) && (has(h?.adrCents) || str !== null) && (has(h?.revparCents) || str !== null);
    },
    fields: ["occupancyPct", "programDetails.hotel.adrCents", "programDetails.hotel.revparCents"],
    fix: { target: { kind: "editor", section: "hotel", field: "programDetails.hotel.adrCents" }, hint: "Enter occupancy, ADR and RevPAR, or save an STR spread." },
  },
  {
    id: "hotel.franchise_term",
    section: "hotel",
    label: "Franchise expiry for a branded hotel",
    levels: only(HOTEL, rR),
    when: (ctx) => !isIndependent(details(ctx).hotel?.brand),
    met: (ctx) => has(details(ctx).hotel?.franchiseExpiry),
    fields: ["programDetails.hotel.franchiseExpiry"],
    fix: { target: { kind: "editor", section: "hotel", field: "programDetails.hotel.franchiseExpiry" }, hint: "Enter when the franchise agreement expires; lenders want it to run past the loan." },
  },
  {
    id: "hotel.pip",
    section: "hotel",
    label: "PIP answered; if one is required, its budget and deadline",
    levels: only(HOTEL, RR),
    met: (ctx) => {
      const pip = details(ctx).hotel?.pip;
      return Boolean(pip && (!pip.required || (has(pip.budgetCents) && has(pip.deadline))));
    },
    fields: ["programDetails.hotel.pip"],
    fix: { target: { kind: "editor", section: "hotel", field: "programDetails.hotel.pip" }, hint: "Say whether the brand requires a PIP, and if so its budget and deadline." },
  },

  // Tenancy ------------------------------------------------------------------------------------------
  {
    id: "tenancy.rollover",
    section: "tenancy",
    label: "Top tenants with their lease ends",
    levels: only(["cmbs", "life_company", "bank"], RR),
    when: (ctx) => playbookOf(ctx) !== "bank" || prof(ctx)?.tenancy === "multi_tenant",
    met: (ctx) => {
      const t = details(ctx).tenancy?.topTenants ?? [];
      return t.length > 0 && t.every((x) => has(x.name) && has(x.leaseEnd));
    },
    fields: ["programDetails.tenancy.topTenants"],
    fix: { target: { kind: "editor", section: "tenancy", field: "programDetails.tenancy.topTenants" }, hint: "List the largest tenants, their share of rent and lease end dates." },
  },

  // Agency -------------------------------------------------------------------------------------------
  {
    id: "agency.occupancy",
    section: "agency",
    label: "Economic occupancy and unit mix",
    levels: only(["agency"], RR),
    met: (ctx) => has(details(ctx).agency?.economicOccupancyPct) && ((details(ctx).agency?.unitMix?.length ?? 0) > 0 || ctx.spreadBundleKinds.includes("rent_roll")),
    fields: ["programDetails.agency.economicOccupancyPct", "programDetails.agency.unitMix"],
    fix: { target: { kind: "editor", section: "agency", field: "programDetails.agency.economicOccupancyPct" }, hint: "Enter economic occupancy and the unit mix (or save a rent-roll spread)." },
  },

  // HUD ------------------------------------------------------------------------------------------------
  {
    id: "hud.section",
    section: "hud",
    label: "HUD program section and repairs",
    levels: only(HUD, RR),
    met: (ctx) => has(details(ctx).hud?.section) && has(details(ctx).hud?.repairsCents),
    fields: ["programDetails.hud.section", "programDetails.hud.repairsCents"],
    fix: { target: { kind: "editor", section: "hud", field: "programDetails.hud.section" }, hint: "Pick the HUD section and enter the repairs the CNA calls for (0 when none)." },
  },
  {
    id: "hud.232_operations",
    section: "hud",
    label: "Licensed beds, operator and payor mix",
    levels: only(["hud_232"], RR),
    met: (ctx) => {
      const h = details(ctx).hud;
      return Boolean(h && has(h.licensedBeds) && has(h.operatorName) && (has(h.payorMixNote) || ctx.spreadBundleKinds.includes("senior_census") || ctx.spreads?.payorMix));
    },
    fields: ["programDetails.hud.licensedBeds", "programDetails.hud.operatorName", "programDetails.hud.payorMixNote"],
    fix: { target: { kind: "editor", section: "hud", field: "programDetails.hud.licensedBeds" }, hint: "Enter licensed beds, the operator and the payor mix (or save a census spread)." },
  },
  {
    id: "hud.prior_participation",
    section: "hud",
    label: "Prior HUD participation answered; HUD-2530 on file by term sheet",
    levels: only(HUD, rR),
    met: (ctx) => typeof details(ctx).hud?.priorHudParticipation === "boolean",
    termSheetMet: (ctx) => typeof details(ctx).hud?.priorHudParticipation === "boolean" && everyOwing(ctx, "hud_2530", (p) => p.hasHud2530),
    fields: ["programDetails.hud.priorHudParticipation"],
    fix: { target: { kind: "principals" }, hint: "Answer prior HUD participation; collect HUD-2530 from each principal that owes it." },
  },

  // Capital stack ------------------------------------------------------------------------------------------
  {
    id: "stack.senior",
    section: "capital_stack",
    label: "Senior lender, amount, maturity and whether it allows subordinate financing",
    levels: only(STACK, RR),
    met: (ctx) => {
      const s = details(ctx).capitalStack;
      return Boolean(s && has(s.seniorLender) && has(s.seniorAmountCents) && has(s.seniorMaturity) && typeof s.seniorAllowsSubordinate === "boolean");
    },
    fields: ["programDetails.capitalStack.seniorLender", "programDetails.capitalStack.seniorAmountCents", "programDetails.capitalStack.seniorMaturity", "programDetails.capitalStack.seniorAllowsSubordinate"],
    fix: { target: { kind: "editor", section: "capital_stack", field: "programDetails.capitalStack.seniorLender" }, hint: "Enter the senior lender, its loan amount and maturity, and whether it allows this tranche." },
  },
  {
    id: "stack.consent",
    section: "capital_stack",
    label: "Intercreditor or mortgage-holder consent status",
    levels: only(STACK, RR),
    met: (ctx) => {
      const s = details(ctx).capitalStack;
      return playbookOf(ctx) === "c_pace" ? has(s?.consentStatus) : has(s?.intercreditorStatus);
    },
    fields: ["programDetails.capitalStack.intercreditorStatus", "programDetails.capitalStack.consentStatus"],
    fix: { target: { kind: "editor", section: "capital_stack", field: "programDetails.capitalStack.intercreditorStatus" }, hint: "Say where the intercreditor agreement (or the mortgage holder's C-PACE consent) stands." },
  },
  {
    id: "cpace.improvements",
    section: "capital_stack",
    label: "Eligible improvements cost and program jurisdiction",
    levels: only(["c_pace"], RR),
    met: (ctx) => has(details(ctx).capitalStack?.eligibleImprovementsCents) && has(details(ctx).capitalStack?.programJurisdiction),
    fields: ["programDetails.capitalStack.eligibleImprovementsCents", "programDetails.capitalStack.programJurisdiction"],
    fix: { target: { kind: "editor", section: "capital_stack", field: "programDetails.capitalStack.eligibleImprovementsCents" }, hint: "Enter the eligible improvements cost and the county or city program." },
  },
];

const BY_ID = new Map(SUBMISSION_REQUIREMENTS.map((q) => [q.id, q]));

export function requirementById(id: string): SubmissionRequirement | undefined {
  return BY_ID.get(id);
}

/** The level an item has for a playbook at Screen or Term sheet; undefined when the playbook does not have it there. */
export function requirementLevel(req: SubmissionRequirement, playbook: SubmissionPlaybook, stage: "screen" | "term_sheet", ctx?: SubmissionContext): RequirementLevel | undefined {
  const levels = req.levels[playbook] ?? req.levels.all;
  const level = levels?.[stage];
  if (level && stage === "screen" && ctx && req.screenRequiredWhen?.(ctx)) return "required";
  return level;
}

/** A label for a stored requirement id (lender_outreach.readiness_missing), including checklist items. */
export function requirementLabel(id: string): string {
  const req = BY_ID.get(id);
  if (req) return req.label;
  if (id.startsWith("checklist.")) return id.slice("checklist.".length).split(":")[0]!.replace(/_/g, " ");
  return id;
}
