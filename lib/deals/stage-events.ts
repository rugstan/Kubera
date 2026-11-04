// Stage changes on the deal desk announce themselves to the borrower through
// WS-J's milestone notifications (lib/notify/stage-events.ts): consent-gated,
// idempotent per event, and held for broker approval unless the milestone
// templates are pre-approved. A failed notification never undoes the advance.

import type { LeadSource } from "@/lib/notify/leads";
import type { Notifier } from "@/lib/notify/service";
import { notifyStageEvent, type StageNotifyResult } from "@/lib/notify/stage-events";
import type { Deal } from "./types";

export type DealStageChange = {
  /** Stable per change: deal id + new stage + the deal's record version after the change. */
  eventId: string;
  dealId: string;
  leadId: string | null;
  event: string;
  stage: string;
  previousStage: string;
  borrowerName: string | null;
};

export interface DealStageEventSink {
  stageChanged(change: DealStageChange): Promise<void>;
}

export function stageEventId(deal: Pick<Deal, "id" | "stage" | "recordVersion">): string {
  return `deal-stage:${deal.id}:${deal.stage}:${deal.recordVersion}`;
}

export function stageChangeOf(updated: Deal, previousStage: string, event: string): DealStageChange {
  return { eventId: stageEventId(updated), dealId: updated.id, leadId: updated.leadId, event, stage: updated.stage, previousStage, borrowerName: updated.borrowerName };
}

/** Records stage changes (tests). */
export class MemoryStageEventSink implements DealStageEventSink {
  readonly changes: DealStageChange[] = [];
  async stageChanged(change: DealStageChange): Promise<void> {
    this.changes.push(change);
  }
}

/**
 * Sends the milestone for a stage change to the borrower on the deal's lead
 * (the lead holds the contact and its consent). Deals without a lead have no
 * borrower contact on file, so nothing is sent.
 */
export function notifierStageSink(deps: { notifier: Notifier; leads: LeadSource; onResult?: (change: DealStageChange, result: StageNotifyResult | null) => void }): DealStageEventSink {
  return {
    async stageChanged(change) {
      if (!change.leadId) {
        deps.onResult?.(change, null);
        return;
      }
      const lead = await deps.leads.get(change.leadId);
      if (!lead) {
        deps.onResult?.(change, null);
        return;
      }
      const result = await notifyStageEvent(
        {
          eventId: change.eventId,
          stage: change.stage,
          previousStage: change.previousStage,
          dealId: change.dealId,
          leadId: change.leadId,
          contact: { firstName: lead.contact.firstName, email: lead.contact.email, phone: lead.contact.phone },
        },
        deps.notifier,
      );
      deps.onResult?.(change, result);
    },
  };
}
