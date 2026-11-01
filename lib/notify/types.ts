// Shared types for the notification pipeline (docs/BUILD_PLAN.md, WS-J).

export type Channel = "email" | "sms";
export type Audience = "borrower" | "partner" | "staff";

export const NOTIFICATION_STATUSES = [
  "queued",
  "pending_approval",
  "sent",
  "delivered",
  "failed",
  /** A text whose provider call timed out or errored ambiguously: it may have gone out, so it is never retried. */
  "send_unknown",
  "skipped_no_consent",
  "skipped_unconfigured",
  "deferred_quiet_hours",
  "rejected",
  "expired",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export type Recipient = {
  audience: Audience;
  email?: string | null;
  phone?: string | null;
};

export type SendOutcomeStatus = NotificationStatus | "duplicate" | "invalid";

export type SendOutcome = {
  status: SendOutcomeStatus;
  notificationId?: string;
  providerMessageId?: string;
  /** Human-readable reason for any status other than sent. */
  reason?: string;
  /** Present on `duplicate`: the status of the earlier attempt. */
  previousStatus?: NotificationStatus;
};

export const isSent = (o: SendOutcome): boolean => o.status === "sent" || o.status === "delivered";

/** How a template treats the recipient's consent ledger. */
export type ConsentPolicy =
  /** A granted consent covering the channel must be on file, and not revoked later. */
  | "required"
  /** Allowed unless the person has revoked (transactional reply to their own request). */
  | "not_revoked"
  /** No ledger check (staff alerts, protocol replies to an inbound keyword). */
  | "none";
