// Suggested values for a new submission profile (spec 4.4). Nothing is
// written here: the editor shows the suggestions and one "Start from these"
// button, and the action saves `profile` with upsertProfile(dealId, null, ...)
// and `sponsor` with upsertSponsor(dealId, null, ...).
//
// Where values come from, best first when two disagree:
//   0  saved spreads (built from the borrower's documents)   source "spread"
//   1  Corin records (hard money file, construction project) source "record"
//   2  public record (property_facts)                        source "public_record"
//   3  the lead intake (what the borrower told us)           source "borrower"
// Fields that only make sense together (NOI and its basis, a value and its
// source, a size and its unit, the exit plan) are taken from one source, so a
// record's figure is never labelled with the borrower's value source.
//
// The intake is read as the qualifier asked it: `value` is the purchase price
// on a purchase and the estimated (as-is) value on a refinance; `noi` is the
// trailing-12 NOI, or the projected stabilized NOI on a construction or
// conversion.
//
// Never copied: a financing-page lead's occupancy (the form's default 85%)
// and NOI (the form does not ask, so it is stored as 0), any intake default
// that cannot be told apart from an answer, an occupancy for a building not
// yet built, the spread's underwritten revenue
// and expenses (they are Corin's normalization, not the T-12's reported
// figures, and must not sit next to a reported NOI), and figures the intake
// states only in combination (taxes, insurance and HOA as one number).

import type { Intake } from "@/lib/validation";
import { spreadIdFor } from "./metrics";
import { defaultPlaybook, isPlaybookAllowed, programDetailKeysFor, sectionView } from "./playbooks";
import { PROFILE_FIELD_SCHEMAS, PROGRAM_DETAIL_SCHEMAS, SPONSOR_FIELD_SCHEMAS } from "./schema";
import {
  isSubmissionAssetType,
  sizeUnits,
  type FieldSource,
  type FieldSourceKey,
  type LoanPurpose,
  type ProfileFieldKey,
  type ProgramDetailKey,
  type ProgramDetails,
  type SizeUnit,
  type SponsorProfileFields,
  type SponsorProfilePatch,
  type SubmissionContext,
  type SubmissionPlaybook,
  type SubmissionProfilePatch,
  type UseLine,
} from "./types";

export type PrefillOrigin = "spread" | "hard_money_file" | "construction_project" | "public_record" | "intake" | "deal_program";

export const PREFILL_ORIGIN_LABELS: Record<PrefillOrigin, string> = {
  spread: "Saved spreads (from the borrower's documents)",
  hard_money_file: "Hard money file",
  construction_project: "Construction project",
  public_record: "Public record",
  intake: "Lead intake (per borrower)",
  deal_program: "Deal program",
};

export type PrefillSuggestion = {
  /** A profile field source key, "sponsor.<field>" or "playbook". */
  field: FieldSourceKey | `sponsor.${keyof SponsorProfileFields}` | "playbook";
  label: string;
  value: unknown;
  /** What the profile's field_sources will record; null for the playbook and sponsor fields (always "per borrower"). */
  source: FieldSource | null;
  origin: PrefillOrigin;
};

export type SubmissionPrefill = {
  playbook: SubmissionPlaybook;
  /** For upsertProfile(dealId, null, profile, actor, now): the values, their program sections and their field sources. */
  profile: SubmissionProfilePatch & { playbook: SubmissionPlaybook };
  /** For upsertSponsor(dealId, null, sponsor, actor, now). */
  sponsor: SponsorProfilePatch;
  /** One row per suggested value, for the review list. */
  suggestions: PrefillSuggestion[];
  /** What the sources said that could not become a value, and why. */
  notes: string[];
};

const RANK: Record<Exclude<PrefillOrigin, "deal_program">, number> = { spread: 0, hard_money_file: 1, construction_project: 1, public_record: 2, intake: 3 };

/** Fields taken together from one source: the best-ranked source that offers any of them supplies all it has. */
const GROUPS: readonly (readonly string[])[] = [
  ["noiInPlaceCents", "noiBasis", "noiPeriodEnd"],
  ["noiStabilizedCents", "stabilizationMonths"],
  ["asIsValueCents", "asIsValueSource", "asIsValueAsOf"],
  ["stabilizedValueCents", "stabilizedValueSource"],
  ["sizeCount", "sizeUnit"],
  ["occupancyPct", "occupancyAsOf"],
  ["purchasePriceCents", "purchaseCloseDate"],
  ["exitStrategy", "exitMonths", "exitDetail"],
];
const GROUP_OF = new Map(GROUPS.flatMap((g) => g.map((f) => [f, g] as const)));

