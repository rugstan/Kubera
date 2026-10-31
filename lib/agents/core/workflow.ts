// Running an agent tool inside a workflow: ask once, wait for the broker's
// decision (woken by `kubera/approval.decided`, polling between waits so a
// missed event cannot strand the run), then invoke again to execute or to
// learn that the approval expired. The approval's own expiry is the deadline:
// once it passes the queue marks the request expired and it never sends.
//
// Every invocation sits in its own memoized step, so an Inngest replay never
// re-asks or re-sends; the runner's idempotency key makes a re-invocation of
// an executed action a no-op anyway.

import { EVENTS } from "@/lib/workflows/events";
import type { WorkflowStep } from "@/lib/workflows/step";
import type { AgentRunContext, ToolCall, ToolOutcome, ToolRunner } from "./tools";

export const DEFAULT_TOOL_POLL_MS = 30 * 60_000;
const MIN_WAIT_MS = 1_000;

export type InvokeWithApprovalOptions = {
  step: WorkflowStep;
  runner: Pick<ToolRunner, "invoke">;
  ctx: AgentRunContext;
  call: ToolCall;
  /** Unique within the workflow run (step ids derive from it). */
  stepKey: string;
  pollMs?: number;
  now?: () => number;
};

export function approvalIdFilter(approvalId: string): string {
  return `async.data.approvalId == ${JSON.stringify(approvalId)}`;
}

export async function invokeWithApproval(opts: InvokeWithApprovalOptions): Promise<ToolOutcome> {
  const { step, runner, ctx, call } = opts;
  const now = opts.now ?? (() => Date.now());
  const pollMs = Math.max(MIN_WAIT_MS, opts.pollMs ?? DEFAULT_TOOL_POLL_MS);
  const tag = `agent-tool:${opts.stepKey}`;

  let outcome = await step.run(`${tag}:invoke-0`, () => runner.invoke(ctx, call));
  if (outcome.status !== "pending_approval") return outcome;
  const approvalId = outcome.approvalId;
  const deadline = Date.parse(outcome.expiresAt);
  const maxRounds = Math.ceil(Math.max(0, deadline - now()) / pollMs) + 2;

  for (let i = 1; outcome.status === "pending_approval" && i <= maxRounds; i++) {
    const at = await step.run(`${tag}:clock-${i}`, () => now());
    const remaining = deadline - at;
    if (remaining >= MIN_WAIT_MS) {
      await step.waitForEvent(`${tag}:wait-${i}`, { event: EVENTS.approvalDecided, timeout: Math.min(pollMs, remaining), if: approvalIdFilter(approvalId) });
    }
    outcome = await step.run(`${tag}:invoke-${i}`, () => runner.invoke(ctx, call));
    if (remaining < MIN_WAIT_MS) break;
  }
  // Past the deadline and the queue still says pending (clock skew): treat as expired; nothing was sent.
  return outcome.status === "pending_approval" ? { status: "expired", tool: outcome.tool, approvalId } : outcome;
}
