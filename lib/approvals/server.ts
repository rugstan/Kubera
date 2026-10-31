import "server-only";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { closedApprovalGate } from "@/lib/compliance/approval-gate";
import { resolveAuthMode } from "@/lib/auth/config";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MemoryReauthStore, supabaseReauthStore, type ReauthStore } from "@/lib/agents/core/reauth";
import { seedDemoApprovals } from "./demo";
import { queueApprovalGate } from "./gate";
import { sendWorkflowEvent } from "@/lib/workflows/client";
import { EVENTS as WORKFLOW_EVENTS } from "@/lib/workflows/events";
import { executeApproved } from "./executors";
import { ApprovalService, type ApprovalHooks } from "./service";
import { MemoryApprovalStore, type ApprovalStore } from "./store";
import { supabaseApprovalStore } from "./supabase-store";

// Server wiring for the approval queue. Supabase (service role) when
// configured; an in-memory demo queue in fake-auth mode; otherwise null and
// the gate stays closed (nothing is ever sent).

let override: ApprovalService | null | undefined;

export function setApprovalService(service: ApprovalService | null | undefined): void {
  override = service;
}

/**
 * Wakes workflows waiting on an approval (lib/workflows/approval.ts) instead of
 * the next gate poll, then runs the executor registered for an approved action
 * that no workflow waits on (lib/approvals/executors-server.ts), once.
 */
function hooksFor(service: () => ApprovalService): ApprovalHooks {
  return {
    async onDecided(records) {
      try {
        await sendWorkflowEvent(
          records.map((r) => ({
            name: WORKFLOW_EVENTS.approvalDecided,
            id: `approval-decided:${r.id}:${r.status}`,
            data: { approvalId: r.id, idempotencyKey: r.idempotencyKey, status: r.status },
          })),
        );
      } catch (err) {
        console.warn("[approvals] workflow wake-up failed", err instanceof Error ? err.message : err);
      }
      if (!records.some((r) => r.status === "approved")) return;
      const { approvalExecutors } = await import("./executors-server");
      await executeApproved(service(), records, approvalExecutors());
    },
  };
}

const REAUTH_MEMORY_KEY = Symbol.for("kubera.approvals.reauth.memory");

/**
 * Step-up proofs (approval_reauthentications): Supabase when configured, an
 * in-memory store shared per process in fake-auth mode (demo / e2e) or when
 * Supabase is missing (then the queue itself is unavailable outside fake mode).
 */
export function reauthStore(): ReauthStore {
  const db = resolveAuthMode().mode === "fake" ? null : supabaseAdmin();
  if (db) return supabaseReauthStore(db);
  const g = globalThis as unknown as Record<symbol, MemoryReauthStore | undefined>;
  g[REAUTH_MEMORY_KEY] ??= new MemoryReauthStore();
  return g[REAUTH_MEMORY_KEY]!;
}

function withHooks(store: ApprovalStore): ApprovalService {
  const service: ApprovalService = new ApprovalService(store, undefined, hooksFor(() => service), reauthStore());
  return service;
}

const DEMO_KEY = Symbol.for("kubera.approvals.demo");
type DemoBundle = { service: ApprovalService; ready: Promise<void> };

function demoService(): ApprovalService {
  const g = globalThis as unknown as Record<symbol, DemoBundle | undefined>;
  let bundle = g[DEMO_KEY];
  if (!bundle) {
    const store = new MemoryApprovalStore();
    const service = withHooks(store);
    bundle = { service, ready: seedDemoApprovals(service, store) };
    g[DEMO_KEY] = bundle;
  }
  return bundle.service;
}


export function approvalService(): ApprovalService | null {
  if (override !== undefined) return override;
  if (resolveAuthMode().mode === "fake") return demoService();
  const db = supabaseAdmin();
  return db ? withHooks(supabaseApprovalStore(db)) : null;
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
