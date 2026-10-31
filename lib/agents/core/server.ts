import "server-only";
import { getApprovalService } from "@/lib/approvals/server";
import { resolveAuthMode } from "@/lib/auth/config";
import { supabaseAdmin } from "@/lib/supabase/server";
import { AutonomyPolicy, MemoryAutonomyStore, supabaseAutonomyStore } from "./autonomy";
import { MemoryAgentEventStore, supabaseAgentEventStore, type AgentEventStore } from "./events";
import { MemoryReauthStore, ReauthService, supabaseReauthStore } from "./reauth";
import { ToolRunner, type Tool } from "./tools";

// Server wiring for the agent safety platform. Supabase (service role) when
// configured; in-memory stores in fake-auth mode (demo / e2e); otherwise the
// event log is unavailable and every write tool is blocked (an agent cannot
// act without an audit trail and an approval queue).

export type AgentSafety = {
  events: AgentEventStore | null;
  autonomy: AutonomyPolicy;
  reauth: ReauthService;
  /** A runner over `tools`, or null when there is no audit trail. */
  runner(tools: readonly Tool[]): Promise<ToolRunner | null>;
};

const MEMORY_KEY = Symbol.for("kubera.agents.core.memory");
type MemoryBundle = { events: MemoryAgentEventStore; autonomy: MemoryAutonomyStore; reauth: MemoryReauthStore };

function memory(): MemoryBundle {
  const g = globalThis as unknown as Record<symbol, MemoryBundle | undefined>;
  g[MEMORY_KEY] ??= { events: new MemoryAgentEventStore(), autonomy: new MemoryAutonomyStore(), reauth: new MemoryReauthStore() };
  return g[MEMORY_KEY]!;
}

let warned = false;
let override: AgentSafety | undefined;

/** Test hook. */
export function setAgentSafety(s: AgentSafety | undefined): void {
  override = s;
}

export function agentSafety(): AgentSafety {
  if (override) return override;
  const db = supabaseAdmin();
  const fake = resolveAuthMode().mode === "fake";
  let events: AgentEventStore | null;
  let autonomy: AutonomyPolicy;
  let reauth: ReauthService;
  if (db && !fake) {
    events = supabaseAgentEventStore(db);
    autonomy = new AutonomyPolicy(supabaseAutonomyStore(db));
    reauth = new ReauthService(supabaseReauthStore(db));
  } else if (fake) {
    const m = memory();
    events = m.events;
    autonomy = new AutonomyPolicy(m.autonomy);
    reauth = new ReauthService(m.reauth);
  } else {
    if (!warned) {
      warned = true;
      console.warn("[agents] Supabase is not configured: agent events are not recorded and agent write tools are blocked.");
    }
    const m = memory();
    events = null;
    autonomy = new AutonomyPolicy(m.autonomy);
    reauth = new ReauthService(m.reauth);
  }
  return {
    events,
    autonomy,
    reauth,
    async runner(tools) {
      if (!events) return null;
      const approvals = await getApprovalService();
      return new ToolRunner({ tools, events, approvals, autonomy, reauth });
    },
  };
}
