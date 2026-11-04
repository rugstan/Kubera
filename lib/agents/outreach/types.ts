// Shared vocabulary for the lead and document chasers (WS-R).
//
// Everything here is outbound contact with borrowers or vendors, so every send
// passes four checks in this order: consent on the ledger, the TCPA texting
// window, provider configured, and the broker approval gate (Global rule 2).
// Nothing in this module touches money: reminders ask for documents and
// conditions only (Global rule 1).

export type OutreachChannel = "sms" | "email";

/** What the message is for. Drives cadence caps and the audit trail. */
export const OUTREACH_KINDS = ["speed_to_lead", "document_reminder", "closing_nudge", "vendor_nudge"] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];

export type OutreachAudience = "borrower" | "vendor";

export const OUTREACH_STATUSES = [
  "queued",
  "pending_approval",
  "sent",
  "failed",
  "skipped_no_consent",
  "skipped_unconfigured",
  "deferred_quiet_hours",
  "rejected",
  "expired",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

/** Why a message did or did not go out. Stable codes for the audit trail and tests. */
export const REASON_CODES = [
  "sent",
  "no_consent",
  "consent_revoked",
  "consent_lookup_failed",
  "outside_texting_window",
  "provider_unconfigured",
  "approval_pending",
  "approval_rejected",
  "approval_expired",
  "send_failed",
  /** The email provider may have taken it (a timeout on a provider without idempotency); never resent automatically. */
  "delivery_unknown",
  "invalid_recipient",
  "invalid_template_data",
  "duplicate",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type OutreachRecipient = {
  audience: OutreachAudience;
  email?: string | null;
  phone?: string | null;
};

export type OutreachOutcome = {
  status: OutreachStatus | "duplicate" | "invalid";
  reason: ReasonCode;
  messageId?: string;
  providerMessageId?: string;
  approvalId?: string;
  /** Human-readable detail for logs and the staff view. */
  detail?: string;
  /** Present on `duplicate`: the status of the earlier attempt. */
  previousStatus?: OutreachStatus;
};

export const isDelivered = (o: OutreachOutcome): boolean => o.status === "sent";

export type OutreachMessageRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: OutreachKind;
  channel: OutreachChannel;
  templateId: string;
  templateVersion: number;
  audience: OutreachAudience;
  recipient: string;
  status: OutreachStatus;
  reasonCode: ReasonCode | null;
  idempotencyKey: string;
  leadId: string | null;
  dealId: string | null;
  /** What the message is about: a checklist batch, a vendor report id. Used for cadence lookups. */
  subjectKey: string | null;
  /** 1-based position in a reminder series. */
  sequence: number;
  approvalId: string | null;
  consentEventId: string | null;
  provider: "resend" | "cloudflare" | "telnyx" | "fake" | null;
  providerMessageId: string | null;
  attempts: number;
  error: string | null;
  metadata: Record<string, unknown>;
  sentAt: string | null;
};
