import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { MemoryAgentEventStore } from "@/lib/agents/core/events";
import { AGENT_EVENT_PHASES, MemoryAgentEventSink, agentEventStoreSink, splitVersionedId, supabaseAgentEventSink, toCoreAgentEvent, toReasonCode, type AgentEventInput } from "./events";

const event: AgentEventInput = {
  agent: "crm",
  task: "stage_sync",
  action: "stage_update",
  phase: "executed",
  autonomy: "automate",
  actor: "agent:crm:stage_sync",
  dealId: "10000000-0000-4000-8000-000000000003",
  targetObject: "opportunity",
  targetId: "opp-1",
  approvalId: "not-a-uuid",
  approver: "Pat Broker",
  idempotencyKey: "stage:deal-stage:x",
  externalRef: "opp-1",
  reasonCodes: ["deal_stage_changed"],
  detail: { from: "QUALIFICATION", to: "NEGOTIATION" },
};

describe("agent events", () => {
  it("maps onto the shared agent_events row, keeping only valid uuids", () => {
    const row = toCoreAgentEvent({ ...event, reasonCodes: ["deal_stage_changed", "category:term_sheet"] });
    expect(row).toMatchObject({
      eventType: "crm.executed",
      agent: "crm",
      task: "crm.stage_sync",
      autonomy: "automate",
      toolName: "crm.stage_update",
      toolVersion: "1.0.0",
      outcome: "executed",
      dealId: "10000000-0000-4000-8000-000000000003",
      leadId: null,
      approvalId: null,
      approverLabel: "Pat Broker",
      externalMessageIds: ["opp-1"],
      reasonCodes: ["deal_stage_changed", "category.term_sheet"],
    });
    expect(row.detail).toMatchObject({ action: "stage_update", phase: "executed", actor: "agent:crm:stage_sync", targetObject: "opportunity", targetId: "opp-1", approvalRef: "not-a-uuid", from: "QUALIFICATION" });
  });

  it("splits registry ids into slug and semver", () => {
    expect(splitVersionedId("crm-call-summary@1")).toEqual({ id: "crm-call-summary", version: "1.0.0" });
    expect(splitVersionedId("nope")).toEqual({ id: null, version: null });
    expect(toReasonCode("no_summary:Model Refused")).toBe("no_summary.model_refused");
  });

  it("every phase produces a row the agent_events table accepts", async () => {
    const store = new MemoryAgentEventStore(() => new Date("2026-11-04T17:00:00Z"));
    const sink = agentEventStoreSink(store);
    for (const phase of AGENT_EVENT_PHASES) await sink.record({ ...event, phase, promptVersion: "crm-call-summary@1", reasonCodes: ["call_logged", "no_summary:unknown"] });
    const rows = store.all();
    expect(rows).toHaveLength(AGENT_EVENT_PHASES.length);
    expect(rows.map((r) => r.seq)).toEqual(AGENT_EVENT_PHASES.map((_, i) => i + 1));
    expect(rows[0]).toMatchObject({ chain: "agent:crm", promptId: "crm-call-summary", promptVersion: "1.0.0" });
  });

  it("writes to agent_events and throws when the row could not be recorded, so the writer stops", async () => {
    const head = { select: () => head, eq: () => head, order: () => head, limit: () => head, maybeSingle: async () => ({ data: null, error: null }) };
    const insert = vi.fn(async () => ({ error: { message: 'relation "agent_events" does not exist' } }));
    const from = vi.fn(() => ({ ...head, insert }));
    const sink = supabaseAgentEventSink({ from } as unknown as SupabaseClient, () => new Date("2026-11-04T17:00:00Z"));
    await expect(sink.record(event)).rejects.toThrow(/agent_events insert failed/);
    expect(from).toHaveBeenCalledWith("agent_events");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(Object.keys(sink)).toEqual(["record"]);
  });

  it("the memory sink copies events and numbers them", async () => {
    const sink = new MemoryAgentEventSink(() => new Date("2026-11-04T17:00:00Z"));
    const e = { ...event, reasonCodes: ["a"] };
    await sink.record(e);
    e.reasonCodes.push("mutated");
    expect(sink.events[0]).toMatchObject({ id: "evt_1", occurredAt: "2026-11-04T17:00:00.000Z", reasonCodes: ["a"] });
  });
});
