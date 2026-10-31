// Test harness for the agent safety platform: an in-memory approvals queue,
// event log, autonomy store and re-auth store on one controllable clock, plus
// sample tools that count what they "send". Used by the unit tests and by the
// deterministic eval subjects (evals/agents).

import { z } from "zod";
import { payloadHash } from "@/lib/approvals/hash";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import type { Approver } from "@/lib/approvals/types";
import { AGENT_TASKS, AutonomyPolicy, MemoryAutonomyStore, type AutonomyLevel, type TaskPolicy } from "./autonomy";
import { MemoryAgentEventStore } from "./events";
import { MemoryReauthStore, ReauthService } from "./reauth";
import { defineTool, ToolRunner, type AgentRunContext, type Tool } from "./tools";

export const BROKER: Approver = { userId: "11111111-1111-4111-8111-111111111111", label: "Dana Broker", dreLicense: "01234567" };
export const OTHER_BROKER: Approver = { userId: "22222222-2222-4222-8222-222222222222", label: "Lee Broker", dreLicense: "07654321" };
export const DEAL = "33333333-3333-4333-8333-333333333333";

export class Clock {
  constructor(public ms = Date.UTC(2026, 10, 4, 17, 0, 0)) {}
  now = (): Date => new Date(this.ms);
  advance(minutes: number): void {
    this.ms += minutes * 60_000;
  }
}

export type Sent = { tool: string; input: unknown; idempotencyKey: string | null; approvalId: string | null };

export const EMAIL_TEMPLATE_BODY = "Hi {{name}}, a reminder that we still need {{item}} for your loan file. Upload it at {{link}}.";

/** Sample tools covering every policy branch. */
export function sampleTools(sent: Sent[], opts: { failSend?: () => boolean } = {}): Tool[] {
  const record = (tool: string) => async (input: unknown, exec: { idempotencyKey: string | null; approvalId: string | null }) => {
    if (opts.failSend?.()) throw new Error("provider timeout");
    sent.push({ tool, input, idempotencyKey: exec.idempotencyKey, approvalId: exec.approvalId });
    return { externalIds: [`${tool}-msg-${sent.length}`] };
  };
  const email = z.object({ to: z.email(), subject: z.string().min(1).max(200), body: z.string().min(1).max(5000), dealId: z.uuid(), itemId: z.string().min(1).max(60) });
  return [
    defineTool({
      name: "deal.read_checklist",
      version: "1.0.0",
      description: "Read the deal's open checklist items",
      effect: "read",
      input: z.object({ dealId: z.uuid() }),
      run: async () => ({ output: { open: 2 } }),
    }),
    defineTool({
      name: "email.send_document_reminder",
      version: "1.2.0",
      description: "Email a borrower a document reminder",
      effect: "write",
      approvalKind: "email",
      input: email,
      summarize: (i) => `Document reminder to ${i.to}: ${i.subject}`,
      actionKey: (i) => `${i.dealId}:doc-reminder:${i.itemId}`,
      template: (i) => (i.body.startsWith("Hi ") ? { templateId: "doc-reminder-v1", bodySha256: payloadHash({ body: EMAIL_TEMPLATE_BODY }) } : null),
      recipients: (i) => [i.to],
      ttlMinutes: 60,
      run: record("email.send_document_reminder"),
    }),
    defineTool({
      name: "crm.update_stage",
      version: "1.0.0",
      description: "Move a Twenty opportunity to a new stage",
      effect: "write",
      approvalKind: "crm_update",
      input: z.object({ opportunityId: z.string().min(1), stage: z.enum(["APPLICATION", "UNDERWRITING", "TERM_SHEET", "CLOSING"]) }),
      actionKey: (i) => `${i.opportunityId}:stage:${i.stage}`,
      run: record("crm.update_stage"),
    }),
    defineTool({
      name: "lenders.submit_package",
      version: "1.0.0",
      description: "Submit the loan package to a lender",
      effect: "write",
      approvalKind: "lender_submission",
      reauth: true,
      input: z.object({ dealId: z.uuid(), lenderId: z.string().min(1), packageVersion: z.number().int().min(1), to: z.email() }),
      actionKey: (i) => `${i.dealId}:${i.lenderId}:v${i.packageVersion}`,
      recipients: (i) => [i.to],
      run: record("lenders.submit_package"),
    }),
    defineTool({
      name: "disclosures.send_mlds",
      version: "1.0.0",
      description: "Send the RE 882 MLDS for e-signature",
      effect: "write",
      approvalKind: "esign_send",
      input: z.object({ dealId: z.uuid(), documentType: z.literal("MLDS_RE882"), signerEmail: z.email() }),
      actionKey: (i) => `${i.dealId}:mlds`,
      recipients: (i) => [i.signerEmail],
      run: record("disclosures.send_mlds"),
    }),
  ];
}

