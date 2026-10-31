// Agent-event logging for the intel and prospecting agents (agent_events, AB).
// Metadata only: ids, counts, reason codes and prompt versions. Never signal
// text, owner names, addresses or message bodies. A failing log never stops
// the work (the action already happened or was refused on its own terms).

import type { AgentEventInput, AgentEventStore } from "@/lib/agents/core/events";
import type { AutonomyLevel } from "@/lib/agents/core/autonomy";

export const INTEL_AGENT = "intel";
export const PROSPECTING_AGENT = "prospecting";
export const AGENT_VERSION = "1.0.0";

export const TASKS = {
  marketDraft: "intel.market_draft",
  outreachDraft: "prospecting.outreach_draft",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOrNull = (v: string | null | undefined): string | null => (v && UUID.test(v) ? v : null);

export type IntelEventSink = Pick<AgentEventStore, "append"> | null | undefined;

export async function logIntelEvent(events: IntelEventSink, event: AgentEventInput & { autonomy?: AutonomyLevel | null }): Promise<boolean> {
  if (!events) return false;
  try {
    await events.append({ agentVersion: AGENT_VERSION, ...event });
    return true;
  } catch (err) {
    console.error(`[${event.agent}] could not record ${event.eventType}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** The autonomy level for a task; audit when the policy is unavailable (fail closed). */
export async function levelFor(autonomy: { level(task: string): Promise<AutonomyLevel> } | null | undefined, task: string): Promise<AutonomyLevel> {
  if (!autonomy) return "assist";
  try {
    return await autonomy.level(task);
  } catch (err) {
    console.error("[intel] autonomy lookup failed; running in audit mode", err instanceof Error ? err.message : err);
    return "audit";
  }
}
