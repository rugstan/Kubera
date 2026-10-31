import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { MemoryAgentEventSink, supabaseAgentEventSink, toAgentEventRow, type AgentEventInput } from "./events";

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
  it("maps to the agent_events row, keeping only valid uuids", () => {
    const row = toAgentEventRow(event, new Date("2026-11-04T17:00:00Z"));
    expect(row).toMatchObject({
      occurred_at: "2026-11-04T17:00:00.000Z",
      agent: "crm",
      task: "stage_sync",
      action: "stage_update",
      phase: "executed",
      deal_id: "10000000-0000-4000-8000-000000000003",
      lead_id: null,
      approval_id: null,
      approver: "Pat Broker",
      external_ref: "opp-1",
      reason_codes: ["deal_stage_changed"],
      tool_version: "crm-tools@1",
    });
  });

  it("is insert only", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));
    const sink = supabaseAgentEventSink({ from } as unknown as SupabaseClient, () => new Date("2026-11-04T17:00:00Z"));
    await sink.record(event);
    expect(from).toHaveBeenCalledWith("agent_events");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(Object.keys(sink)).toEqual(["record"]);
  });

  it("throws when the row could not be recorded, so the writer stops", async () => {
    const insert = async () => ({ error: { message: 'relation "agent_events" does not exist' } });
    const sink = supabaseAgentEventSink({ from: () => ({ insert }) } as unknown as SupabaseClient);
    await expect(sink.record(event)).rejects.toThrow(/agent_events insert failed/);
  });

  it("the memory sink copies events and numbers them", async () => {
    const sink = new MemoryAgentEventSink(() => new Date("2026-11-04T17:00:00Z"));
    const e = { ...event, reasonCodes: ["a"] };
    await sink.record(e);
    e.reasonCodes.push("mutated");
    expect(sink.events[0]).toMatchObject({ id: "evt_1", occurredAt: "2026-11-04T17:00:00.000Z", reasonCodes: ["a"] });
  });
});
