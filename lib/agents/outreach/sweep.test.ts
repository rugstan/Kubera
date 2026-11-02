import { describe, expect, it, vi } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import type { ConstructionReport } from "@/lib/construction/types";
import { handleCallRequest, handleSpeedToLead, handleSweep } from "./handlers";
import { runOutreachSweep, type SweepDeps } from "./sweep";
import { DAY, DAYTIME, LEAD_EMAIL, LEAD_PHONE, makeCondition, makeDealCtx, makeHarness, makeItem, makeLead, makeVoiceHarness } from "./testing";
import { OUTREACH_EVENTS, outreachSweepWorkflow, speedToLeadWorkflow } from "./workflow";
import { FakeStep } from "@/lib/workflows/step";

const PRE = ["document_reminder_email@1", "document_reminder_sms@1", "closing_nudge_email@1", "vendor_nudge_email@1"];

const vendorReport = (): ConstructionReport => ({
  id: "rpt-1",
  createdAt: new Date(DAYTIME.getTime() - 20 * DAY).toISOString(),
  updatedAt: new Date(DAYTIME.getTime() - 20 * DAY).toISOString(),
  projectId: "prj-1",
  reportType: "pcna",
  status: "in_progress",
  vendorName: "Vendor Co",
  vendorEmail: "orders@vendor.example",
  vendorReference: "V-1",
  orderedAt: new Date(DAYTIME.getTime() - 20 * DAY).toISOString(),
  dueAt: new Date(DAYTIME.getTime() + DAY).toISOString(),
  deliveredAt: null,
  acceptedAt: null,
  documentId: null,
  approvalId: null,
  orderAttempt: 0,
  notes: null,
});

function world(opts: Parameters<typeof makeHarness>[0] = { preApproved: PRE }) {
  const h = makeHarness(opts);
  const hot = makeLead({}, 5_000);
  const dealLead = makeLead({ id: "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10", tier: "TIER_3_NURTURE", createdAt: new Date(DAYTIME.getTime() - 30 * DAY).toISOString() });
  h.sources.leads = [hot, dealLead];
  h.grant({ phone: LEAD_PHONE, email: LEAD_EMAIL });
  h.sources.deals = [
    makeDealCtx({ deal: { leadId: dealLead.id }, items: [makeItem({ title: "Rent roll" })] }),
    makeDealCtx({ deal: { id: "deal-2", leadId: dealLead.id, stage: "closing", stageEnteredAt: new Date(DAYTIME.getTime() - 2 * DAY).toISOString() }, items: [makeItem({ dealId: "deal-2", stage: "pre_closing", title: "Insurance evidence" })], conditions: [makeCondition({ dealId: "deal-2" })] }),
  ];
  h.sources.orders = [{ project: { id: "prj-1", name: "Sample Gardens", dealId: "deal-1", leadId: null, propertyAddress: null, city: "Fresno", state: "CA", phase: "pre_closing" }, report: vendorReport() }];
  const deps = (): SweepDeps => ({ sender: h.sender, store: h.store, sources: h.sources, escalation: h.escalation, audit: h.audit, now: h.now });
  return { h, hot, deps };
}

