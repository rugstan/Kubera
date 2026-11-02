import { describe, expect, it } from "vitest";
import { FakeStep } from "@/lib/workflows/step";
import { FakeMaturityProvider } from "./maturity";
import { draftOutreach } from "./outreach";
import { MemoryProspectStore } from "./prospect-store";
import { StaticSignalSource } from "./signals";
import { NOW, broker, intelSetup, maturityRecord, outreachSetup, seedProspect, testGateway } from "./testing";
import { INTEL_EVENTS, outreachSettleWorkflow, prospectScanWorkflow, weeklyIntelWorkflow } from "./workflow";

describe("weeklyIntelWorkflow", () => {
  const sources = [new StaticSignalSource("rates", { drafts: [{ source: "rates", title: "Rates", summary: "4.25%", publishedAt: "2026-11-04", key: "r" }] })];

  it("writes the note in one step and returns ids and counts only", async () => {
    const { store } = intelSetup();
    const step = new FakeStep();
    const out = await weeklyIntelWorkflow({ data: {}, step }, { gateway: testGateway({ xai: false }).gateway, sources, store, now: () => NOW });
    expect(out).toMatchObject({ status: "drafted", usedModel: false, signalCount: 1 });
    expect(step.executed).toEqual(["write-weekly-note"]);
    expect(JSON.stringify(out)).not.toContain("4.25%");
    // A replay (an Inngest retry) does not write a second draft.
    await weeklyIntelWorkflow({ data: {}, step }, { gateway: testGateway({ xai: false }).gateway, sources, store, now: () => NOW });
    expect(await store.listDrafts()).toHaveLength(1);
  });

  it("validates its input", async () => {
    const { store } = intelSetup();
    await expect(weeklyIntelWorkflow({ data: { weekStart: "next week" }, step: new FakeStep() }, { gateway: testGateway().gateway, sources, store })).rejects.toThrow();
  });

  it("exposes event names for the registration", () => {
    expect(Object.values(INTEL_EVENTS).every((n) => n.startsWith("corin/"))).toBe(true);
  });
});

describe("prospectScanWorkflow", () => {
  it("scans the requested ZIP codes", async () => {
    const store = new MemoryProspectStore();
    const step = new FakeStep();
    const out = await prospectScanWorkflow({ data: { zips: ["90001"], toMonths: 18 }, step }, { provider: new FakeMaturityProvider([maturityRecord()]), store, now: () => NOW });
    expect(out).toMatchObject({ status: "completed", found: 1, created: 1 });
    expect(await store.listProspects()).toHaveLength(1);
  });

  it("reports an unconfigured provider as a status, not an error", async () => {
    const out = await prospectScanWorkflow({ data: { zips: ["90001"] }, step: new FakeStep() }, { provider: null, store: new MemoryProspectStore(), now: () => NOW });
    expect(out).toEqual({ status: "not_configured" });
  });

  it("rejects a malformed ZIP list", async () => {
    await expect(prospectScanWorkflow({ data: { zips: ["abc"] }, step: new FakeStep() }, { provider: null, store: new MemoryProspectStore() })).rejects.toThrow();
  });
});

describe("outreachSettleWorkflow", () => {
  it("settles approved drafts once and returns counts only", async () => {
    const s = outreachSetup();
    const p = await seedProspect(s.store, {}, { contactEmail: "pat@owner.example" });
    const res = await draftOutreach(s.deps, { prospectId: p.id, channel: "email", actor: "x" });
    if (res.status !== "drafted") throw new Error("expected draft");
    await s.approvals.approve((await s.approvals.getByKey(res.outreach.idempotencyKey))!.id, broker);
    const step = new FakeStep();
    const out = await outreachSettleWorkflow({ step }, s.deps);
    expect(out).toMatchObject({ checked: 1, sent: 1 });
    await outreachSettleWorkflow({ step }, s.deps); // replayed step: no second run
    expect(s.email!.sent).toHaveLength(1);
  });
});
