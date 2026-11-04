// Credit boxes: typed lender appetite. Two sources:
//   1. /partners lender registrations (public.partners, partner_type LENDER),
//      imported as `pending_review` drafts — a registration is the lender's
//      own claim, so a broker reviews it, links it to a panel lender and
//      approves it before the matcher uses it;
//   2. staff edits on the lenders desk.
// Only `approved` boxes take part in matching. An approved box whose appetite
// has not been verified in LENDER_STALE_AFTER_DAYS still matches but carries a
// stale warning (same rule as the deal desk's lender panel).

import { z } from "zod";
import { LENDER_STALE_AFTER_DAYS, lenderStaleness, type Staleness } from "@/lib/deals/lenders";
import { dealPrograms, type DealProgram } from "@/lib/deals/types";
import { assetClasses, creditBoxStatuses, lienPositions, recourseKinds, type AssetClass, type CreditBox, type CreditBoxStatus, type CreditBoxTerms, type NewCreditBox } from "./types";

export class CreditBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditBoxError";
  }
}

/** Two-letter codes of the states, DC and territories a lender can name. */
export const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI".split(" "),
);

/** "CA, AZ & nv" → ["AZ","CA","NV"]; "nationwide" or blank → [] (nationwide). Unknown tokens are dropped. */
export function parseStates(raw: string | string[] | null | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(" ") : (raw ?? "");
  if (/\b(nation\s*wide|all\s+states|national|usa?)\b/i.test(text)) return [];
  const found = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\b[A-Z]{2}\b/g)) if (US_STATES.has(m[0])) found.add(m[0]);
  return [...found].sort();
}

const pct = (max: number) => z.number().finite().min(0).max(max).nullable().default(null);
const months = (min: number) => z.number().int().min(min).max(600).nullable().default(null);

export const creditBoxTermsSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    programs: z.array(z.enum(dealPrograms)).default([]),
    assetClasses: z.array(z.enum(assetClasses)).default([]),
    states: z.array(z.string()).default([]).transform((s) => parseStates(s)),
    minLoanCents: z.number().int().nonnegative().nullable().default(null),
    maxLoanCents: z.number().int().nonnegative().nullable().default(null),
    maxLtvPct: z.number().finite().gt(0).max(100).nullable().default(null),
    maxLtcPct: z.number().finite().gt(0).max(100).nullable().default(null),
    minDscr: pct(5),
    minDebtYieldPct: pct(50),
    lienPositions: z.array(z.enum(lienPositions)).min(1).default(["first"]),
    recourse: z.enum(recourseKinds).nullable().default(null),
    maxTermMonths: months(1),
    maxAmortizationMonths: months(1),
    maxIoMonths: months(0),
    rateMinPct: pct(40),
    rateMaxPct: pct(40),
    originationFeePct: pct(10),
    brokerCompensationPct: pct(10),
    typicalCloseDays: z.number().int().min(1).max(730).nullable().default(null),
    franchiseRequirements: z.string().trim().max(400).nullable().default(null).transform((s) => s || null),
    notes: z.string().trim().max(2_000).nullable().default(null).transform((s) => s || null),
  })
  .superRefine((b, ctx) => {
    if (b.minLoanCents !== null && b.maxLoanCents !== null && b.minLoanCents > b.maxLoanCents) ctx.addIssue({ code: "custom", path: ["maxLoanCents"], message: "Maximum loan is below the minimum" });
    if (b.rateMinPct !== null && b.rateMaxPct !== null && b.rateMinPct > b.rateMaxPct) ctx.addIssue({ code: "custom", path: ["rateMaxPct"], message: "Rate range is inverted" });
  });

export function parseCreditBoxTerms(input: unknown): CreditBoxTerms {
  const parsed = creditBoxTermsSchema.safeParse(input);
  if (!parsed.success) throw new CreditBoxError(parsed.error.issues.map((i) => `${i.path.join(".") || "box"}: ${i.message}`).join("; "));
  return { ...parsed.data, programs: [...new Set(parsed.data.programs)], assetClasses: [...new Set(parsed.data.assetClasses)], lienPositions: [...new Set(parsed.data.lienPositions)] } as CreditBoxTerms;
}

