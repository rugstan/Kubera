// Propagates disclosure status to the deal record.
//
// The disclosure row itself is keyed to the deal (lead_id / deal_id /
// twenty_opportunity_id) and the `deal_disclosure_status` view exposes the
// deal's current MLDS state to pipeline code. Mirroring the status into Twenty
// is a third-party write, so it goes through the broker approval gate; until
// WS-I's queue exists the closed gate keeps it pending and nothing is written.

import type { ApprovalDecision, ApprovalGate } from "@/lib/compliance/approval-gate";
import type { DisclosureRecord } from "./store";

export interface DealRecordSink {
  disclosureChanged(record: DisclosureRecord, change: { from: string; to: string; at: Date }): Promise<{ crm: ApprovalDecision["status"] | "skipped" }>;
}

/** Writes the status to an external CRM once a broker approves; supplied by the CRM workstream. */
export type CrmStatusWriter = (input: { twentyOpportunityId: string; title: string; markdown: string }) => Promise<void>;

export function gatedCrmSink(gate: ApprovalGate, writer?: CrmStatusWriter): DealRecordSink {
  return {
    async disclosureChanged(record, change) {
      if (!record.twentyOpportunityId) return { crm: "skipped" };
      const title = `${record.kind === "MLDS_RE882" ? "MLDS (RE 882)" : "Funder disclosure"}: ${change.to.replace(/_/g, " ")}`;
      const markdown = [
        `- Disclosure: \`${record.id}\``,
        `- Status: ${change.from} → ${change.to} at ${change.at.toISOString()}`,
        record.dueAt ? `- Due: ${record.dueAt}` : "",
        record.signedAt ? `- Signed: ${record.signedAt}` : "",
        record.heldReason ? `- Held for counsel: ${record.heldReason}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const decision = await gate.request({
        kind: "crm_update",
        idempotencyKey: `crm_update:disclosure:${record.id}:${change.to}:${record.version}`,
        summary: `Update Twenty opportunity with ${title}`,
        payload: { twentyOpportunityId: record.twentyOpportunityId, title, markdown },
        requestedBy: "system:disclosures",
      });
      if (decision.status === "approved" && writer) await writer({ twentyOpportunityId: record.twentyOpportunityId, title, markdown });
      return { crm: decision.status };
    },
  };
}