export type Harness = {
  clock: Clock;
  sent: Sent[];
  approvalStore: MemoryApprovalStore;
  approvals: ApprovalService;
  events: MemoryAgentEventStore;
  autonomyStore: MemoryAutonomyStore;
  autonomy: AutonomyPolicy;
  reauthStore: MemoryReauthStore;
  reauth: ReauthService;
  runner: ToolRunner;
  ctx(overrides?: Partial<AgentRunContext>): AgentRunContext;
  setLevel(task: string, level: AutonomyLevel): Promise<void>;
  addEmailTemplate(): void;
};

export const TEST_TASKS: Record<string, TaskPolicy> = {
  ...AGENT_TASKS,
  "test.anything": { description: "Test task", defaultLevel: "assist", maxLevel: "automate" },
};

export function createHarness(opts: { tools?: (sent: Sent[]) => Tool[]; failSend?: () => boolean } = {}): Harness {
  const clock = new Clock();
  const sent: Sent[] = [];
  const approvalStore = new MemoryApprovalStore();
  const events = new MemoryAgentEventStore(clock.now);
  const autonomyStore = new MemoryAutonomyStore();
  const autonomy = new AutonomyPolicy(autonomyStore, TEST_TASKS, clock.now);
  const reauthStore = new MemoryReauthStore();
  const reauth = new ReauthService(reauthStore, clock.now);
  // The queue checks the same proofs: sensitive approvals need a step-up first.
  const approvals = new ApprovalService(approvalStore, clock.now, {}, reauthStore);
  const tools = opts.tools ? opts.tools(sent) : sampleTools(sent, opts);
  const runner = new ToolRunner({ tools, events, approvals, autonomy, reauth, now: clock.now });
  return {
    clock,
    sent,
    approvalStore,
    approvals,
    events,
    autonomyStore,
    autonomy,
    reauthStore,
    reauth,
    runner,
    ctx: (o = {}) => ({ agent: "outreach.chaser", agentVersion: "1.0.0", task: "outreach.document_reminder", dealId: DEAL, ...o }),
    async setLevel(task, level) {
      await autonomy.set(task, level, BROKER, "test");
    },
    addEmailTemplate() {
      approvalStore.addTemplate({
        templateId: "doc-reminder-v1",
        kind: "email",
        description: "Document reminder",
        bodySha256: payloadHash({ body: EMAIL_TEMPLATE_BODY }),
        approvedBy: BROKER.userId,
        approvedByDre: BROKER.dreLicense!,
        approvedAt: clock.now().toISOString(),
        revokedAt: null,
      });
    },
  };
}

export const reminder = (o: Partial<{ to: string; subject: string; body: string; itemId: string }> = {}) => ({
  tool: "email.send_document_reminder",
  input: { to: "pat.lee@example.com", subject: "Rent roll still needed", body: "Hi Pat, a reminder that we still need the rent roll.", dealId: DEAL, itemId: "rent-roll", ...o },
});