const LABELS: Record<string, string> = {
  purpose: "Loan purpose",
  recourse: "Recourse",
  targetCloseDate: "Target closing date",
  existingDebtCents: "Existing debt",
  assetType: "Property type",
  apn: "APN",
  county: "County",
  yearBuilt: "Year built",
  sizeCount: "Size",
  sizeUnit: "Size unit",
  occupancyPct: "Occupancy",
  floodZone: "Flood zone",
  seismicZone: "Seismic zone",
  purchasePriceCents: "Purchase price",
  asIsValueCents: "As-is value",
  asIsValueSource: "As-is value source",
  stabilizedValueCents: "Stabilized / after-repair value",
  stabilizedValueSource: "Stabilized value source",
  noiInPlaceCents: "In-place NOI",
  noiBasis: "NOI basis",
  noiStabilizedCents: "Stabilized NOI",
  exitStrategy: "Exit strategy",
  exitMonths: "Exit in (months)",
  exitDetail: "Exit detail",
  uses: "Uses of funds",
  "programDetails.hotel.adrCents": "ADR",
  "programDetails.hotel.revparCents": "RevPAR",
  "programDetails.hotel.revparIndex": "RevPAR index",
  "programDetails.hotel.pip": "PIP",
  "programDetails.rehab.budgetCents": "Rehab budget",
  "programDetails.construction.budget": "Construction budget by category",
  "programDetails.construction.constructionMonths": "Construction months",
  "programDetails.construction.leaseUpMonths": "Lease-up months",
  "programDetails.construction.contractType": "Contract type",
  "programDetails.construction.groundUpProjectsCompleted": "Ground-up projects completed",
  "programDetails.rental.monthlyRentCents": "Monthly rent",
  "sponsor.creditBand": "Credit band",
  playbook: "Playbook",
};

type Candidate = { field: string; value: unknown; origin: Exclude<PrefillOrigin, "deal_program">; source: FieldSource };

const cents = (dollars: number) => Math.round(dollars * 100);
const TRANSACTION_PURPOSE: Partial<Record<Intake["transaction"], LoanPurpose>> = { PURCHASE: "acquisition", REFINANCE: "refinance", CONSTRUCTION: "construction", CONVERSION: "renovation" };
const HM_PURPOSE: Record<"PURCHASE" | "REFINANCE", LoanPurpose> = { PURCHASE: "acquisition", REFINANCE: "refinance" };
const SENIOR = new Set(["ASSISTED_LIVING", "MEMORY_CARE", "RCFE", "SNF"]);
const HOTEL = new Set(["HOTEL_FLAGGED", "HOTEL_BOUTIQUE"]);

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A financing-page lead: the short form asks no NOI, value, size or occupancy (lib/validation.ts intakeFromQuick). */
export function isFinancingPageLead(intake: Intake): boolean {
  return intake.source === "financing_page" || Boolean(intake.origin);
}

/**
 * Suggestions for the deal's profile. `playbook` (one allowed for the deal's
 * program) picks which program sections are suggested; default: the profile's,
 * else the program's default.
 */
