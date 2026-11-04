import { describe, expect, it, vi } from "vitest";
import { closedApprovalGate, FakeApprovalGate, type OutboundAction } from "@/lib/compliance/approval-gate";
import { approvalEventFilter, runApprovedAction, waitForApproval } from "./approval";
import { EVENTS } from "./events";
import { EffectInProgressError, EffectOutcomeUnknownError, idempotentEffect, MemoryIdempotencyStore } from "./idempotency";
import { FakeStep } from "./step";

const HOUR = 3_600_000;

const action = (key = "email:lead-1:confirmation"): OutboundAction => ({
  kind: "email",
  idempotencyKey: key,
  summary: "Send document request to Pat Lee",
  payload: { to: "pat@example.com" },
  requestedBy: "workflow:test",
});

function harness(defaultStatus: "approved" | "pending" | "rejected" | "expired" = "pending") {
  const step = new FakeStep();
  const gate = new FakeApprovalGate(defaultStatus);
  const effects = new MemoryIdempotencyStore();
  const execute = vi.fn(async () => ({ messageId: "msg_1" }));
  const run = (extra: Partial<Parameters<typeof runApprovedAction>[0]> = {}) =>
    runApprovedAction({ step, gate, action: action(), effects, workflow: "test", execute, now: step.now, timeoutMs: 4 * HOUR, pollMs: HOUR, ...extra });
  return { step, gate, effects, execute, run };
}

describe("approval wait with expiry", () => {
  it("expires a pending approval at the deadline and never sends", async () => {
    const { step, execute, run } = harness("pending");
    const onExpire = vi.fn(async () => {});
    const start = step.now();
    const res = await run({ onExpire });
    expect(res).toMatchObject({ sent: false, status: "expired" });
    expect(execute).not.toHaveBeenCalled();
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(step.now() - start).toBeGreaterThanOrEqual(4 * HOUR);
    // Bounded polling: four one-hour waits, each filtered to this key.
    expect(step.waits).toHaveLength(4);
    expect(step.waits[0]!.opts).toMatchObject({ event: EVENTS.approvalDecided, timeout: HOUR, if: approvalEventFilter(action().idempotencyKey) });
  });

  it("never sends when the approval arrives after the deadline", async () => {
    const { step, gate, execute, run } = harness("pending");
    step.beforeWait((id) => {
      // On the last wait, a broker approves — but only after the deadline has passed.
      if (id.endsWith("wait-3")) gate.decide(action().idempotencyKey, { status: "approved", approvalId: "appr_late", decidedBy: "broker", decidedAt: new Date(step.now() + 2 * HOUR) });
    });
    const res = await run();
    expect(res).toMatchObject({ sent: false, status: "expired" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not trust the decided event on its own", async () => {
    const { step, execute, run } = harness("pending");
    // A (forged or stale) event says approved, but the gate still says pending.
    for (let i = 0; i < 5; i++) step.script(`approval:${action().idempotencyKey}:wait-${i}`, { name: EVENTS.approvalDecided, data: { idempotencyKey: action().idempotencyKey, status: "approved", approvalId: "x" } });
    const res = await run();
    expect(res).toMatchObject({ sent: false, status: "expired" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs the action once after approval, also across replays and new runs", async () => {
    const { step, gate, effects, execute, run } = harness("pending");
    step.beforeWait((id) => {
      if (id.endsWith("wait-1")) gate.decide(action().idempotencyKey, { status: "approved", approvalId: "appr_1", decidedBy: "broker@corin", decidedAt: new Date(step.now()) });
    });
    const res = await run();
    expect(res).toMatchObject({ sent: true, approvalId: "appr_1", result: { messageId: "msg_1" }, replayed: false });
    expect(execute).toHaveBeenCalledTimes(1);

    // Inngest replay of the same run: every step is memoized.
    await run();
    expect(execute).toHaveBeenCalledTimes(1);

    // A duplicate event starts a brand-new run for the same action key.
    const second = await runApprovedAction({ step: new FakeStep(step.clock), gate, action: action(), effects, workflow: "test", execute, now: step.now });
    expect(second).toMatchObject({ sent: true, replayed: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("never runs a rejected action", async () => {
    const { execute, run } = harness("rejected");
    expect(await run()).toMatchObject({ sent: false, status: "rejected" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("sends a pre-approved template without waiting", async () => {
    const { step, execute, run } = harness("approved");
    expect(await run()).toMatchObject({ sent: true });
    expect(step.waits).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("stops waiting as soon as the gate reports expired or rejected", async () => {
    const { step, gate, execute, run } = harness("pending");
    step.beforeWait((id) => {
      if (id.endsWith("wait-0")) gate.decide(action().idempotencyKey, { status: "rejected", approvalId: "appr_1", decidedBy: "broker", reason: "wrong borrower" });
    });
    expect(await run()).toMatchObject({ sent: false, status: "rejected", reason: "wrong borrower" });
    expect(step.waits).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("with the closed gate (no queue configured) nothing ever sends", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const step = new FakeStep();
    const outcome = await waitForApproval({ step, gate: closedApprovalGate, action: action(), now: step.now, timeoutMs: 2 * HOUR, pollMs: HOUR });
    expect(outcome.status).toBe("expired");
  });
});

describe("idempotent effects", () => {
  it("retries a failed effect but not a completed one", async () => {
    const store = new MemoryIdempotencyStore();
    const effect = vi.fn().mockRejectedValueOnce(new Error("provider 503")).mockResolvedValue("ok");
    await expect(idempotentEffect(store, "k1", { workflow: "t" }, effect)).rejects.toThrow("provider 503");
    expect(await idempotentEffect(store, "k1", { workflow: "t" }, effect)).toEqual({ result: "ok", replayed: false });
    expect(await idempotentEffect(store, "k1", { workflow: "t" }, effect)).toEqual({ result: "ok", replayed: true });
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it("refuses to guess when an earlier attempt died mid-effect", async () => {
    const store = new MemoryIdempotencyStore();
    const t0 = new Date("2026-11-03T17:00:00Z");
    await store.claim("k2", { workflow: "t" }, t0);
    const effect = vi.fn(async () => "sent");
    await expect(idempotentEffect(store, "k2", { workflow: "t" }, effect, { now: () => new Date(t0.getTime() + 60_000) })).rejects.toBeInstanceOf(EffectInProgressError);
    await expect(idempotentEffect(store, "k2", { workflow: "t" }, effect, { now: () => new Date(t0.getTime() + HOUR) })).rejects.toBeInstanceOf(EffectOutcomeUnknownError);
    expect(effect).not.toHaveBeenCalled();
  });
});
