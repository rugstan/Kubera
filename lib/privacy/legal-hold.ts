// Legal hold: compliance or counsel flags a record so nothing deletes it
// (retention engine, erasure requests, staff) until the hold is released.
// The database enforces it as well (refuse_delete_on_legal_hold trigger).

import { z } from "zod";

export const LEGAL_HOLD_TABLES = [
  "leads",
  "partners",
  "documents",
  "ai_conversations",
  "consent_events",
  "privacy_requests",
  // Communications (migration 20261105025700): inbound mail, texts, the notification log, newsletter signups.
  "mail_messages",
  "sms_messages",
  "notifications",
  "newsletter_subscribers",
] as const;
export type LegalHoldTable = (typeof LEGAL_HOLD_TABLES)[number];

export const legalHoldSchema = z
  .object({
    table: z.enum(LEGAL_HOLD_TABLES),
    id: z.uuid(),
    hold: z.boolean(),
    reason: z.string().trim().min(3).max(500).optional(),
    /** Who set or released it (name and role, e.g. "J. Rivera, compliance"). */
    actor: z.string().trim().min(2).max(200),
  })
  .refine((v) => !v.hold || Boolean(v.reason), { path: ["reason"], message: "A reason (matter or demand) is required to place a hold" });

export type LegalHoldInput = z.infer<typeof legalHoldSchema>;

export type LegalHoldPatch = {
  legal_hold: boolean;
  legal_hold_reason?: string;
  legal_hold_set_at: string;
  legal_hold_set_by: string;
};

export interface LegalHoldDb {
  /** Applies the patch; returns false when no row has that id. */
  setLegalHold(table: LegalHoldTable, id: string, patch: LegalHoldPatch): Promise<boolean>;
}

/** Places or releases a hold. Releasing keeps the last reason as history. */
export async function applyLegalHold(db: LegalHoldDb, input: LegalHoldInput, now: Date = new Date()): Promise<{ found: boolean; patch: LegalHoldPatch }> {
  const patch: LegalHoldPatch = {
    legal_hold: input.hold,
    ...(input.reason ? { legal_hold_reason: input.reason } : {}),
    legal_hold_set_at: now.toISOString(),
    legal_hold_set_by: input.actor,
  };
  const found = await db.setLegalHold(input.table, input.id, patch);
  return { found, patch };
}
