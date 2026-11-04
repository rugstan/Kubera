import { describe, expect, it } from "vitest";
import { AGENT_TASKS, atLeast, AutonomyError, AutonomyPolicy, MemoryAutonomyStore, minLevel, type TaskPolicy } from "./autonomy";

const broker = { userId: "11111111-1111-4111-8111-111111111111", label: "Dana", dreLicense: "01234567" };

describe("autonomy policy", () => {
  it("uses task defaults, audit for unknown tasks, and the latest broker setting", async () => {
    const p = new AutonomyPolicy(new MemoryAutonomyStore());
    expect(await p.level("mail.triage")).toBe("automate");
    expect(await p.level("crm.stage_update")).toBe("assist");
    expect(await p.level("not.registered")).toBe("audit");
    await p.set("crm.stage_update", "automate", broker, "Stage moves are reliable after 30-day review");
    await p.set("crm.stage_update", "audit", broker, "Pausing during CRM migration");
    expect(await p.level("crm.stage_update")).toBe("audit");
    expect((await p.levels())["crm.stage_update"]).toBe("audit");
  });

  it("enforces ceilings, licenses and reasons", async () => {
    const p = new AutonomyPolicy(new MemoryAutonomyStore());
    await expect(p.set("disclosures.mlds_send", "automate", broker, "x")).rejects.toMatchObject({ code: "above_ceiling" });
    await expect(p.set("crm.note", "automate", { ...broker, dreLicense: null }, "x")).rejects.toMatchObject({ code: "invalid_approver" });
    await expect(p.set("crm.note", "automate", broker, "   ")).rejects.toMatchObject({ code: "reason_required" });
    await expect(p.set("nope.task", "assist", broker, "x")).rejects.toBeInstanceOf(AutonomyError);
  });

  it("every re-authenticated task is capped at assist and every default is within its ceiling", () => {
    for (const [task, policy] of Object.entries(AGENT_TASKS) as [string, TaskPolicy][]) {
      expect(atLeast(policy.maxLevel, policy.defaultLevel), task).toBe(true);
      if (policy.reauth) expect(policy.maxLevel, task).toBe("assist");
    }
    expect(() => new AutonomyPolicy(new MemoryAutonomyStore(), { bad: { description: "x", defaultLevel: "automate", maxLevel: "automate", reauth: true } })).toThrow(/capped/);
  });

  it("registers more tasks at runtime", async () => {
    const p = new AutonomyPolicy(new MemoryAutonomyStore()).withTasks({ "intel.extra": { description: "x", defaultLevel: "assist", maxLevel: "assist" } });
    expect(await p.level("intel.extra")).toBe("assist");
  });

  it("orders levels", () => {
    expect(minLevel("automate", "assist")).toBe("assist");
    expect(atLeast("assist", "audit")).toBe(true);
    expect(atLeast("audit", "assist")).toBe(false);
  });
});
