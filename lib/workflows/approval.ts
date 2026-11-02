// Approval wait with expiry (Global rule 2).
//
// Every outbound action a workflow takes runs through `runApprovedAction`:
//
//   1. ask the broker approval gate (lib/compliance/approval-gate.ts; the real
//      queue is lib/approvals). Pre-approved templates come back approved at once.
//   2. while pending: wait for a `corin/approval.decided` event for this
//      idempotency key, polling the gate between waits so a missed event
//      cannot strand the run. The gate is the source of truth; the event is
//      only a wake-up call and is never trusted on its own.
//   3. at the deadline the request expires and the action NEVER runs, even if
//      an approval shows up later.
//   4. once approved, the action runs exactly once (idempotent effect keyed by
//      the action's idempotency key).
//
// All gate calls and the action sit in their own memoized steps, so an Inngest
// replay never re-asks or re-sends.

import type { ApprovalGate, OutboundAction } from "@/lib/compliance/approval-gate";
import { EVENTS } from "./events";
import { idempotentEffect, type IdempotencyStore } from "./idempotency";
import type { WorkflowStep } from "./step";

/** Matches lib/approvals DEFAULT_TTL_MINUTES (24 h). */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 24 * 60 * 60_000;
export const DEFAULT_APPROVAL_POLL_MS = 30 * 60_000;
const MIN_WAIT_MS = 1_000;

/** JSON-safe form of an ApprovalDecision (step results are stored as JSON). */
export type GateAnswer =
  | { status: "approved"; approvalId: string; decidedBy: string; decidedAt: string }
  | { status: "pending"; approvalId: string | null }
  | { status: "rejected"; approvalId: string; decidedBy: string; reason: string | null }
  | { status: "expired"; approvalId: string | null };

export type ApprovalOutcome =
  | { status: "approved"; approvalId: string; decidedBy: string; decidedAt: string }
  | { status: "rejected"; approvalId: string; reason: string | null }
  | { status: "expired"; approvalId: string | null };

async function ask(gate: ApprovalGate, action: OutboundAction): Promise<GateAnswer> {
  const d = await gate.request(action);
  switch (d.status) {
    case "approved":
      return { status: "approved", approvalId: d.approvalId, decidedBy: d.decidedBy, decidedAt: d.decidedAt.toISOString() };
    case "pending":
      return { status: "pending", approvalId: d.approvalId ?? null };
    case "rejected":
      return { status: "rejected", approvalId: d.approvalId, decidedBy: d.decidedBy, reason: d.reason ?? null };
    case "expired":
      return { status: "expired", approvalId: d.approvalId };
  }
}

export type WaitForApprovalOptions = {
  step: WorkflowStep;
  gate: ApprovalGate;
  action: OutboundAction;
  /** How long a pending approval may wait before it expires. Default 24 h. */
  timeoutMs?: number;
  /** How often the gate is re-checked when no event arrives. Default 30 min. */
  pollMs?: number;
  now?: () => number;
  /** Called once when the wait expires (e.g. mark the approval row expired). */
  onExpire?: (approvalId: string | null) => Promise<void>;
};

/** CEL filter for the decided event of one idempotency key. */
export function approvalEventFilter(idempotencyKey: string): string {
  return `async.data.idempotencyKey == ${JSON.stringify(idempotencyKey)}`;
}

export async function waitForApproval(opts: WaitForApprovalOptions): Promise<ApprovalOutcome> {
  const { step, gate, action } = opts;
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = Math.max(MIN_WAIT_MS, opts.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS);
  const pollMs = Math.max(MIN_WAIT_MS, Math.min(opts.pollMs ?? DEFAULT_APPROVAL_POLL_MS, timeoutMs));
  const tag = `approval:${action.idempotencyKey}`;

  // The deadline is fixed once (memoized), so replays agree on it.
  const deadline = await step.run(`${tag}:deadline`, () => now() + timeoutMs);
  const first = await step.run(`${tag}:request`, () => ask(gate, action));
  let approvalId = first.approvalId;

  const settle = (a: GateAnswer): ApprovalOutcome | null => {
    if (a.status === "approved") {
      // An approval decided after the deadline does not count.
      return Date.parse(a.decidedAt) <= deadline ? a : { status: "expired", approvalId: a.approvalId };
    }
    if (a.status === "rejected") return { status: "rejected", approvalId: a.approvalId, reason: a.reason };
    if (a.status === "expired") return { status: "expired", approvalId: a.approvalId };
    return null;
  };

  let outcome = settle(first);
  const maxRounds = Math.ceil(timeoutMs / pollMs) + 1;
  for (let i = 0; !outcome && i < maxRounds; i++) {
    const at = await step.run(`${tag}:clock-${i}`, () => now());
    const remaining = deadline - at;
    if (remaining < MIN_WAIT_MS) break;
    await step.waitForEvent(`${tag}:wait-${i}`, {
      event: EVENTS.approvalDecided,
      timeout: Math.min(pollMs, remaining),
      if: approvalEventFilter(action.idempotencyKey),
    });
    const checkedAt = await step.run(`${tag}:checked-at-${i}`, () => now());
    const answer = await step.run(`${tag}:check-${i}`, () => ask(gate, action));
    approvalId = answer.approvalId ?? approvalId;
    outcome = settle(answer);
    // Still pending at or past the deadline: stop waiting.
    if (!outcome && checkedAt >= deadline) break;
  }

  if (outcome) return outcome;
  await step.run(`${tag}:expire`, async () => {
    await opts.onExpire?.(approvalId);
    return true;
  });
  return { status: "expired", approvalId };
}

export type ApprovedActionResult<T> =
  | { sent: true; approvalId: string; result: T; replayed: boolean }
  | { sent: false; status: "rejected" | "expired"; approvalId: string | null; reason?: string | null };

/**
 * Waits for approval, then runs `execute` exactly once. Rejected or expired
 * actions never run.
 */
export async function runApprovedAction<T>(
  opts: WaitForApprovalOptions & {
    effects: IdempotencyStore;
    workflow: string;
    runId?: string;
    execute: (approval: { approvalId: string; decidedBy: string }) => Promise<T>;
  },
): Promise<ApprovedActionResult<T>> {
  const outcome = await waitForApproval(opts);
  if (outcome.status !== "approved") {
    return { sent: false, status: outcome.status, approvalId: outcome.approvalId, ...(outcome.status === "rejected" ? { reason: outcome.reason } : {}) };
  }
  const now = opts.now ?? (() => Date.now());
  const done = await opts.step.run(`outbound:${opts.action.idempotencyKey}:execute`, () =>
    idempotentEffect(opts.effects, `outbound:${opts.action.idempotencyKey}`, { workflow: opts.workflow, ...(opts.runId ? { runId: opts.runId } : {}) }, () => opts.execute(outcome), {
      now: () => new Date(now()),
    }),
  );
  return { sent: true, approvalId: outcome.approvalId, result: done.result, replayed: done.replayed };
}