// ---------------------------------------------------------------------------
// Partner registrations

/** The LENDER registration shape stored in partners.profile by /api/partners (lib/validation.ts partnerSchema). */
export type LenderRegistration = {
  lenderKind: string;
  organization?: string;
  minLoan?: number;
  maxLoan?: number;
  verticals?: string[];
  states?: string;
  maxLtv?: number;
  maxLtc?: number;
  minDscr?: number;
  minDebtYield?: number;
  flagRequirements?: string;
  brokerFeeProtectionPct?: number;
};

export type PartnerRow = { id: string; partnerType: string; organization: string | null; email: string; profile: Record<string, unknown>; status: string; createdAt: string };

/**
 * Programs a registration's lender type and appetite imply. A registration
 * never decides alone: the reviewing broker confirms or edits the list.
 */
export function programsForRegistration(kind: string, verticals: readonly AssetClass[]): DealProgram[] {
  const has = (v: AssetClass) => verticals.includes(v);
  const any = verticals.length === 0;
  const out = new Set<DealProgram>();
  switch (kind) {
    case "BANK":
      out.add("BANK_LIFE_CO");
      if (has("CONSTRUCTION")) out.add("CONSTRUCTION");
      break;
    case "LIFE_CO":
      out.add("BANK_LIFE_CO");
      break;
    case "DEBT_FUND":
      out.add("PRIVATE_BRIDGE");
      if (any || has("HOSPITALITY")) out.add("PIP_BRIDGE");
      if (has("CONSTRUCTION")) out.add("CONSTRUCTION");
      break;
    case "CMBS_DESK":
      out.add("HOTEL_CMBS");
      break;
    case "SBA_CDC":
      out.add("SBA_504");
      break;
    case "SBA_7A_LENDER":
      out.add("SBA_7A");
      break;
    case "HUD_LENDER":
      if (any || has("SENIOR_LIVING")) out.add("HUD_232");
      if (any || has("MULTIFAMILY")) out.add("HUD_MULTIFAMILY");
      break;
    case "PRIVATE":
      out.add("HARD_MONEY");
      out.add("PRIVATE_BRIDGE");
      if (has("CONSTRUCTION")) out.add("CONSTRUCTION");
      break;
  }
  return dealPrograms.filter((p) => out.has(p));
}

const LENDER_KIND_LABELS: Record<string, string> = {
  BANK: "Bank / credit union",
  DEBT_FUND: "Debt fund",
  CMBS_DESK: "CMBS conduit desk",
  SBA_CDC: "SBA 504 CDC",
  SBA_7A_LENDER: "SBA 7(a) lender",
  HUD_LENDER: "HUD MAP / LEAN lender",
  LIFE_CO: "Life company",
  PRIVATE: "Private lender",
};

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const dollarsToCents = (v: unknown): number | null => {
  const n = finite(v);
  return n === null || n < 0 ? null : Math.round(n * 100);
};
const capped = (v: unknown, min: number, max: number): number | null => {
  const n = finite(v);
  return n === null || n < min || n > max ? null : n;
};

/**
 * Credit-box terms from a LENDER registration. Zero is "not stated" for
 * coverage and leverage minimums; out-of-range values are dropped rather than
 * trusted.
 */
