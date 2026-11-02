import { bookingLink } from "./calcom";
import type { Notifier } from "./service";
import type { SendOutcome } from "./types";

// Milestone notifications driven by deal stage events. A stage event (from the
// deal desk, a workflow, or the Twenty stage field) maps to a fixed milestone
// with fixed copy; unknown stages and non-milestones (a lost or dead deal) send
// nothing. Messages go through the Notifier, so they are consent-gated (email
// and SMS), idempotent per event, and held for broker approval unless the
// milestone templates are pre-approved (NOTIFY_PREAPPROVED_TEMPLATES).
//
// Copy rules: no "approved", no promised dates. Corin does not fund loans, so
// the closing milestone talks about the lender and closing coordination.

export type Milestone = { key: string; label: string; message: string };

const MILESTONE_LIST: readonly Milestone[] = [
  { key: "advisor_review", label: "Advisor review", message: "An advisor is reviewing your request and the details you shared." },
  { key: "package_preparation", label: "Loan package preparation", message: "Your advisor is preparing your loan package for lenders." },
  { key: "lender_outreach", label: "Lender outreach", message: "Your loan package is being shared with lenders whose programs fit your request." },
  {
    key: "lender_terms",
    label: "Lender terms received",
    message: "Lender terms are in. Your advisor will walk you through the options. Terms are indicative until a lender issues a commitment.",
  },
  { key: "lender_underwriting", label: "Lender underwriting", message: "Your file is with the lender for underwriting. Your advisor will reach out if anything else is needed." },
  {
    key: "closing_coordination",
    label: "Closing coordination",
    message: "Your file is in closing coordination with the lender, title and escrow. Timing depends on the lender and third-party deliverables and is not guaranteed.",
  },
  { key: "closed", label: "Loan closed", message: "Your loan has closed with the lender. Thank you for working with Corin Commercial." },
];

const MILESTONES = new Map(MILESTONE_LIST.map((m) => [m.key, m]));

/**
 * Stage name (any case or punctuation) to milestone key. Includes the Twenty
 * opportunity stages and every deal-desk stage key (lib/deals/stage-catalog.ts).
 * Commitment-type stages (firm_commitment, sba_authorization, commitment) and
 * exits (withdrawn, lost) announce nothing: a commitment message would read as
 * an approval, and exits are handled by the advisor personally.
 */
export const STAGE_TO_MILESTONE: Record<string, string> = {
  qualification: "advisor_review",
  intake: "advisor_review",
  engaged: "advisor_review",
  new: "advisor_review",
  advisor_review: "advisor_review",
  package: "package_preparation",
  packaging: "package_preparation",
  package_prepared: "package_preparation",
  proposal: "package_preparation",
  lender_outreach: "lender_outreach",
  outreach: "lender_outreach",
  marketing: "lender_outreach",
  term_sheet: "lender_terms",
  term_sheets: "lender_terms",
  quote: "lender_terms",
  quotes: "lender_terms",
  negotiation: "lender_terms",
  application: "lender_underwriting",
  third_party_reports: "lender_underwriting",
  plan_and_cost_review: "lender_underwriting",
  hud_review: "lender_underwriting",
  underwriting: "lender_underwriting",
  lender_underwriting: "lender_underwriting",
  processing: "lender_underwriting",
  closing: "closing_coordination",
  pre_closing: "closing_coordination",
  closing_coordination: "closing_coordination",
  closed: "closed",
  closed_won: "closed",
};

export const normalizeStage = (stage: string) =>
  stage
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** The milestone a stage announces, or null when the stage is not one we message about (lost, dead, unknown). */
export function milestoneForStage(stage: string): Milestone | null {
  const key = STAGE_TO_MILESTONE[normalizeStage(stage)];
  return key ? (MILESTONES.get(key) ?? null) : null;
}

export type StageEvent = {
  /** Unique id of the stage change (workflow event id); the idempotency key derives from it. */
  eventId: string;
  stage: string;
  previousStage?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  contact: { firstName: string; email?: string | null; phone?: string | null };
};

export type StageNotifyResult = {
  milestone: string | null;
  skipped?: "unknown_stage" | "no_change";
  email?: SendOutcome;
  sms?: SendOutcome;
};

export async function notifyStageEvent(event: StageEvent, notifier: Notifier): Promise<StageNotifyResult> {
  if (event.previousStage && normalizeStage(event.previousStage) === normalizeStage(event.stage)) return { milestone: null, skipped: "no_change" };
  const milestone = milestoneForStage(event.stage);
  if (!milestone) return { milestone: null, skipped: "unknown_stage" };
  // Moving between two stages of the same milestone (application → HUD review) is not news to the borrower.
  if (event.previousStage && milestoneForStage(event.previousStage)?.key === milestone.key) return { milestone: null, skipped: "no_change" };

  const base = { leadId: event.leadId ?? null, dealId: event.dealId ?? null, metadata: { milestone: milestone.key, stage: normalizeStage(event.stage), eventId: event.eventId } };
  const result: StageNotifyResult = { milestone: milestone.key };

  if (event.contact.email) {
    result.email = await notifier.send({
      ...base,
      templateId: "milestone_update",
      to: { audience: "borrower", email: event.contact.email },
      data: {
        firstName: event.contact.firstName,
        label: milestone.label,
        message: milestone.message,
        bookingUrl: bookingLink({ name: event.contact.firstName, email: event.contact.email, campaign: "milestone-update" }),
      },
      idempotencyKey: `milestone:${event.eventId}:email`,
    });
  }
  if (event.contact.phone) {
    result.sms = await notifier.send({
      ...base,
      templateId: "milestone_update_sms",
      to: { audience: "borrower", phone: event.contact.phone },
      data: { label: milestone.label },
      idempotencyKey: `milestone:${event.eventId}:sms`,
    });
  }
  return result;
}
