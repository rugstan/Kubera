// Decision log for the chasers. WS-AB's insert-only `agent_events` store is the
// production sink (listed as a cross-request); until it lands the default sink
// is a no-op and tests use the memory sink. Entries carry ids, template ids and
// reason codes only: never message bodies, phone numbers or email addresses.

import type { OutreachKind, ReasonCode } from "./types";

export type OutreachEvent = {
  at: string;
  /** Which chaser decided. */
  agent: "speed_to_lead" | "document_reminders" | "closing_nudges" | "vendor_nudges" | "voice";
  action: "send" | "skip" | "escalate" | "call_plan" | "call_event";
  kind?: OutreachKind | "voice_call";
  reason: ReasonCode | string;
  dealId?: string | null;
  leadId?: string | null;
  templateId?: string;
  templateVersion?: number;
  approvalId?: string | null;
  messageId?: string | null;
  detail?: Record<string, unknown>;
};

export interface OutreachAuditSink {
  record(event: OutreachEvent): Promise<void>;
}

export const noopAudit: OutreachAuditSink = { async record() {} };

export class MemoryAudit implements OutreachAuditSink {
  readonly events: OutreachEvent[] = [];
  async record(event: OutreachEvent) {
    this.events.push(event);
  }
}

/** Never lets an audit failure break a send path. */
export async function safeRecord(sink: OutreachAuditSink | undefined, event: OutreachEvent): Promise<void> {
  if (!sink) return;
  try {
    await sink.record(event);
  } catch (err) {
    console.error("outreach: audit sink failed", err instanceof Error ? err.message : err);
  }
}