export function boxFromRegistration(partner: PartnerRow): CreditBoxTerms {
  if (partner.partnerType !== "LENDER") throw new CreditBoxError(`Partner ${partner.id} is a ${partner.partnerType.toLowerCase()} registration, not a lender`);
  const p = partner.profile as LenderRegistration;
  const verticals = (Array.isArray(p.verticals) ? p.verticals : []).filter((v): v is AssetClass => (assetClasses as readonly string[]).includes(v));
  const min = dollarsToCents(p.minLoan);
  const max = dollarsToCents(p.maxLoan);
  const orgName = (partner.organization ?? p.organization ?? "").trim() || partner.email;
  const maxLtv = capped(p.maxLtv, 0.01, 100);
  const maxLtc = capped(p.maxLtc, 0.01, 100);
  const dscr = capped(p.minDscr, 0.01, 5);
  const dy = capped(p.minDebtYield, 0.01, 50);
  const comp = capped(p.brokerFeeProtectionPct, 0, 10);
  return parseCreditBoxTerms({
    label: `${orgName} · ${LENDER_KIND_LABELS[p.lenderKind] ?? "Lender"} (registration)`.slice(0, 160),
    programs: programsForRegistration(p.lenderKind, verticals),
    assetClasses: verticals,
    states: [p.states ?? ""],
    minLoanCents: min,
    maxLoanCents: max !== null && max > 0 && (min === null || max >= min) ? max : null,
    maxLtvPct: maxLtv,
    maxLtcPct: maxLtc,
    minDscr: dscr,
    minDebtYieldPct: dy,
    brokerCompensationPct: comp,
    franchiseRequirements: (p.flagRequirements ?? "").trim() || null,
    notes: `Imported from the /partners registration of ${partner.createdAt.slice(0, 10)} (contact ${partner.email}). Lender-stated; verify before approving.`,
  });
}

// ---------------------------------------------------------------------------
// Review state machine

const TRANSITIONS: Record<CreditBoxStatus, readonly CreditBoxStatus[]> = {
  pending_review: ["approved", "rejected", "retired"],
  approved: ["pending_review", "retired"],
  rejected: ["pending_review", "retired"],
  retired: ["pending_review"],
};

export function assertBoxTransition(from: CreditBoxStatus, to: CreditBoxStatus): void {
  if (!creditBoxStatuses.includes(to)) throw new CreditBoxError(`Unknown status ${to}`);
  if (!TRANSITIONS[from].includes(to)) throw new CreditBoxError(`A ${from.replace("_", " ")} credit box cannot become ${to.replace("_", " ")}`);
}

/** Field patch for a review decision; validates what an approval needs. */
export function reviewPatch(box: CreditBox, decision: { to: CreditBoxStatus; actor: string; note?: string | null; lenderId?: string | null; verify?: boolean }, now: Date): Partial<NewCreditBox> {
  assertBoxTransition(box.status, decision.to);
  const lenderId = decision.lenderId ?? box.lenderId;
  const note = decision.note?.trim() || null;
  if (decision.to === "approved") {
    if (!lenderId) throw new CreditBoxError("Link the box to a panel lender before approving it");
    if (!box.programs.length) throw new CreditBoxError("An approved credit box needs at least one program");
  }
  if (decision.to === "rejected" && !note) throw new CreditBoxError("Say why the box is rejected");
  const patch: Partial<NewCreditBox> = { status: decision.to, lenderId, reviewedAt: now.toISOString(), reviewedBy: decision.actor, reviewNote: note };
  if (decision.to === "approved" && (decision.verify || !box.verifiedAt)) Object.assign(patch, { verifiedAt: now.toISOString(), verifiedBy: decision.actor });
  return patch;
}

/** Any edit of an approved box's appetite sends it back to review (the reviewer approved specific terms). */
export function editPatch(box: CreditBox, terms: CreditBoxTerms): Partial<NewCreditBox> {
  const changed = (Object.keys(terms) as (keyof CreditBoxTerms)[]).some((k) => JSON.stringify(terms[k]) !== JSON.stringify(box[k]));
  if (!changed) return {};
  return { ...terms, ...(box.status === "approved" ? { status: "pending_review" as const, reviewNote: "Terms edited after approval; re-review." } : {}) };
}

export function boxStaleness(box: Pick<CreditBox, "verifiedAt">, now: Date): Staleness {
  return lenderStaleness(box, now, LENDER_STALE_AFTER_DAYS);
}