describe("outreach sweep", () => {
  it("runs every chaser once and sends only what is due", async () => {
    const { h, deps } = world();
    const s = await runOutreachSweep(deps());
    expect(s.speedToLead).toMatchObject({ checked: 1, sent: 1, errors: 0 });
    expect(s.documents).toMatchObject({ deals: 2, sent: 1, errors: 0 });
    expect(s.closing).toMatchObject({ deals: 2, sent: 1, errors: 0 });
    expect(s.vendors).toMatchObject({ orders: 1, sent: 1, errors: 0 });
    // 1 speed-to-lead text + 1 doc email + 1 closing email + 1 vendor email
    expect(h.sms.sent).toHaveLength(1);
    expect(h.email.sent).toHaveLength(3);
  });

  it("is idempotent: a second pass sends nothing new", async () => {
    const { h, deps } = world();
    await runOutreachSweep(deps());
    const before = { sms: h.sms.sent.length, email: h.email.sent.length };
    const again = await runOutreachSweep(deps());
    expect(again.speedToLead.sent).toBe(0);
    expect(again.documents.sent + again.closing.sent + again.vendors.sent).toBe(0);
    expect({ sms: h.sms.sent.length, email: h.email.sent.length }).toEqual(before);
  });

  it("sends nothing at all to people without consent, and holds everything else for approval", async () => {
    const { h, deps } = world({ gate: new FakeApprovalGate("pending") });
    h.ledger.events.length = 0;
    h.grant({ email: LEAD_EMAIL, channels: ["email"], eventType: "revoked" });
    h.stop(LEAD_PHONE);
    const s = await runOutreachSweep(deps());
    expect(h.sms.sent).toHaveLength(0);
    expect(h.email.sent).toHaveLength(0);
    expect(s.speedToLead.escalated).toBe(1);
  });

  it("keeps going when one deal fails", async () => {
    const { h, deps } = world();
    const original = h.sources.lead.bind(h.sources);
    let calls = 0;
    h.sources.lead = async (id: string) => {
      calls += 1;
      if (calls === 2) throw new Error("db blip");
      return original(id);
    };
    const s = await runOutreachSweep(deps());
    expect(s.documents.errors + s.closing.errors).toBe(1);
    expect(s.vendors.sent).toBe(1);
  });

  it("retries a speed-to-lead text held outside the window once it opens", async () => {
    const night = new Date("2026-11-04T05:00:00Z");
    const h = makeHarness({ now: night });
    const lead = makeLead({ contact: { firstName: "Pat", email: null, phone: LEAD_PHONE, consent: true } }, 5_000, night);
    h.sources.leads = [lead];
    h.grant({ phone: LEAD_PHONE });
    const deps: SweepDeps = { sender: h.sender, store: h.store, sources: h.sources, escalation: h.escalation, now: h.now };
    await runOutreachSweep(deps);
    expect(h.sms.sent).toHaveLength(0);
    h.clock.now = new Date(night.getTime() + 15 * 3_600_000);
    // The lead is older than the 30-minute window, but its held text is retried for a day.
    const s = await runOutreachSweep(deps);
    expect(s.speedToLead.sent).toBe(1);
    expect(h.sms.sent).toHaveLength(1);
  });
});

