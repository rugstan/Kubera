import { describe, expect, it } from "vitest";
import { FakeStep, type WaitOptions } from "@/lib/workflows/step";
import { BROKER, createHarness, reminder } from "./testing";
import { approvalIdFilter, invokeWithApproval } from "./workflow";

describe("invokeWithApproval", () => {
  it("waits for the broker, then sends once; a replay sends nothing more", async () => {
    const h = createHarness();
    // The broker approves while the workflow waits; the decided event wakes it.
    class ApprovingStep extends FakeStep {
      override async waitForEvent(id: string, opts: WaitOptions) {
        if (!this.memo.has(id)) {
          const pending = (await h.approvals.list({ status: "pending" }))[0]!;
          await h.approvals.approve(pending.id, BROKER);
          this.script(id, { name: opts.event, data: { approvalId: pending.id } });
        }
        return super.waitForEvent(id, opts);
      }
    }
    const step = new ApprovingStep({ now: h.clock.ms });
    const out = await invokeWithApproval({ step, runner: h.runner, ctx: h.ctx(), call: reminder(), stepKey: "reminder-1", pollMs: 10 * 60_000, now: () => h.clock.ms });
    expect(out.status).toBe("executed");
    expect(h.sent).toHaveLength(1);
    const replay = await invokeWithApproval({ step, runner: h.runner, ctx: h.ctx(), call: reminder(), stepKey: "reminder-1", now: () => h.clock.ms });
    expect(replay.status).toBe("executed");
    expect(h.sent).toHaveLength(1);
    expect(step.waits[0]!.opts.if).toBe(approvalIdFilter((out as { approvalId: string }).approvalId));
  });

  it("expires at the approval deadline and never sends", async () => {
    const h = createHarness();
    const step = new FakeStep({ now: h.clock.ms });
    // Keep the harness clock in step with the fake step clock as waits time out.
    const now = () => {
      h.clock.ms = step.clock.now;
      return step.clock.now;
    };
    const out = await invokeWithApproval({ step, runner: h.runner, ctx: h.ctx(), call: reminder(), stepKey: "reminder-2", pollMs: 20 * 60_000, now });
    expect(out.status).toBe("expired");
    expect(h.sent).toHaveLength(0);
    // A broker approving after the deadline changes nothing.
    const record = h.approvalStore.all()[0]!;
    expect(record.status).toBe("expired");
    expect((await h.approvals.approve(record.id, BROKER)).ok).toBe(false);
  });

  it("returns non-pending outcomes immediately", async () => {
    const h = createHarness();
    await h.setLevel("outreach.document_reminder", "audit");
    const step = new FakeStep();
    expect((await invokeWithApproval({ step, runner: h.runner, ctx: h.ctx(), call: reminder(), stepKey: "r3" })).status).toBe("proposed");
    expect(step.waits).toHaveLength(0);
  });
});
