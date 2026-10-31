import { describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { ConstructionError } from "./deps";
import {
  addLeaseUpSnapshot,
  createProject,
  createTakeoutDeal,
  dismissTakeout,
  evaluateProjectTakeout,
  getProjectOverview,
  listProjectSummaries,
  reconcileReportOrder,
  requestReportOrder,
  runLicenseCheck,
  setReportStatus,
  sweepTakeoutTriggers,
  updateConversion,
} from "./service";
import { goodLicense, makeDeps, projectInput } from "./test-fixtures";
import type { ConstructionReport } from "./types";

const vendor = { vendorName: "Terracon", vendorEmail: "orders@terracon.test", vendorReference: "" };

async function setup(deps = makeDeps(), over: Record<string, unknown> = {}) {
  const project = await createProject(deps, "broker@kubera.test", projectInput(over));
  const reports = await deps.store.listReports(project.id);
  const report = (type: ConstructionReport["reportType"]) => reports.find((r) => r.reportType === type)!;
  return { deps, project, report };
}

describe("createProject", () => {
  it("creates the project, a conversion row and the required report rows", async () => {
    const { deps, project } = await setup();
    expect(project).toMatchObject({ phase: "pre_closing", state: "CA", units: 120, seismicZone: true });
    const reports = await deps.store.listReports(project.id);
    expect(reports.map((r) => r.reportType).sort()).toEqual(["builders_risk", "phase_i", "plan_and_cost_review", "seismic_pml"]);
    expect(reports.every((r) => r.status === "not_ordered")).toBe(true);
    expect(await deps.store.getConversion(project.id)).toMatchObject({ takeoutPath: "refinance", unitsTotal: 120 });
    expect((await deps.store.listEvents(project.id)).map((e) => e.eventType)).toEqual(["project_created", "reports_added"]);
  });

  it("starts HUD new construction on the in-place conversion path with a cost certification to track", async () => {
    const { deps, project } = await setup(makeDeps(), { program: "HUD_221D4" });
    expect(await deps.store.getConversion(project.id)).toMatchObject({ takeoutPath: "hud_conversion", hudCostCertStatus: "not_started" });
  });

  it("rejects bad input with field errors", async () => {
    const deps = makeDeps();
    await expect(createProject(deps, "x", projectInput({ name: " ", state: "California", program: "NOPE" }))).rejects.toMatchObject({
      code: "validation",
      fieldErrors: expect.objectContaining({ name: expect.any(String), state: expect.any(String), program: expect.any(String) }),
    });
    expect(await deps.store.listProjects()).toEqual([]);
  });
});

describe("report orders go through the broker approval gate", () => {
  it("marks the report ordered only after approval and sets the vendor due date", async () => {
    const { deps, report } = await setup();
    const updated = await requestReportOrder(deps, "analyst@kubera.test", report("phase_i").id, vendor);
    expect(updated).toMatchObject({ status: "ordered", vendorName: "Terracon", approvalId: "appr_1", orderedAt: "2026-11-04T18:00:00.000Z", dueAt: "2026-11-30" });
    expect(deps.gate.requests).toHaveLength(1);
    expect(deps.gate.requests[0]).toMatchObject({ kind: "email", requestedBy: "analyst@kubera.test" });
    expect(deps.gate.requests[0]!.templateId).toBeUndefined();
  });

  it("stays pending while the broker has not decided, and never orders", async () => {
    const { deps, report } = await setup(makeDeps({ gate: new FakeApprovalGate("pending") }));
    const updated = await requestReportOrder(deps, "a", report("phase_i").id, vendor);
    expect(updated.status).toBe("order_pending_approval");
    expect(updated.orderedAt).toBeNull();
    // Re-checking without a decision changes nothing and does not queue a second approval.
    const again = await reconcileReportOrder(deps, "a", report("phase_i").id);
    expect(again.status).toBe("order_pending_approval");
    expect(new Set(deps.gate.requests.map((r) => r.idempotencyKey)).size).toBe(1);
  });

  it("promotes a pending order when the broker approves it later", async () => {
    const { deps, report } = await setup(makeDeps({ gate: new FakeApprovalGate("pending") }));
    const id = report("phase_i").id;
    await requestReportOrder(deps, "a", id, vendor);
    const key = deps.gate.requests[0]!.idempotencyKey;
    deps.gate.decide(key, { status: "approved", approvalId: "appr_9", decidedBy: "neeli@kubera.test", decidedAt: new Date(0) });
    expect(await reconcileReportOrder(deps, "a", id)).toMatchObject({ status: "ordered", approvalId: "appr_9" });
  });

  it("blocks an expired approval and never sends; a retry gets a fresh approval key", async () => {
    const { deps, report } = await setup(makeDeps({ gate: new FakeApprovalGate("expired") }));
    const id = report("phase_i").id;
    const blocked = await requestReportOrder(deps, "a", id, vendor);
    expect(blocked).toMatchObject({ status: "order_blocked", orderedAt: null, dueAt: null });
    const firstKey = deps.gate.requests[0]!.idempotencyKey;
    deps.gate.decide(`${firstKey.slice(0, -1)}1`, { status: "approved", approvalId: "appr_retry", decidedBy: "b", decidedAt: new Date(0) });
    const retried = await requestReportOrder(deps, "a", id, vendor);
    expect(deps.gate.requests[1]!.idempotencyKey).not.toBe(firstKey);
    expect(retried).toMatchObject({ status: "ordered", orderAttempt: 1 });
  });

  it("blocks a rejected approval", async () => {
    const { deps, report } = await setup(makeDeps({ gate: new FakeApprovalGate("rejected") }));
    expect((await requestReportOrder(deps, "a", report("phase_i").id, vendor)).status).toBe("order_blocked");
  });

  it("does not order twice or order a report that is already moving", async () => {
    const { deps, report } = await setup();
    const id = report("phase_i").id;
    await requestReportOrder(deps, "a", id, vendor);
    await expect(requestReportOrder(deps, "a", id, vendor)).rejects.toMatchObject({ code: "conflict" });
    expect(deps.gate.requests).toHaveLength(1);
  });

  it("requires a vendor name", async () => {
    const { deps, report } = await setup();
    await expect(requestReportOrder(deps, "a", report("phase_i").id, { vendorName: "" })).rejects.toMatchObject({ code: "validation" });
    expect(deps.gate.requests).toHaveLength(0);
  });
});

describe("manual report status", () => {
  it("walks ordered to delivered to accepted and stamps the dates", async () => {
    const { deps, report } = await setup();
    const id = report("phase_i").id;
    await requestReportOrder(deps, "a", id, vendor);
    const inProgress = await setReportStatus(deps, "a", id, "in_progress", { vendorReference: "TC-77" });
    expect(inProgress).toMatchObject({ status: "in_progress", vendorReference: "TC-77" });
    deps.clock.now = new Date("2026-11-20T18:00:00Z");
    const delivered = await setReportStatus(deps, "a", id, "delivered", { documentId: "6f1c1c1e-8f7e-4a53-9a77-5d8d0a1f2b3c" });
    expect(delivered).toMatchObject({ status: "delivered", deliveredAt: "2026-11-20T18:00:00.000Z", documentId: "6f1c1c1e-8f7e-4a53-9a77-5d8d0a1f2b3c" });
    expect(await setReportStatus(deps, "a", id, "accepted")).toMatchObject({ status: "accepted", acceptedAt: "2026-11-20T18:00:00.000Z" });
  });

  it("refuses to mark an unordered report delivered or to skip the approval", async () => {
    const { deps, report } = await setup();
    const id = report("phase_i").id;
    await expect(setReportStatus(deps, "a", id, "delivered")).rejects.toMatchObject({ code: "conflict" });
    await expect(setReportStatus(deps, "a", id, "ordered")).rejects.toMatchObject({ code: "forbidden" });
    expect((await deps.store.getReport(id))!.status).toBe("not_ordered");
  });

  it("lets a new report be added after cancelling one, but not a duplicate", async () => {
    const { deps, report } = await setup();
    const id = report("phase_i").id;
    await setReportStatus(deps, "a", id, "cancelled");
    const { addReport } = await import("./service");
    const project = (await deps.store.listProjects())[0]!;
    expect(await addReport(deps, "a", project.id, "phase_i")).toMatchObject({ status: "not_ordered" });
    await expect(addReport(deps, "a", project.id, "phase_i")).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("runLicenseCheck", () => {
  it("records a clear check and remembers the license on the project", async () => {
    const { deps, project } = await setup();
    deps.licenses.set("1234567", goodLicense());
    const check = await runLicenseCheck(deps, "a", project.id, "CSLB #1234567");
    expect(check).toMatchObject({ status: "clear", issues: [], licenseNumber: "1234567", contractorName: "Pacific Builders Inc", checkedBy: "a" });
    expect((await deps.store.getProject(project.id))!.generalContractorLicense).toBe("1234567");
  });

  it("records the issues found on the license", async () => {
    const { deps, project } = await setup();
    deps.licenses.set("1234567", goodLicense({ status: "SUSPENDED", bondOnFile: false }));
    const check = await runLicenseCheck(deps, "a", project.id, "1234567");
    expect(check.status).toBe("issues");
    expect(check.issues).toEqual(["license_not_active", "no_bond_on_file"]);
  });

  it("records not found, and lookup failures without throwing", async () => {
    const { deps, project } = await setup();
    expect((await runLicenseCheck(deps, "a", project.id, "999")).status).toBe("not_found");
    deps.licenses.set("1234567", "error");
    expect((await runLicenseCheck(deps, "a", project.id, "1234567")).status).toBe("lookup_unavailable");
  });

  it("degrades to lookup_unavailable when the lookup is not configured", async () => {
    const { deps, project } = await setup();
    const check = await runLicenseCheck({ ...deps, licenses: { name: "off", available: false, lookup: async () => null } }, "a", project.id, "1234567");
    expect(check.status).toBe("lookup_unavailable");
  });

  it("needs a license number from the form or the project", async () => {
    const { deps, project } = await setup();
    await expect(runLicenseCheck(deps, "a", project.id, "")).rejects.toMatchObject({ code: "validation" });
    deps.licenses.set("1234567", goodLicense());
    await runLicenseCheck(deps, "a", project.id, "1234567");
    expect((await runLicenseCheck(deps, "a", project.id)).licenseNumber).toBe("1234567");
  });

  it("surfaces the newest check as readiness", async () => {
    const { deps, project } = await setup();
    deps.licenses.set("1234567", goodLicense());
    await runLicenseCheck(deps, "a", project.id, "1234567");
    expect((await getProjectOverview(deps, project.id))!.license).toBe("verified");
    deps.clock.now = new Date("2026-12-31T00:00:00Z");
    expect((await getProjectOverview(deps, project.id))!.license).toBe("stale");
  });
});

describe("conversion and lease-up", () => {
  async function converting(over: Record<string, unknown> = {}) {
    const s = await setup(makeDeps(), over);
    await s.deps.store.updateProject(s.project.id, { phase: "under_construction" }, s.deps.now());
    return s;
  }
  const conv = (over: Record<string, unknown> = {}) => ({ unitsTotal: "120", coDate: "", loanMaturityDate: "", extensionDeadline: "", payoffTargetDate: "", ...over });
  const snapshot = (asOf: string, leased: number, occupied: number) => ({ asOf, unitsLeased: String(leased), unitsOccupied: String(occupied) });

  it("moves the project into conversion when a CO date is recorded", async () => {
    const { deps, project } = await converting();
    await updateConversion(deps, "a", project.id, conv({ coDate: "2026-09-01" }));
    expect((await deps.store.getProject(project.id))!.phase).toBe("conversion");
  });

  it("validates lease-up snapshots", async () => {
    const { deps, project } = await converting();
    await expect(addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-10-01", 10, 20))).rejects.toMatchObject({ fieldErrors: { unitsOccupied: expect.any(String) } });
    await expect(addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-10-01", 200, 10))).rejects.toMatchObject({ fieldErrors: { unitsLeased: expect.any(String) } });
    await expect(addLeaseUpSnapshot(deps, "a", project.id, snapshot("2027-01-01", 10, 5))).rejects.toMatchObject({ fieldErrors: { asOf: expect.any(String) } });
  });

  it("replaces a second snapshot for the same date", async () => {
    const { deps, project } = await converting();
    await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-10-01", 10, 5));
    await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-10-01", 20, 10));
    const conversion = (await deps.store.getConversion(project.id))!;
    expect(await deps.store.listSnapshots(conversion.id)).toHaveLength(1);
  });

  it("triggers the take-out once on stabilized occupancy and does not duplicate it", async () => {
    const { deps, project } = await converting();
    await updateConversion(deps, "a", project.id, conv({ coDate: "2026-05-01" }));
    await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-07-01", 115, 110));
    expect((await deps.store.getTakeout((await deps.store.getConversion(project.id))!.id))).toBeNull();
    await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-10-15", 117, 114));
    const conversion = (await deps.store.getConversion(project.id))!;
    const takeout = (await deps.store.getTakeout(conversion.id))!;
    expect(takeout).toMatchObject({ status: "triggered", reasons: ["stabilized_occupancy"] });
    await evaluateProjectTakeout(deps, "a", project.id);
    await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-10-30", 118, 115));
    expect((await deps.store.getTakeout(conversion.id))!.id).toBe(takeout.id);
    expect((await deps.store.listEvents(project.id)).filter((e) => e.eventType === "takeout_triggered")).toHaveLength(1);
  });

  it("opens the refinance deal on request, once, and moves the project to taken_out", async () => {
    const { deps, project } = await converting({ name: "Harbor View", generalContractorLicense: "" });
    await updateConversion(deps, "a", project.id, conv({ coDate: "2026-05-01", loanMaturityDate: "2027-02-01" }));
    await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-07-01", 115, 110));
    await addLeaseUpSnapshot(deps, "a", project.id, snapshot("2026-10-15", 117, 114));
    const takeout = await createTakeoutDeal(deps, "broker@kubera.test", project.id);
    expect(takeout).toMatchObject({ status: "deal_created", newDealId: expect.any(String), resolvedBy: "broker@kubera.test" });
    expect(deps.deals.created).toHaveLength(1);
    expect(deps.deals.created[0]).toMatchObject({ loanPurpose: "refinance", sourceProjectId: project.id, units: 120, occupancyPct: 95 });
    expect((await deps.store.getProject(project.id))!.phase).toBe("taken_out");
    // A second click returns the same take-out and opens no second deal.
    expect(await createTakeoutDeal(deps, "broker@kubera.test", project.id)).toMatchObject({ newDealId: takeout.newDealId });
    expect(deps.deals.created).toHaveLength(1);
  });

  it("records the trigger but opens no deal when the deals module is not connected", async () => {
    const { deps, project } = await converting();
    await updateConversion(deps, "a", project.id, conv({ coDate: "2026-05-01", loanMaturityDate: "2027-01-15" }));
    await evaluateProjectTakeout(deps, "a", project.id);
    await expect(createTakeoutDeal({ ...deps, deals: null }, "a", project.id)).rejects.toMatchObject({ code: "unavailable" });
    const conversion = (await deps.store.getConversion(project.id))!;
    expect((await deps.store.getTakeout(conversion.id))!.status).toBe("triggered");
  });

  it("can dismiss a trigger and reopen it manually", async () => {
    const { deps, project } = await converting();
    await updateConversion(deps, "a", project.id, conv({ coDate: "2026-05-01", loanMaturityDate: "2027-01-15" }));
    await evaluateProjectTakeout(deps, "a", project.id);
    expect(await dismissTakeout(deps, "a", project.id)).toMatchObject({ status: "dismissed" });
    await expect(createTakeoutDeal(deps, "a", project.id)).rejects.toMatchObject({ code: "conflict" });
    const view = await evaluateProjectTakeout(deps, "a", project.id, { manual: true });
    expect(view.takeout).toMatchObject({ status: "triggered", reasons: expect.arrayContaining(["manual"]) });
  });

  it("never creates a refinance take-out for a HUD loan that converts in place, even manually", async () => {
    const { deps, project } = await converting({ program: "HUD_221D4" });
    await updateConversion(deps, "a", project.id, conv({ coDate: "2026-05-01", takeoutPath: "hud_conversion", hudCostCertStatus: "approved" }));
    const view = await evaluateProjectTakeout(deps, "a", project.id, { manual: true });
    expect(view.takeout).toBeNull();
    expect(view.conversion.hudCostCertApprovedAt).toBe("2026-11-04");
  });

  it("tracks HUD cost certification forward only and clears it for refinance loans", async () => {
    const { deps, project } = await converting({ program: "HUD_221D4" });
    await updateConversion(deps, "a", project.id, conv({ takeoutPath: "hud_conversion", hudCostCertStatus: "submitted" }));
    expect((await deps.store.getConversion(project.id))!.hudCostCertSubmittedAt).toBe("2026-11-04");
    await expect(updateConversion(deps, "a", project.id, conv({ takeoutPath: "hud_conversion", hudCostCertStatus: "in_preparation" }))).rejects.toBeInstanceOf(ConstructionError);
    await updateConversion(deps, "a", project.id, conv({ takeoutPath: "refinance" }));
    expect((await deps.store.getConversion(project.id))!.hudCostCertStatus).toBe("not_applicable");
  });

  it("closes the project out when the lender confirms payoff", async () => {
    const { deps, project } = await converting();
    await updateConversion(deps, "a", project.id, conv({ payoffStatus: "payoff_confirmed" }));
    expect((await deps.store.getProject(project.id))!.phase).toBe("closed_out");
    expect((await deps.store.getConversion(project.id))!.payoffConfirmedAt).toBe("2026-11-04");
  });

  it("sweeps projects and records triggers without opening deals", async () => {
    const { deps, project } = await converting();
    await updateConversion(deps, "a", project.id, conv({ coDate: "2026-05-01", loanMaturityDate: "2027-01-15" }));
    const pre = await createProject(deps, "a", projectInput({ name: "Not closed yet" }));
    const result = await sweepTakeoutTriggers(deps, "system");
    expect(result).toEqual({ checked: 1, triggered: [project.id] });
    expect((await deps.store.getProject(pre.id))!.phase).toBe("pre_closing");
    expect(deps.deals.created).toHaveLength(0);
    expect((await sweepTakeoutTriggers(deps, "system")).triggered).toEqual([]);
  });
});

describe("read models", () => {
  it("summarizes readiness for the desk list", async () => {
    const { deps, project, report } = await setup();
    await requestReportOrder(deps, "a", report("phase_i").id, vendor);
    await setReportStatus(deps, "a", report("phase_i").id, "delivered");
    await setReportStatus(deps, "a", report("phase_i").id, "accepted");
    const [summary] = await listProjectSummaries(deps);
    expect(summary).toMatchObject({ project: { id: project.id }, reportsRequired: 4, reportsAccepted: 1, reportsOverdue: 0, license: "not_checked", occupancyPct: null, takeoutTriggered: false });
    const overview = (await getProjectOverview(deps, project.id))!;
    expect(overview.readiness.ready).toBe(false);
    expect(overview.readiness.blockers).toHaveLength(3);
    expect(await getProjectOverview(deps, "missing")).toBeNull();
  });
});
