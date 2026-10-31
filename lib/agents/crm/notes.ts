// CRM notes from routed email. The note holds the classification the mail
// pipeline already produced (category, one-sentence summary, attachments), a
// pointer back to the mail row, and who/when: never the message body. Mail that
// is automated, bulk, suspicious, unrouted or waiting for review gets no note:
// attaching it to a deal would put unverified content on a borrower's record.

import { cleanLine, cleanMarkdown } from "./sanitize";
import type { CrmLinks } from "./links";
import type { NoteCreateOp } from "./operations";

export type RoutedMail = {
  id: string;
  mailbox: string;
  subject: string;
  fromAddress: string;
  fromName: string | null;
  receivedAt: string;
  status: "processed" | "needs_review" | "ignored" | "failed";
  dealId: string | null;
  leadId: string | null;
  category: string;
  summary: string;
  confidence: number;
  source: "model" | "rules";
  suspicious: boolean;
  needsBroker: boolean;
  urgency: "low" | "normal" | "high";
  documentKinds: string[];
  attachmentCount: number;
  automated: boolean;
  bulk: boolean;
};

export const NO_NOTE_CATEGORIES: ReadonlySet<string> = new Set(["auto_reply", "marketing", "spam_or_phishing"]);

export const CATEGORY_LABELS: Record<string, string> = {
  new_inquiry: "New inquiry",
  borrower_update: "Borrower update",
  document_submission: "Documents received",
  lender_correspondence: "Lender correspondence",
  term_sheet: "Lender terms received",
  third_party_report: "Third-party report",
  closing_coordination: "Closing coordination",
  partner_referral: "Partner referral",
  scheduling: "Scheduling",
  other: "Email",
};

export type NoteDecision = { skip: string } | { op: NoteCreateOp };

/** Why a routed message gets no CRM note, or null when it does. */
export function mailSkipReason(mail: RoutedMail, links: Pick<CrmLinks, "opportunityId" | "personId"> | null): string | null {
  if (mail.status !== "processed") return `mail_${mail.status}`;
  if (mail.automated || mail.bulk) return "automated_or_bulk";
  if (mail.suspicious) return "suspicious";
  if (NO_NOTE_CATEGORIES.has(mail.category)) return "ignorable_category";
  if (!mail.dealId && !mail.leadId) return "unrouted";
  if (!links || (!links.opportunityId && !links.personId)) return "no_crm_record";
  return null;
}

export function noteFromMail(mail: RoutedMail, links: Pick<CrmLinks, "opportunityId" | "personId"> | null): NoteDecision {
  const skip = mailSkipReason(mail, links);
  if (skip) return { skip };
  const label = CATEGORY_LABELS[mail.category] ?? "Email";
  const sender = mail.fromName ? `${cleanLine(mail.fromName, 120)} <${cleanLine(mail.fromAddress, 200)}>` : cleanLine(mail.fromAddress, 200);
  const lines = [
    `**${label}** from ${sender}`,
    `- Received: ${mail.receivedAt}`,
    `- Mailbox: ${cleanLine(mail.mailbox, 20)}@`,
    `- Subject: ${cleanLine(mail.subject, 200) || "(no subject)"}`,
    `- Summary: ${cleanLine(mail.summary, 400) || "(none)"}`,
    mail.attachmentCount ? `- Attachments: ${mail.attachmentCount}${mail.documentKinds.length ? ` (${mail.documentKinds.map((k) => cleanLine(k, 30)).join(", ")})` : ""}; stored in the document vault` : null,
    `- Filed by the mail pipeline (${mail.source === "model" ? "model-assisted" : "rules"}, confidence ${Math.round(mail.confidence * 100)}%). Mail record: ${mail.id}`,
    mail.source === "model" ? "_The summary is machine-generated; check the original email before relying on it._" : null,
  ].filter((l): l is string => l !== null);
  return {
    op: {
      type: "note_create",
      title: cleanLine(`${label}: ${mail.subject || "(no subject)"}`, 200),
      markdown: cleanMarkdown(lines.join("\n"), 20_000),
      targets: {
        ...(links!.opportunityId ? { opportunityId: links!.opportunityId } : {}),
        ...(links!.personId ? { personId: links!.personId } : {}),
      },
      source: { kind: "mail", id: mail.id },
    },
  };
}