export function buildPrefill(ctx: SubmissionContext, opts: { actor: string; now?: Date; playbook?: SubmissionPlaybook }): SubmissionPrefill {
  const now = opts.now ?? ctx.now;
  const at = now.toISOString();
  const by = opts.actor;
  const playbook = opts.playbook && isPlaybookAllowed(ctx.deal.program, opts.playbook) ? opts.playbook : (ctx.profile?.playbook ?? defaultPlaybook(ctx.deal.program));
  const notes: string[] = [];
  const out: Candidate[] = [];
  const push = (origin: Candidate["origin"], source: FieldSource, values: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(values)) if (value !== undefined && value !== null) out.push({ field, value, origin, source });
  };

  // Which program sections show for this playbook (suggestions for hidden sections would only be noise).
  const visible = new Set<ProgramDetailKey>(programDetailKeysFor(playbook, null));
  const financialsShown = (size: { sizeCount: number | null; sizeUnit: SizeUnit | null } | null) => sectionView("financials", playbook, size) !== null;

  // 0. Saved spreads -------------------------------------------------------------------
  const sp = ctx.spreads;
  if (sp) {
    const src = (ref: string | null, asOf?: string | null): FieldSource => ({ source: "spread", ref: ref ?? "unknown", ...(asOf ? { asOf } : {}), at, by });
    if (sp.noiCents !== null) push("spread", src(spreadIdFor(ctx, "operating_statement"), sp.asOf), { noiInPlaceCents: sp.noiCents, noiBasis: "t12" });
    const occKind = ctx.spreadBundleKinds.includes("rent_roll") ? "rent_roll" : ctx.spreadBundleKinds.includes("senior_census") ? "senior_census" : "hotel_str";
    const occSrc = src(spreadIdFor(ctx, occKind), sp.asOf);
    if (sp.occupancyPct !== null) push("spread", occSrc, { occupancyPct: sp.occupancyPct });
    if (sp.units !== null && sp.units > 0 && (sizeUnits as readonly string[]).includes(sp.unitLabel ?? "")) push("spread", occSrc, { sizeCount: sp.units, sizeUnit: sp.unitLabel });
    if (visible.has("hotel")) {
      const str = ctx.spreadFigures.hotelStr;
      if (str) push("spread", src(str.spreadId, str.asOf), { "programDetails.hotel.adrCents": str.adrCents, "programDetails.hotel.revparCents": str.revparCents, "programDetails.hotel.revparIndex": str.revparIndex });
      else push("spread", src(spreadIdFor(ctx, "hotel_str"), sp.asOf), { "programDetails.hotel.adrCents": sp.adrCents, "programDetails.hotel.revparCents": sp.revparCents });
    }
    if (sp.revenueCents !== null || sp.expensesCents !== null) {
      notes.push("Revenue and expenses are not copied from the saved spread: it holds Corin's underwritten figures, not the T-12's reported ones. Enter the reported figures from the T-12.");
    }
  }
  const budget = ctx.spreadFigures.constructionBudget;
  if (budget && visible.has("construction")) push("spread", { source: "spread", ref: budget.spreadId, asOf: budget.asOf, at, by }, { "programDetails.construction.budget": { ...budget.budget } });

  // 1. Corin records ----------------------------------------------------------------------
  const hm = ctx.hardMoney;
  if (hm) {
    const src: FieldSource = { source: "record", record: "hm_underwriting", ref: hm.id, at, by };
    push("hard_money_file", src, {
      purpose: HM_PURPOSE[hm.purpose],
      purchasePriceCents: hm.purpose === "PURCHASE" && hm.purchasePrice > 0 ? cents(hm.purchasePrice) : undefined,
      asIsValueCents: hm.asIsValue > 0 ? cents(hm.asIsValue) : undefined,
      stabilizedValueCents: hm.arv > 0 ? cents(hm.arv) : undefined,
      stabilizedValueSource: hm.arv > 0 ? hm.arvSource : undefined,
      exitStrategy: hm.exitPlan.type,
      exitMonths: hm.exitPlan.targetMonths,
      exitDetail: hm.exitPlan.notes,
    });
  }
  const project = ctx.construction?.project;
  if (project) {
    const src: FieldSource = { source: "record", record: "construction_projects", ref: project.id, at, by };
    push("construction_project", src, { sizeCount: project.units && project.units > 0 ? project.units : undefined, sizeUnit: project.units && project.units > 0 ? "units" : undefined, seismicZone: project.seismicZone });
  }

  // 2. Public record ----------------------------------------------------------------------
  const facts = ctx.propertyFacts;
  if (facts) push("public_record", { source: "public_record", ref: facts.id, at, by }, { apn: facts.apn, county: facts.county, floodZone: facts.floodZone, yearBuilt: facts.yearBuilt });

  // 3. The lead intake (per borrower) -------------------------------------------------------
  const intake = ctx.intake;
  const sponsor: SponsorProfilePatch = {};
  const sponsorRows: PrefillSuggestion[] = [];
  if (intake) {
    const src: FieldSource = { source: "borrower", by, at, ...(ctx.deal.leadId ? { ref: ctx.deal.leadId } : {}) };
    const quick = isFinancingPageLead(intake);
    if (quick) notes.push("This lead came from the short form on a financing page, which does not ask for occupancy or NOI: its stored occupancy (the form's default) and NOI (0) are not copied.");
    const purpose = intake.transaction === "HARD_MONEY" ? (intake.hardMoney ? HM_PURPOSE[intake.hardMoney.purpose] : undefined) : intake.origin?.transaction === "OTHER" ? undefined : TRANSACTION_PURPOSE[intake.transaction];
    const unit: SizeUnit = HOTEL.has(intake.assetType) ? "keys" : SENIOR.has(intake.assetType) ? "beds" : "units";
    // What the qualifier asked for (components/express/schema.ts valueLabel, Qualifier "The numbers"):
    // `value` is the purchase price on a purchase, the estimated value on a refinance and the land
    // cost on a build; `noi` is the trailing-12 NOI, or the projected stabilized NOI on a build.
    const building = intake.transaction === "CONSTRUCTION" || intake.transaction === "CONVERSION";
    const valueIs = purpose === "acquisition" ? "price" : purpose === "refinance" ? "as_is" : null;
    const noi = !quick && intake.noi > 0 ? cents(intake.noi) : undefined;
    push("intake", src, {
      assetType: isSubmissionAssetType(intake.assetType) ? intake.assetType : undefined,
      purpose,
      noiInPlaceCents: building ? undefined : noi,
      noiBasis: building || noi === undefined ? undefined : "borrower_stated",
      noiStabilizedCents: building ? noi : undefined,
      purchasePriceCents: intake.value && valueIs === "price" ? cents(intake.value) : undefined,
      asIsValueCents: intake.value && valueIs === "as_is" ? cents(intake.value) : undefined,
      asIsValueSource: intake.value && valueIs === "as_is" ? "sponsor_estimate" : undefined,
      sizeCount: intake.unitCount > 0 ? intake.unitCount : undefined,
      sizeUnit: intake.unitCount > 0 ? unit : undefined,
      // A building not yet built has no occupancy to state.
      occupancyPct: quick || building ? undefined : intake.occupancyPct,
      recourse: intake.nonRecourseOnly ? "non_recourse" : undefined,
      targetCloseDate: ctx.intakeReceivedAt && intake.timelineDays > 0 ? addDays(ctx.intakeReceivedAt, intake.timelineDays) : undefined,
    });
    if (visible.has("hotel")) {
      push("intake", src, {
        "programDetails.hotel.adrCents": intake.adr ? cents(intake.adr) : undefined,
        "programDetails.hotel.pip": intake.pipBudget ? { required: true, budgetCents: cents(intake.pipBudget) } : undefined,
      });
    }
    const h = intake.hardMoney;
    if (h) {
      push("intake", src, {
        stabilizedValueCents: h.arv ? cents(h.arv) : undefined,
        stabilizedValueSource: h.arv ? "sponsor_estimate" : undefined,
        existingDebtCents: h.existingPayoff ? cents(h.existingPayoff) : undefined,
        exitMonths: h.holdMonths,
        "programDetails.rehab.budgetCents": visible.has("rehab") && h.rehabBudget > 0 ? cents(h.rehabBudget) : undefined,
      });
      if (h.rehabBudget > 0 && sectionView("rehab", playbook, null) === "hard_money_file") notes.push("The intake's rehab budget belongs in the hard money file's scope of work, which this playbook reads instead of a rehab section.");
    }
    const c = intake.construction;
    if (c) {
      const contingency = cents((c.hardCosts * c.contingencyPct) / 100);
      const developerFee = cents(((c.hardCosts + c.softCosts) * c.developerFeePct) / 100);
      const lines: UseLine[] = [
        { kind: "land", amountCents: cents(c.landCost) },
        { kind: "hard_costs", amountCents: cents(c.hardCosts) },
        { kind: "soft_costs", amountCents: cents(c.softCosts) },
        { kind: "contingency", amountCents: contingency, note: `${c.contingencyPct}% of hard costs, per borrower` },
        { kind: "developer_fee", amountCents: developerFee, note: `${c.developerFeePct}% of hard and soft costs, per borrower` },
      ];
      push("intake", src, {
        uses: lines.filter((l) => l.amountCents > 0),
        stabilizedValueCents: c.asCompletedValue ? cents(c.asCompletedValue) : undefined,
        stabilizedValueSource: c.asCompletedValue ? "sponsor_estimate" : undefined,
      });
      if (visible.has("construction")) {
        push("intake", src, {
          "programDetails.construction.constructionMonths": c.constructionMonths,
          "programDetails.construction.leaseUpMonths": c.leaseUpMonths,
          "programDetails.construction.contractType": c.gmpContract ? "gmp" : undefined,
          "programDetails.construction.groundUpProjectsCompleted": c.completedProjects > 0 ? c.completedProjects : undefined,
        });
      }
      notes.push("Financing costs and reserves are not in the intake's construction budget; add them to the uses.");
    }
    const r = intake.rental;
    if (r && visible.has("rental")) {
      push("intake", src, { "programDetails.rental.monthlyRentCents": r.monthlyRent > 0 ? cents(r.monthlyRent) : undefined });
      if (r.monthlyTaxesInsuranceHoa > 0) notes.push(`The borrower gave taxes, insurance and HOA together ($${Math.round(r.monthlyTaxesInsuranceHoa).toLocaleString("en-US")} a month); enter each one so PITIA can be calculated.`);
    }
    if (intake.creditBand) {
      sponsor.creditBand = intake.creditBand;
      sponsorRows.push({ field: "sponsor.creditBand", label: LABELS["sponsor.creditBand"]!, value: intake.creditBand, source: null, origin: "intake" });
    }
  }

  // Choose: best-ranked source per field; grouped fields from the source that wins the group's first field.
  const chosen = new Map<string, Candidate>();
  const best = (field: string, from: Candidate[] = out) => from.filter((c) => c.field === field).sort((a, b) => RANK[a.origin] - RANK[b.origin])[0];
  for (const group of GROUPS) {
    const lead = out.filter((c) => group.includes(c.field)).sort((a, b) => RANK[a.origin] - RANK[b.origin])[0];
    if (!lead) continue;
    for (const f of group) {
      const c = out.find((x) => x.field === f && x.origin === lead.origin && x.source === lead.source) ?? out.find((x) => x.field === f && x.origin === lead.origin);
      if (c) chosen.set(f, c);
    }
  }
  for (const c of out) if (!GROUP_OF.has(c.field) && !chosen.has(c.field)) chosen.set(c.field, best(c.field)!);

  // Hidden financials (non-income playbooks): no in-place NOI suggestion. Construction keeps its
  // projected stabilized NOI (its yield on cost and stabilized DSCR need it).
  const size = chosen.get("sizeCount") ? { sizeCount: chosen.get("sizeCount")!.value as number, sizeUnit: (chosen.get("sizeUnit")?.value as SizeUnit | undefined) ?? null } : null;
  if (!financialsShown(size)) {
    for (const f of ["noiInPlaceCents", "noiBasis", "noiPeriodEnd"]) chosen.delete(f);
    if (playbook !== "construction") for (const f of ["noiStabilizedCents", "stabilizationMonths"]) chosen.delete(f);
  }

  // Build the patch, checking each value against its field's schema.
  const profile: SubmissionPrefill["profile"] = { playbook, fieldSources: {} };
  const programDetails: ProgramDetails = {};
  const suggestions: PrefillSuggestion[] = [{ field: "playbook", label: LABELS.playbook!, value: playbook, source: null, origin: "deal_program" }];
  for (const [field, c] of chosen) {
    const m = /^programDetails\.([A-Za-z]+)\.([A-Za-z]+)$/.exec(field);
    if (m) {
      const key = m[1] as ProgramDetailKey;
      const parsed = PROGRAM_DETAIL_SCHEMAS[key].safeParse({ [m[2]!]: c.value });
      if (!parsed.success) {
        notes.push(`${LABELS[field] ?? field} from ${PREFILL_ORIGIN_LABELS[c.origin]} is not suggested: it does not pass the field's checks.`);
        continue;
      }
      programDetails[key] = { ...(programDetails[key] as object | undefined), ...(parsed.data as object) } as never;
    } else {
      const schema = PROFILE_FIELD_SCHEMAS[field as ProfileFieldKey];
      const parsed = schema?.safeParse(c.value);
      if (!parsed?.success) {
        notes.push(`${LABELS[field] ?? field} from ${PREFILL_ORIGIN_LABELS[c.origin]} is not suggested: it does not pass the field's checks.`);
        continue;
      }
      (profile as Record<string, unknown>)[field] = parsed.data;
    }
    profile.fieldSources![field as FieldSourceKey] = c.source;
    suggestions.push({ field: field as FieldSourceKey, label: LABELS[field] ?? field, value: c.value, source: c.source, origin: c.origin });
  }
  if (Object.keys(programDetails).length) profile.programDetails = programDetails;

  // Sponsor values are checked the same way (sponsor fields carry no sources: always per borrower).
  for (const [k, v] of Object.entries(sponsor)) if (!SPONSOR_FIELD_SCHEMAS[k as keyof SponsorProfileFields].safeParse(v).success) delete (sponsor as Record<string, unknown>)[k];

  const LABEL_ORDER = Object.keys(LABELS);
  const order = (s: PrefillSuggestion) => (s.field === "playbook" ? -1 : LABEL_ORDER.includes(s.field) ? LABEL_ORDER.indexOf(s.field) : LABEL_ORDER.length);
  suggestions.sort((a, b) => order(a) - order(b));
  return { playbook, profile, sponsor, suggestions: [...suggestions, ...sponsorRows.filter((r) => r.field.slice(8) in sponsor)], notes };
}
