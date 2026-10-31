import { bookingLink } from "./calcom";
import { leadReference } from "./tier1";
import type { LeadRecord } from "./leads";
import type { Notifier } from "./service";
import type { SendOutcome } from "./types";

/**
 * Confirmation email to the person who submitted a qualifier request. It is a
 * transactional reply to their own request, so it does not need marketing
 * consent; it still honors an opt-out on file. Once per lead.
 */
export async function sendLeadConfirmation(lead: LeadRecord, notifier: Notifier): Promise<SendOutcome> {
  if (!lead.contact.email) return { status: "invalid", reason: "lead has no email address" };
  return notifier.send({
    templateId: "lead_confirmation",
    to: { audience: "borrower", email: lead.contact.email },
    data: {
      firstName: lead.contact.firstName,
      reference: leadReference(lead.id),
      bookingUrl: bookingLink({ name: lead.contact.firstName, email: lead.contact.email, campaign: "lead-confirmation" }),
    },
    idempotencyKey: `lead-confirmation:${lead.id}`,
    leadId: lead.id,
  });
}
