import "server-only";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { closedApprovalGate } from "@/lib/compliance/approval-gate";
import { resolveAuthMode } from "@/lib/auth/config";
import { supabaseAdmin } from "@/lib/supabase/server";
import { seedDemoApprovals } from "./demo";
import { queueApprovalGate } from "./gate";
import { sendWorkflowEvent } from "@/lib/workflows/client";
import { EVENTS as WORKFLOW_EVENTS } from "@/lib/workflows/events";
import { ApprovalService, type ApprovalHooks } from "./service";
import { MemoryApprovalStore } from "./store";
import { supabaseApprovalStore } from "./supabase-store";

// Server wiring for the approval queue. Supabase (service role) when
// configured; an in-memory demo queue in fake-auth mode; otherwise null and
// the gate stays closed (nothing is ever sent).

let override: ApprovalService | null | undefined;

export function setApprovalService(service: ApprovalService | null | undefined): void {
  override = service;
}

/** Wakes workflows waiting on an approval (lib/workflows/approval.ts) instead of the next gate poll. */
const hooks: ApprovalHooks = {
  async onDecided(records) {
    await sendWorkflowEvent(
      records.map((r) => ({
        name: WORKFLOW_EVENTS.approvalDecided,
        id: `approval-decided:${r.id}:${r.status}`,
        data: { approvalId: r.id, idempotencyKey: r.idempotencyKey, status: r.status },
      })),
    );
  },
};

const DEMO_KEY = Symbol.for("kubera.approvals.demo");
type DemoBundle = { service: ApprovalService; ready: Promise<void> };

function demoService(): ApprovalService {
  const g = globalThis as unknown as Record<symbol, DemoBundle | undefined>;
  let bundle = g[DEMO_KEY];
  if (!bundle) {
    const store = new MemoryApprovalStore();
    const service = new ApprovalService(store, undefined, hooks);
    bundle = { service, ready: seedDemoApprovals(service, store) };
    g[DEMO_KEY] = bundle;
  }
  return bundle.service;
}


export function approvalService(): ApprovalService | null {
  if (override !== undefined) return override;
  if (resolveAuthMode().mode === "fake") return demoService();
  const db = supabaseAdmin();
  return db ? new ApprovalService(supabaseApprovalStore(db), undefined, hooks) : null;
}

/** Same as approvalService(), after the demo queue (fake mode) finished seeding. */
export async function getApprovalService(): Promise<ApprovalService | null> {
  const service = approvalService();
  const g = globalThis as unknown as Record<symbol, DemoBundle | undefined>;
  await g[DEMO_KEY]?.ready;
  return service;
}

/**
 * The broker approval gate for outbound actions (Global rule 2). Falls back
 * to the closed gate, which records nothing and never approves.
 */
export function approvalGate(): ApprovalGate {
  const service = approvalService();
  return service ? queueApprovalGate(service) : closedApprovalGate;
}