describe("handlers", () => {
  const secret = "s".repeat(40);
  const withSecret = (env: Record<string, string | undefined>, fn: () => Promise<void>) => async () => {
    const old = { ...process.env };
    Object.assign(process.env, env);
    try {
      await fn();
    } finally {
      for (const k of Object.keys(env)) {
        if (old[k] === undefined) delete process.env[k];
        else process.env[k] = old[k];
      }
    }
  };
  const req = (path: string, body: unknown, auth?: string, method = "POST") =>
    new Request(`https://corincommercial.com${path}`, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body) });

  it("speed-to-lead requires the internal bearer secret", withSecret({ NOTIFY_INTERNAL_SECRET: secret }, async () => {
    const { h, hot } = world();
    const d = { sender: h.sender, store: h.store, sources: h.sources, now: h.now };
    expect((await handleSpeedToLead(req("/x", { leadId: hot.id }), d)).status).toBe(401);
    expect((await handleSpeedToLead(req("/x", { leadId: hot.id }, "Bearer wrong"), d)).status).toBe(401);
    expect(h.sms.sent).toHaveLength(0);
    const ok = await handleSpeedToLead(req("/x", { leadId: hot.id }, `Bearer ${secret}`), d);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, sent: "sms", withinSla: true });
    expect((await handleSpeedToLead(req("/x", { leadId: "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a99" }, `Bearer ${secret}`), d)).status).toBe(404);
    expect((await handleSpeedToLead(req("/x", { leadId: "nope" }, `Bearer ${secret}`), d)).status).toBe(400);
  }));

  it("speed-to-lead is closed when the secret is not configured", withSecret({ NOTIFY_INTERNAL_SECRET: undefined }, async () => {
    const { h, hot } = world();
    delete process.env.NOTIFY_INTERNAL_SECRET;
    const res = await handleSpeedToLead(req("/x", { leadId: hot.id }, "Bearer anything"), { sender: h.sender, store: h.store, sources: h.sources, now: h.now });
    expect(res.status).toBe(503);
  }));

  it("the sweep requires the cron secret", withSecret({ CRON_SECRET: secret }, async () => {
    const { deps } = world();
    const get = (auth?: string) => new Request("https://corincommercial.com/api/outreach/sweep", { headers: auth ? { authorization: auth } : {} });
    expect((await handleSweep(get(), deps())).status).toBe(401);
    const res = await handleSweep(get(`Bearer ${secret}`), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, speedToLead: { sent: 1 } });
  }));

  it("call requests need the secret and a configured voice provider", withSecret({ NOTIFY_INTERNAL_SECRET: secret }, async () => {
    const body = { idempotencyKey: "call:lead-1:1", mode: "human_assisted", to: LEAD_PHONE, scriptId: "human_bridge", record: true, handoffNumber: "+13105550123" };
    const vh = makeVoiceHarness({ preApproved: ["voice:human_bridge@1"] });
    vh.grant({ phone: LEAD_PHONE });
    expect((await handleCallRequest(req("/c", body), { voice: vh.voice })).status).toBe(401);
    expect((await handleCallRequest(req("/c", body, `Bearer ${secret}`), { voice: null })).status).toBe(503);
    expect((await handleCallRequest(req("/c", { ...body, mode: "robot" }, `Bearer ${secret}`), { voice: vh.voice })).status).toBe(400);
    expect((await handleCallRequest(req("/c", { ...body, extra: 1 }, `Bearer ${secret}`), { voice: vh.voice })).status).toBe(400);
    const res = await handleCallRequest(req("/c", body, `Bearer ${secret}`), { voice: vh.voice });
    expect(await res.json()).toMatchObject({ ok: true, status: "dialing" });
    expect(vh.client.types()).toEqual(["dial"]);
  }));
});

describe("workflow bodies", () => {
  it("speed-to-lead runs in memoized steps and sends once on replay", async () => {
    const { h, hot } = world();
    const step = new FakeStep();
    const d = { sender: h.sender, store: h.store, sources: h.sources, now: h.now };
    const first = await speedToLeadWorkflow({ data: { leadId: hot.id }, step }, d);
    expect(first).toMatchObject({ handled: true, sent: "sms", withinSla: true });
    const replay = await speedToLeadWorkflow({ data: { leadId: hot.id }, step }, d);
    expect(replay).toEqual(first);
    expect(h.sms.sent).toHaveLength(1);
    expect(step.executed).toEqual(["load-lead", "speed-to-lead"]);
  });

  it("returns lead_not_found without sending", async () => {
    const { h } = world();
    const r = await speedToLeadWorkflow({ data: { leadId: "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a98" }, step: new FakeStep() }, { sender: h.sender, store: h.store, sources: h.sources, now: h.now });
    expect(r.skipped).toBe("lead_not_found");
    expect(h.sms.sent).toHaveLength(0);
  });

  it("rejects a malformed event", async () => {
    const { h } = world();
    await expect(speedToLeadWorkflow({ data: { leadId: "x" }, step: new FakeStep() }, { sender: h.sender, store: h.store, sources: h.sources })).rejects.toThrow();
  });

  it("the sweep workflow returns counts only", async () => {
    const { deps } = world();
    const r = await outreachSweepWorkflow({ step: new FakeStep() }, deps());
    expect(r.speedToLead.sent).toBe(1);
    expect(JSON.stringify(r)).not.toContain(LEAD_PHONE);
    expect(Object.values(OUTREACH_EVENTS).every((n) => n.startsWith("corin/"))).toBe(true);
  });

  it("logs and survives a failing sweep phase", async () => {
    const { h, deps } = world();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.sources.activeDeals = async () => {
      throw new Error("boom");
    };
    const s = await runOutreachSweep(deps());
    expect(s.documents.deals).toBe(0);
    expect(s.vendors.sent).toBe(1);
    spy.mockRestore();
  });
});
