// Third-party report tracker rules: which reports a project needs, the
// allowed status transitions, vendor turnaround dates and a pre-closing
// readiness summary. Pure functions; persistence and the approval gate live in
// service.ts.
//
// Which reports each program asks for varies by lender, so the matrix below is
// a staff checklist default, not a lender requirement. VERIFY against each
// lender's term sheet; staff can add or cancel reports per project.

import { addBusinessDays, civilDateOf, type CivilDate } from "@/lib/disclosures/business-days";
import type { ConstructionProgram, ConstructionProject, ConstructionReport, ReportStatus, ReportType } from "./types";
import { REPORT_LABELS, REPORT_STATUS_LABELS, REPORT_TYPES } from "./types";

export type ReportRequirement = { type: ReportType; reason: string };

const NEW_CONSTRUCTION_PROGRAMS: ReadonlySet<ConstructionProgram> = new Set([
  "HUD_221D4",
  "HUD_232_NEW_CONSTRUCTION",
  "BANK_CONSTRUCTION",
  "DEBT_FUND_CONSTRUCTION",
  "PRIVATE_CONSTRUCTION",
]);

const EXISTING_BUILDING_PROGRAMS: ReadonlySet<ConstructionProgram> = new Set(["HUD_223F", "HUD_232_223F", "AGENCY_MULTIFAMILY", "HOTEL_PIP_BRIDGE", "BRIDGE"]);

const VALUATION_CHECK_PROGRAMS: ReadonlySet<ConstructionProgram> = new Set(["BRIDGE", "PRIVATE_CONSTRUCTION"]);

type RequirementFacts = Pick<ConstructionProject, "program" | "newConstruction" | "seismicZone" | "state">;

/** Reports a project should carry before closing, with the reason for each. */
export function requiredReports(project: RequirementFacts): ReportRequirement[] {
  const out: ReportRequirement[] = [{ type: "phase_i", reason: "Environmental screening on every financing" }];
  const groundUp = project.newConstruction || NEW_CONSTRUCTION_PROGRAMS.has(project.program);
  if (groundUp) {
    out.push({ type: "plan_and_cost_review", reason: "Independent review of plans, budget and schedule before closing" });
    out.push({ type: "builders_risk", reason: "Builder's risk coverage evidenced before closing" });
  }
  if (!groundUp && EXISTING_BUILDING_PROGRAMS.has(project.program)) {
    out.push({ type: "pcna", reason: "Existing building: property condition and capital needs" });
  }
  if (project.seismicZone || project.state?.toUpperCase() === "CA") {
    out.push({ type: "seismic_pml", reason: "Seismic hazard area: probable maximum loss" });
  }
  if (VALUATION_CHECK_PROGRAMS.has(project.program)) {
    out.push({ type: "bpo", reason: "Quick value check for the lender" });
  }
  // Stable display order.
  return out.sort((a, b) => REPORT_TYPES.indexOf(a.type) - REPORT_TYPES.indexOf(b.type));
}

// Status machine ------------------------------------------------------------------

const TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  not_ordered: ["order_pending_approval", "cancelled"],
  order_pending_approval: ["ordered", "order_blocked", "cancelled"],
  order_blocked: ["order_pending_approval", "cancelled"],
  ordered: ["in_progress", "delivered", "cancelled"],
  in_progress: ["delivered", "cancelled"],
  delivered: ["accepted", "revision_requested"],
  revision_requested: ["in_progress", "delivered", "cancelled"],
  accepted: [],
  cancelled: [],
};

export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: ReportStatus): readonly ReportStatus[] {
  return TRANSITIONS[from];
}

/**
 * Statuses staff set by hand after the order is approved. The approval-gated
 * moves (`order_pending_approval`, `ordered`, `order_blocked`) are made only by
 * the order flow, so a report can never be marked ordered without a broker
 * approval.
 */
export const MANUAL_STATUSES: readonly ReportStatus[] = ["in_progress", "delivered", "accepted", "revision_requested", "cancelled"];

// Turnaround ------------------------------------------------------------------------

/** Typical vendor turnaround in business days. VERIFY with the vendors Corin uses. */
export const TURNAROUND_BUSINESS_DAYS: Record<ReportType, number> = {
  seismic_pml: 10,
  plan_and_cost_review: 15,
  bpo: 5,
  builders_risk: 10,
  pcna: 15,
  phase_i: 15,
};

export function dueDateFor(type: ReportType, orderedAt: Date): string {
  const due: CivilDate = addBusinessDays(civilDateOf(orderedAt), TURNAROUND_BUSINESS_DAYS[type]);
  return due;
}

const ACTIVE: ReadonlySet<ReportStatus> = new Set(["ordered", "in_progress", "revision_requested"]);

export function isOverdue(report: Pick<ConstructionReport, "status" | "dueAt">, now: Date): boolean {
  if (!report.dueAt || !ACTIVE.has(report.status)) return false;
  return report.dueAt < civilDateOf(now);
}

// Readiness ---------------------------------------------------------------------------

export type ReportReadiness = {
  required: ReportRequirement[];
  /** Required types with no report row (or only cancelled ones). */
  missing: ReportType[];
  outstanding: ConstructionReport[];
  overdue: ConstructionReport[];
  /** Required reports not yet accepted, as readable blockers. */
  blockers: string[];
  ready: boolean;
};

export function reportReadiness(project: RequirementFacts, reports: readonly ConstructionReport[], now: Date): ReportReadiness {
  const required = requiredReports(project);
  const live = reports.filter((r) => r.status !== "cancelled");
  const missing = required.filter((q) => !live.some((r) => r.reportType === q.type)).map((q) => q.type);
  const outstanding = live.filter((r) => r.status !== "accepted");
  const overdue = live.filter((r) => isOverdue(r, now));
  const blockers: string[] = [];
  for (const q of required) {
    const r = live.find((x) => x.reportType === q.type);
    if (!r) blockers.push(`${REPORT_LABELS[q.type]}: not started`);
    else if (r.status !== "accepted") blockers.push(`${REPORT_LABELS[q.type]}: ${REPORT_STATUS_LABELS[r.status].toLowerCase()}`);
  }
  return { required, missing, outstanding, overdue, blockers, ready: blockers.length === 0 };
}
