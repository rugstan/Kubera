// Test harness: the real approval queue (in memory), the real writer and the
// fake Twenty, wired the way lib/agents/crm/server.ts wires production.

import { executeApproved, type ExecutedApproval } from "@/lib/approvals/executors";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import type { Approver } from "@/lib/approvals/types";
import { MemoryIdempotencyStore } from "@/lib/workflows/idempotency";
import { crmApprovalExecutor } from "./executor";
import { MemoryAgentEventSink } from "./events";
import { FakeCrmClient } from "./fake-client";
import type { CrmAgentDeps } from "./handlers";
import { MemoryCrmLinks } from "./links";
import { MemoryRoutedMailSource } from "./mail-source";
import { DEFAULT_AUTONOMY, type AutonomyConfig } from "./policy";
import { CrmAgentWriter } from "./writer";
import type { ModelGateway } from "@/lib/ai/gateway";

export const BROKER: Approver = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };
export const T0 = new Date("2026-11-04T17:00:00Z");

export const DEAL_ID = "10000000-0000-4000-8000-000000000003";
export const LEAD_ID = "20000000-0000-4000-8000-000000000003";

export function harness(opts: { autonomy?: AutonomyConfig; gateway?: ModelGateway | null; dealStage?: (dealId: string) => Promise<string | null> } = {}) {
  let now = T0;
  const clock = () => now;
  const crm = new FakeCrmClient();
  const events = new MemoryAgentEventSink(clock);
  const store = new MemoryApprovalStore();
  const approvals = new ApprovalService(store, clock);
  const effects = new MemoryIdempotencyStore();
  const links = new MemoryCrmLinks();
  const mail = new MemoryRoutedMailSource();
  const writer = new CrmAgentWriter({
    client: crm,
    gate: (o) => queueApprovalGate(approvals, o),
    events,
    effects,
    autonomy: opts.autonomy ?? DEFAULT_AUTONOMY,
    now: clock,
    sleep: async () => {},
    ...(opts.dealStage ? { dealStage: opts.dealStage } : {}),
  });
  const deps: CrmAgentDeps = { writer, client: crm, links, mail, gateway: opts.gateway ?? null, now: clock };
  const executor = crmApprovalExecutor(writer);

  return {
    crm,
    events,
    store,
    approvals,
    effects,
    links,
    mail,
    writer,
    deps,
    executor,
    advance: (ms: number) => void (now = new Date(now.getTime() + ms)),
    /** A broker approves; the approvals hook then runs the executor, as in production. */
    async approve(id: string): Promise<ExecutedApproval[]> {
      const r = await approvals.approve(id, BROKER);
      if (!r.ok) throw new Error(`approve failed: ${r.reason}`);
      return executeApproved(approvals, [r.record], [executor]);
    },
    async reject(id: string) {
      return approvals.reject(id, BROKER, "not now");
    },
    async pending() {
      return approvals.list({ status: "pending" });
    },
  };
}

export type Harness = ReturnType<typeof harness>;

/** Seeds a deal linked to Twenty opportunity `opp-1` and person `person-1`. */
export function seedDeal(h: Harness, over: { stage?: string; crmStage?: string } = {}) {
  h.crm.addOpportunity({ id: "opp-1", name: "Oak Terrace", stage: over.crmStage ?? "QUALIFICATION" });
  h.links.deals.set(DEAL_ID, { dealId: DEAL_ID, leadId: LEAD_ID, opportunityId: "opp-1", personId: "person-1", dealStage: over.stage ?? "intake", ownerUserId: "user-1" });
  h.links.leads.set(LEAD_ID, { dealId: null, leadId: LEAD_ID, opportunityId: "opp-1", personId: "person-1", dealStage: null, ownerUserId: null });
  h.links.members.set("user-1", "member-1");
}
