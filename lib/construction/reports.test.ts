import { describe, expect, it } from "vitest";
import { canTransition, dueDateFor, isOverdue, MANUAL_STATUSES, reportReadiness, requiredReports } from "./reports";
import { REPORT_STATUSES, type ConstructionReport, type ReportStatus, type ReportType } from "./types";

const facts = (over: Partial<Parameters<typeof requiredReports>[0]> = {}) => ({ program: "BANK_CONSTRUCTION" as const, newConstruction: true, seismicZone: false, state: "TX", ...over });
const types = (over?: Partial<Parameters<typeof requiredReports>[0]>) => requiredReports(facts(over)).map((r) => r.type);

describe("requiredReports", () => {
  it("asks for plan-and-cost review, builder's risk and Phase I on ground-up construction", () => {
    expect(types()).toEqual(["plan_and_cost_review", "builders_risk", "phase_i"]);
  });

  it("asks for a PCNA instead on an existing building refinance", () => {
    expect(types({ program: "HUD_223F", newConstruction: false })).toEqual(["pcna", "phase_i"]);
    expect(types({ program: "AGENCY_MULTIFAMILY", newConstruction: false })).toContain("pcna");
  });

  it("adds a seismic PML for flagged sites and for California", () => {
    expect(types({ seismicZone: true })).toContain("seismic_pml");
    expect(types({ state: "ca" })).toContain("seismic_pml");
    expect(types({ state: "TX" })).not.toContain("seismic_pml");
  });

  it("adds a BPO for bridge and private construction", () => {
    expect(types({ program: "BRIDGE", newConstruction: false })).toContain("bpo");
    expect(types({ program: "PRIVATE_CONSTRUCTION" })).toContain("bpo");
    expect(types({ program: "BANK_CONSTRUCTION" })).not.toContain("bpo");
  });

  it("treats HUD new construction as ground-up even if the flag is off", () => {
    expect(types({ program: "HUD_221D4", newConstruction: false })).toContain("plan_and_cost_review");
  });

  it("returns a stable order", () => {
    const all = types({ program: "PRIVATE_CONSTRUCTION", seismicZone: true });
    expect(all).toEqual(["seismic_pml", "plan_and_cost_review", "bpo", "builders_risk", "phase_i"]);
  });
});

describe("report status machine", () => {
  it("does not let a report reach ordered or ordered-adjacent states by hand", () => {
    expect(MANUAL_STATUSES).not.toContain("ordered");
    expect(MANUAL_STATUSES).not.toContain("order_pending_approval");
    expect(MANUAL_STATUSES).not.toContain("order_blocked");
  });

  it("requires an approval path from not_ordered to ordered", () => {
    expect(canTransition("not_ordered", "ordered")).toBe(false);
    expect(canTransition("not_ordered", "delivered")).toBe(false);
    expect(canTransition("not_ordered", "order_pending_approval")).toBe(true);
    expect(canTransition("order_pending_approval", "ordered")).toBe(true);
  });

  it("allows retry after a blocked order and revision after delivery", () => {
    expect(canTransition("order_blocked", "order_pending_approval")).toBe(true);
    expect(canTransition("delivered", "revision_requested")).toBe(true);
    expect(canTransition("revision_requested", "delivered")).toBe(true);
  });

  it("treats accepted and cancelled as terminal", () => {
    for (const to of REPORT_STATUSES) {
      expect(canTransition("accepted", to)).toBe(false);
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });
});

describe("turnaround", () => {
  it("counts business days from the order date", () => {
    // Ordered Wednesday 2026-11-04; a BPO is five business days, skipping Veterans Day (Wed 11-11).
    expect(dueDateFor("bpo", new Date("2026-11-04T18:00:00Z"))).toBe("2026-11-12");
  });

  it("flags only active reports past their due date", () => {
    const now = new Date("2026-11-20T18:00:00Z");
    expect(isOverdue({ status: "ordered", dueAt: "2026-11-12" }, now)).toBe(true);
    expect(isOverdue({ status: "in_progress", dueAt: "2026-11-20" }, now)).toBe(false);
    expect(isOverdue({ status: "delivered", dueAt: "2026-11-12" }, now)).toBe(false);
    expect(isOverdue({ status: "ordered", dueAt: null }, now)).toBe(false);
  });
});

function report(reportType: ReportType, status: ReportStatus): ConstructionReport {
  return {
    id: `r_${reportType}`,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    projectId: "p1",
    reportType,
    status,
    vendorName: null,
    vendorEmail: null,
    vendorReference: null,
    orderedAt: null,
    dueAt: null,
    deliveredAt: null,
    acceptedAt: null,
    documentId: null,
    approvalId: null,
    orderAttempt: 0,
    notes: null,
  };
}

describe("reportReadiness", () => {
  const now = new Date("2026-11-20T18:00:00Z");

  it("is ready only when every required report is accepted", () => {
    const all = [report("plan_and_cost_review", "accepted"), report("builders_risk", "accepted"), report("phase_i", "accepted")];
    expect(reportReadiness(facts(), all, now)).toMatchObject({ ready: true, blockers: [], missing: [] });
    const r = reportReadiness(facts(), [...all.slice(0, 2), report("phase_i", "delivered")], now);
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(["Phase I environmental: delivered"]);
  });

  it("reports missing and cancelled reports as blockers", () => {
    const r = reportReadiness(facts(), [report("phase_i", "cancelled"), report("builders_risk", "accepted")], now);
    expect(r.missing).toEqual(["plan_and_cost_review", "phase_i"]);
    expect(r.ready).toBe(false);
  });

  it("lists overdue reports", () => {
    const late = { ...report("phase_i", "ordered"), dueAt: "2026-11-10" };
    expect(reportReadiness(facts(), [late], now).overdue).toEqual([late]);
  });
});
