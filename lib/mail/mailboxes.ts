// Inbound Zoho Mail mailboxes the workflow polls (docs/BUILD_PLAN.md, Mailboxes).
// Advisor mailboxes, partners@, compliance@ and admin@ are not processed here:
// compliance@ and admin@ never sync, and partners@ / advisor mail sync to
// Twenty over IMAP directly.

export const INBOUND_MAILBOXES = ["deals", "docs", "lenders", "vendors", "closing"] as const;
export type InboundMailbox = (typeof INBOUND_MAILBOXES)[number];

export type MailboxConfig = {
  id: InboundMailbox;
  /** Staff queue a message lands in when it needs review. */
  queue: string;
  description: string;
  /** Mirrors to Twenty over IMAP (the workflow never writes the CRM directly). */
  crmSync: boolean;
  /**
   * Accepted attachments are registered as borrower documents in the vault
   * (quarantined until the malware scan passes). Otherwise they are kept with
   * the message only.
   */
  vaultAttachments: boolean;
  /**
   * Term sheets (category `term_sheet`) routed to a deal are filed in the vault
   * as staff-only TERM_SHEET documents, quarantined until the scan passes; the
   * document agent then extracts them and the lenders agent turns them into
   * quotes. Other attachments stay with the message.
   */
  termSheetAttachments: boolean;
};

export const MAILBOXES: Readonly<Record<InboundMailbox, MailboxConfig>> = {
  deals: { id: "deals", queue: "deal-desk", description: "New inquiries and borrower correspondence (hello@/info@ forward here).", crmSync: true, vaultAttachments: true, termSheetAttachments: false },
  docs: { id: "docs", queue: "documents", description: "Borrower document submissions; attachments go to the vault.", crmSync: false, vaultAttachments: true, termSheetAttachments: false },
  lenders: { id: "lenders", queue: "capital-markets", description: "Lender correspondence, term sheets and quotes.", crmSync: true, vaultAttachments: false, termSheetAttachments: true },
  vendors: { id: "vendors", queue: "third-party-reports", description: "Appraisal, Phase I, PCA and other third-party report vendors.", crmSync: true, vaultAttachments: true, termSheetAttachments: false },
  closing: { id: "closing", queue: "closing", description: "Title, escrow and closing coordination (pre-closing only).", crmSync: true, vaultAttachments: false, termSheetAttachments: false },
};

/** Failed processing attempts before a message is left for staff (the review queue lists it). */
export const MAX_MAIL_ATTEMPTS = 6;

export function mailDomain(env: Record<string, string | undefined> = process.env): string {
  return env.MAIL_DOMAIN?.trim().toLowerCase() || "corincommercial.com";
}

export function mailboxAddress(id: InboundMailbox, env: Record<string, string | undefined> = process.env): string {
  return `${id}@${mailDomain(env)}`;
}

export function isInboundMailbox(value: unknown): value is InboundMailbox {
  return typeof value === "string" && (INBOUND_MAILBOXES as readonly string[]).includes(value);
}
