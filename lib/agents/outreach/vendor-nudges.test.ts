import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import type { ConstructionReport } from "@/lib/construction/types";
import type { VendorOrderContext } from "./sources";
import { nudgeAnchor, nudgeVendor } from "./vendor-nudges";
import { DAY, DAYTIME, makeHarness } from "./testing";

const report = (over: Partial<ConstructionReport> = {}): ConstructionReport => ({
  id: "rpt-1",
  createdAt: new Date(DAYTIME.getTime() - 20 * DAY).toISOString(),
  updatedAt: new Date(DAYTIME.getTime() - 20 * DAY).toISOString(),
  projectId: "prj-1",
  reportType: "phase_i",
  status: "in_progress",
  vendorName: "Pacific Environmental",
  vendorEmail: "orders@pacific-env.example",
  vendorReference: "PE-1042",
  orderedAt: new Date(DAYTIME.getTime() - 20 * DAY).toISOString(),
  dueAt: new Date(DAYTIME.getTime() + 2 * DAY).toISOString(),
  deliveredAt: null,
  acceptedAt: null,
  documentId: null,
  approvalId: null,
  orderAttempt: 0,
  notes: null,
  ...over,
});

const order = (r: ConstructionReport = report()): VendorOrderContext => ({
  project: { id: "prj-1", name: "Sample Gardens", dealId: "deal-1", leadId: null, propertyAddress: "1 Sample St", city: "Fresno", state: "CA", phase: "pre_closing" },
  report: r,
});

const PRE = ["vendor_nudge_email@1"];

describe("vendor order nudges", () => {
  it("starts three days before the due date", async () => {
    const h = makeHarness({ preApproved: PRE });
    const deps = { sender: h.sender, store: h.store, escalation: h.escalation, now: h.now };
    expect(await nudgeVendor(order(report({ dueAt: new Date(DAYTIME.getTime() + 5 * DAY).toISOString() })), deps)).toMatchObject({ action: "none", reason: "not_due" });
    const r = await nudgeVendor(order(), deps);
    expect(r.action).toBe("sent");
    expect(h.email.sent).toHaveLength(1);
    const mail = h.email.sent[0];
    expect(mail?.to).toBe("orders@pacific-env.example");
    expect(mail?.subject).toContain("Phase I environmental");
    expect(mail?.subject).toContain("PE-1042");
    expect(mail?.text).toContain("Sample Gardens, Fresno CA");
    expect(mail?.text).toContain("on track");
  });

  it("says so when the report is overdue", async () => {
    const h = makeHarness({ preApproved: PRE });
    await nudgeVendor(order(report({ dueAt: new Date(DAYTIME.getTime() - 1 * DAY).toISOString() })), { sender: h.sender, store: h.store, now: h.now });
    expect(h.email.sent[0]?.text).toContain("It was due");
  });

  it("with no due date, waits five days after the order", () => {
    const o = order(report({ dueAt: null }));
    expect(nudgeAnchor(o).getTime()).toBe(Date.parse(o.report.orderedAt as string) + 5 * DAY);
  });

  it.each(["delivered", "accepted", "cancelled", "not_ordered", "order_pending_approval", "order_blocked"] as const)("does not nudge a report that is %s", async (status) => {
    const h = makeHarness({ preApproved: PRE });
    const r = await nudgeVendor(order(report({ status })), { sender: h.sender, store: h.store, now: h.now });
    expect(r.action).toBe("done");
    expect(h.email.sent).toHaveLength(0);
  });

  it("goes through the approval gate and sends nothing until a broker approves", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    const deps = { sender: h.sender, store: h.store, now: h.now };
    await nudgeVendor(order(), deps);
    expect(h.email.sent).toHaveLength(0);
    expect(gate.requests[0]).toMatchObject({ kind: "email", templateId: "vendor_nudge_email@1" });
    gate.decide("outreach:vendornudge:rpt-1:r1:email", { status: "approved", approvalId: "appr_1", decidedBy: "b", decidedAt: DAYTIME });
    expect((await nudgeVendor(order(), deps)).action).toBe("resumed");
    expect(h.email.sent).toHaveLength(1);
  });

  it("repeats every two days, three times at most, then asks a person to step in", async () => {
    const h = makeHarness({ preApproved: PRE });
    const deps = { sender: h.sender, store: h.store, escalation: h.escalation, now: h.now };
    for (let i = 0; i < 3; i++) {
      await nudgeVendor(order(), deps);
      h.clock.now = new Date(h.clock.now.getTime() + 2 * DAY + 1000);
    }
    expect(h.email.sent).toHaveLength(3);
    expect((await nudgeVendor(order(), deps)).action).toBe("capped");
    await nudgeVendor(order(), deps);
    expect(h.email.sent).toHaveLength(3);
    expect(h.escalation.items.filter((e) => e.kind === "vendor_unresponsive")).toHaveLength(1);
  });

  it("raises one alert when the order has no vendor email", async () => {
    const h = makeHarness({ preApproved: PRE });
    const deps = { sender: h.sender, store: h.store, escalation: h.escalation, now: h.now };
    expect((await nudgeVendor(order(report({ vendorEmail: null })), deps)).action).toBe("no_contact");
    await nudgeVendor(order(report({ vendorEmail: null })), deps);
    expect(h.escalation.items).toHaveLength(1);
    expect(h.email.sent).toHaveLength(0);
  });

  it("stops once the report is delivered and releases nothing still waiting", async () => {
    const gate = new FakeApprovalGate("pending");
    const h = makeHarness({ gate });
    const deps = { sender: h.sender, store: h.store, now: h.now };
    await nudgeVendor(order(), deps);
    await nudgeVendor(order(report({ status: "delivered" })), deps);
    expect(h.store.rows[0]?.status).toBe("expired");
    expect(h.email.sent).toHaveLength(0);
  });
});
