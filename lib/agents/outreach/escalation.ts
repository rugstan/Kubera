// Hand-off to a person when a chaser has run out of automatic options: a lead
// that cannot be contacted through a consented channel, a document that is
// still missing after the last reminder, a vendor order that stays silent.
// The production sink emails the staff mailbox through WS-J's pre-approved
// staff_alert template (see ./runtime.ts). Alerts carry references and counts,
// never contact details (the same rule as the Tier-1 alert).

export type Escalation = {
  /** Stable per situation (e.g. `s2l:<lead>`): a sink raises each key once. */
  key: string;
  kind: "speed_to_lead_unsent" | "documents_overdue" | "closing_items_overdue" | "vendor_unresponsive" | "voice_call_blocked";
  leadId?: string | null;
  dealId?: string | null;
  title: string;
  lines: string[];
};

export interface EscalationSink {
  escalate(e: Escalation): Promise<void>;
}

export class MemoryEscalations implements EscalationSink {
  readonly items: Escalation[] = [];
  async escalate(e: Escalation) {
    if (!this.items.some((x) => x.key === e.key)) this.items.push(e);
  }
}
