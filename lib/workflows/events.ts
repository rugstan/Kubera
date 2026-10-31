// Event names and payload schemas for every workflow (Inngest events).
// Producers send these with sendWorkflowEvent (lib/workflows/client.ts); the
// functions in lib/workflows/functions/* consume them.

import { z } from "zod";
import { INBOUND_MAILBOXES } from "@/lib/mail/mailboxes";

export const EVENTS = {
  /** An approval in the broker queue was decided (approved / rejected / cancelled / expired). */
  approvalDecided: "kubera/approval.decided",
  /** Request an outbound action that must pass the approval gate before it runs. */
  outboundRequested: "kubera/outbound.requested",
  /** Poll one or all inbound mailboxes now (the cron also polls every few minutes). */
  mailPollRequested: "kubera/mail.poll.requested",
  /** A new message was listed in an inbound mailbox; process it. */
  mailReceived: "kubera/mail.received",
  /** A processed message was routed (for downstream agents: CRM notes, lender quotes, chasers). */
  mailRouted: "kubera/mail.routed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

const key = z.string().min(8).max(200);

export const approvalDecidedSchema = z.object({
  approvalId: z.string().min(1).max(100),
  idempotencyKey: key,
  status: z.enum(["approved", "rejected", "cancelled", "expired"]),
});

export const outboundRequestedSchema = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
  idempotencyKey: key,
  summary: z.string().min(1).max(300),
  templateId: z.string().max(100).optional(),
  payload: z.record(z.string(), z.unknown()),
  requestedBy: z.string().min(1).max(200),
  /** Approval wait before the request expires and never sends (minutes). */
  ttlMinutes: z.number().int().min(1).max(30 * 24 * 60).optional(),
});
export type OutboundRequested = z.infer<typeof outboundRequestedSchema>;

const mailbox = z.enum(INBOUND_MAILBOXES);

export const mailPollRequestedSchema = z.object({ mailbox: mailbox.optional() });

export const mailReceivedSchema = z.object({
  mailbox,
  providerMessageId: z.string().min(1).max(200),
  folderId: z.string().min(1).max(200),
  receivedAt: z.string().datetime().optional(),
});
export type MailReceived = z.infer<typeof mailReceivedSchema>;

export const mailRoutedSchema = z.object({
  mailMessageId: z.string().uuid(),
  mailbox,
  category: z.string(),
  dealId: z.string().uuid().nullable(),
  leadId: z.string().uuid().nullable(),
  needsReview: z.boolean(),
});
