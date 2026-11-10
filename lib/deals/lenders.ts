// Lender panel: program appetite, broker-friendly flag, fee splits and the
// date the desk last verified them. A stale verification keeps the lender on
// the panel but flags every submission until someone re-verifies.

import { z } from "zod";
import { EXEMPT_LENDER_CATEGORIES, lenderCategories } from "@/lib/compliance/schemas";
import { dealPrograms, feeSplitKinds, type DealProgram, type LenderPanelEntry, type NewLender } from "./types";

/** Appetite older than this is stale (VERIFY with the desk: 180 days). */
export const LENDER_STALE_AFTER_DAYS = 180;

const DAY = 86_400_000;

export type Staleness = { stale: boolean; ageDays: number | null; reason: string | null };

export function lenderStaleness(l: Pick<LenderPanelEntry, "verifiedAt">, now: Date, maxAgeDays = LENDER_STALE_AFTER_DAYS): Staleness {
  if (!l.verifiedAt) return { stale: true, ageDays: null, reason: "Appetite and fee split have never been verified." };
  const ageDays = Math.floor((now.getTime() - Date.parse(l.verifiedAt)) / DAY);
  if (ageDays > maxAgeDays) return { stale: true, ageDays, reason: `Last verified ${ageDays} days ago (limit ${maxAgeDays}).` };
  return { stale: false, ageDays, reason: null };
}

export const lenderInputSchema = z
  .object({
    partnerId: z.uuid().nullable().default(null),
    name: z.string().trim().min(2).max(160),
    category: z.enum(lenderCategories),
    categoryEvidenceRef: z.string().trim().max(200).nullable().default(null),
    programs: z.array(z.enum(dealPrograms)).min(1, "Pick at least one program"),
    minLoanCents: z.number().int().nonnegative().nullable().default(null),
    maxLoanCents: z.number().int().nonnegative().nullable().default(null),
    states: z.array(z.string().trim().length(2).toUpperCase()).default([]),
    assetTypes: z.array(z.string().trim().min(1).max(60)).default([]),
    appetiteNotes: z.string().trim().max(2_000).nullable().default(null),
    brokerFriendly: z.boolean().default(false),
    feeSplitKind: z.enum(feeSplitKinds).default("none"),
    feeSplitValue: z.number().finite().nonnegative().default(0),
    feeAgreementRef: z.string().trim().max(300).nullable().default(null),
    verifiedAt: z.iso.datetime({ offset: true }).nullable().default(null),
    verifiedBy: z.string().trim().max(120).nullable().default(null),
    active: z.boolean().default(true),
  })
  .superRefine((l, ctx) => {
    if (l.minLoanCents !== null && l.maxLoanCents !== null && l.minLoanCents > l.maxLoanCents) ctx.addIssue({ code: "custom", path: ["maxLoanCents"], message: "Maximum loan is below the minimum" });
    if ((l.feeSplitKind === "percent_of_loan" || l.feeSplitKind === "percent_of_lender_fee") && l.feeSplitValue > 100) ctx.addIssue({ code: "custom", path: ["feeSplitValue"], message: "Percent splits cannot exceed 100" });
    if (l.feeSplitKind !== "none" && !l.feeAgreementRef) ctx.addIssue({ code: "custom", path: ["feeAgreementRef"], message: "A fee split needs the signed fee / correspondent agreement on file" });
  });

/**
 * A new panel lender (appetite, split, verification). Contacts and contact
 * info are separate (lib/deals/lender-contacts.ts): the legacy
 * contactName / contactEmail fields are no longer accepted.
 */
export function parseLender(input: unknown): NewLender {
  return lenderInputSchema.parse(input) as NewLender;
}

export type PanelMatch = { lender: LenderPanelEntry; staleness: Staleness; reasons: string[]; warnings: string[] };

/**
 * Panel lenders whose recorded appetite covers the deal, broker-friendly and
 * freshly verified first. (Typed credit boxes and scored matching arrive with
 * WS-M; this is the desk's panel filter.)
 */
export function panelForDeal(lenders: LenderPanelEntry[], deal: { program: DealProgram; loanAmountCents: number | null; propertyState: string | null }, now: Date): PanelMatch[] {
  const out: PanelMatch[] = [];
  for (const l of lenders) {
    if (!l.active || !l.programs.includes(deal.program)) continue;
    const amt = deal.loanAmountCents;
    if (amt !== null && ((l.minLoanCents !== null && amt < l.minLoanCents) || (l.maxLoanCents !== null && amt > l.maxLoanCents))) continue;
    if (deal.propertyState && l.states.length && !l.states.includes(deal.propertyState.toUpperCase())) continue;
    const staleness = lenderStaleness(l, now);
    const reasons = [`Lends on ${deal.program.replace(/_/g, " ").toLowerCase()}`];
    if (l.brokerFriendly) reasons.push("Broker-friendly");
    if (l.feeSplitKind !== "none") reasons.push("Fee split on file");
    const warnings: string[] = [];
    if (staleness.stale && staleness.reason) warnings.push(staleness.reason);
    if (!EXEMPT_LENDER_CATEGORIES.has(l.category) || !l.categoryEvidenceRef) warnings.push("Not an evidenced exempt lender category: the usury gate applies above the art. XV cap.");
    out.push({ lender: l, staleness, reasons, warnings });
  }
  return out.sort((a, b) => Number(b.lender.brokerFriendly) - Number(a.lender.brokerFriendly) || Number(a.staleness.stale) - Number(b.staleness.stale) || a.lender.name.localeCompare(b.lender.name));
}
