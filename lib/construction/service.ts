// Construction desk operations: projects, third-party report orders (through
// the broker approval gate), contractor license checks, lease-up tracking and
// the take-out trigger. Pre-closing and post-construction only; Kubera has no
// draw role and moves no money.

import { z } from "zod";
import { isApproved, type ApprovalDecision } from "@/lib/compliance/approval-gate";
import { civilDateOf } from "@/lib/disclosures/business-days";
import { isCheckStale, evaluateLicense, normalizeLicenseNumber, LicenseLookupError } from "./cslb";
import {
  buildTakeoutDeal,
  computeLeaseUpMetrics,
  defaultHudCostCertStatus,
  defaultTakeoutPath,
  evaluateTakeout,
  type LeaseUpMetrics,
  type TakeoutEvaluation,
} from "./conversion";
import { ConstructionError, type ConstructionDeps } from "./deps";
import { canTransition, dueDateFor, isOverdue, MANUAL_STATUSES, reportReadiness, requiredReports, type ReportReadiness } from "./reports";
import { conversionSchema, projectInputSchema, reportUpdateSchema, snapshotSchema, vendorSchema, type ConversionInput, type ProjectInput, type ReportUpdateInput, type SnapshotInput, type VendorInput } from "./schemas";
import { ConcurrentUpdateError, DuplicateRecordError } from "./store";
import {
  REPORT_LABELS,
  type ConstructionConversion,
  type ConstructionEvent,
  type ConstructionProject,
  type ConstructionReport,
  type ConstructionTakeout,
  type ContractorLicenseCheck,
  type LeaseUpSnapshot,
  type ProjectPhase,
  type ReportStatus,
} from "./types";

// Helpers --------------------------------------------------------------------------

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const res = schema.safeParse(input);
  if (!res.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of res.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    throw new ConstructionError("validation", Object.values(fieldErrors)[0] ?? "Invalid input", fieldErrors);
  }
  return res.data;
}

async function record(deps: ConstructionDeps, projectId: string, actor: string, eventType: string, detail: Record<string, unknown> = {}): Promise<void> {
  const event: ConstructionEvent = { projectId, occurredAt: deps.now().toISOString(), eventType, actor, detail };
  await deps.store.appendEvent(event);
}

async function requireProject(deps: ConstructionDeps, id: string): Promise<ConstructionProject> {
  const p = await deps.store.getProject(id);
  if (!p) throw new ConstructionError("not_found", "Project not found");
  return p;
}

async function requireReport(deps: ConstructionDeps, id: string): Promise<ConstructionReport> {
  const r = await deps.store.getReport(id);
  if (!r) throw new ConstructionError("not_found", "Report not found");
  return r;
}

async function guarded<T>(what: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof ConcurrentUpdateError) throw new ConstructionError("conflict", `${what} changed while you were working; reload and try again`);
    if (err instanceof DuplicateRecordError) throw new ConstructionError("conflict", err.message);
    throw err;
  }
}

// Projects ----------------------------------------------------------------------------

export async function createProject(deps: ConstructionDeps, actor: string, input: unknown): Promise<ConstructionProject> {
  const data: ProjectInput = parse(projectInputSchema, input);
  const now = deps.now();
  const project = await deps.store.insertProject({ ...data }, now);
  await deps.store.upsertConversion(
    project.id,
    { takeoutPath: defaultTakeoutPath(project.program), hudCostCertStatus: defaultHudCostCertStatus(project.program), unitsTotal: project.units },
    now,
  );
  await record(deps, project.id, actor, "project_created", { program: project.program });
  await syncRequiredReports(deps, actor, project.id);
  return (await deps.store.getProject(project.id)) ?? project;
}

export async function setProjectPhase(deps: ConstructionDeps, actor: string, projectId: string, phase: ProjectPhase): Promise<ConstructionProject> {
  const project = await requireProject(deps, projectId);
  if (project.phase === phase) return project;
  const updated = await deps.store.updateProject(projectId, { phase }, deps.now());
  await record(deps, projectId, actor, "phase_changed", { from: project.phase, to: phase });
  return updated;
}

// Reports -----------------------------------------------------------------------------

/** Make sure every report the project needs has a tracker row. Idempotent. */
export async function syncRequiredReports(deps: ConstructionDeps, actor: string, projectId: string): Promise<ConstructionReport[]> {
  const project = await requireProject(deps, projectId);
  const existing = await deps.store.listReports(projectId);
  const created: ConstructionReport[] = [];
  for (const req of requiredReports(project)) {
    if (existing.some((r) => r.reportType === req.type && r.status !== "cancelled")) continue;
    try {
      created.push(await deps.store.insertReport({ projectId, reportType: req.type, notes: req.reason }, deps.now()));
    } catch (err) {
      if (!(err instanceof DuplicateRecordError)) throw err;
    }
  }
  if (created.length > 0) await record(deps, projectId, actor, "reports_added", { types: created.map((r) => r.reportType) });
  return created;
}

/** Add a report type that the default matrix does not require. */
export async function addReport(deps: ConstructionDeps, actor: string, projectId: string, reportType: ConstructionReport["reportType"]): Promise<ConstructionReport> {
  await requireProject(deps, projectId);
  const report = await guarded("Report", () => deps.store.insertReport({ projectId, reportType }, deps.now()));
  await record(deps, projectId, actor, "report_added", { type: reportType });
  return report;
}

function outboundKey(report: ConstructionReport): string {
  return `construction:report-order:${report.id}:${report.orderAttempt}`;
}

async function applyOrderDecision(deps: ConstructionDeps, actor: string, report: ConstructionReport, decision: ApprovalDecision): Promise<ConstructionReport> {
  const now = deps.now();
  const approvalId = "approvalId" in decision && decision.approvalId ? decision.approvalId : report.approvalId;
  if (isApproved(decision)) {
    const updated = await guarded("Report", () =>
      deps.store.updateReport(report.id, "order_pending_approval", { status: "ordered", approvalId, orderedAt: now.toISOString(), dueAt: dueDateFor(report.reportType, now) }, now),
    );
    await record(deps, report.projectId, actor, "report_order_approved", { type: report.reportType, approvalId, decidedBy: decision.decidedBy });
    return updated;
  }
  if (decision.status === "rejected" || decision.status === "expired") {
    const updated = await guarded("Report", () => deps.store.updateReport(report.id, "order_pending_approval", { status: "order_blocked", approvalId }, now));
    await record(deps, report.projectId, actor, `report_order_${decision.status}`, { type: report.reportType, approvalId });
    return updated;
  }
  // Still pending: remember the approval id and wait. Nothing was sent.
  if (approvalId && approvalId !== report.approvalId) {
    return guarded("Report", () => deps.store.updateReport(report.id, "order_pending_approval", { approvalId }, now));
  }
  return report;
}

/**
 * Ask the broker approval gate to order a report from a vendor. The report
 * becomes `ordered` only after an approval; a pending, rejected or expired
 * request never marks it ordered (Global rule 2).
 */
export async function requestReportOrder(deps: ConstructionDeps, actor: string, reportId: string, vendorInput: unknown): Promise<ConstructionReport> {
  const vendor: VendorInput = parse(vendorSchema, vendorInput);
  const report = await requireReport(deps, reportId);
  if (report.status !== "not_ordered" && report.status !== "order_blocked") {
    throw new ConstructionError("conflict", `A report that is ${report.status.replaceAll("_", " ")} cannot be ordered`);
  }
  const project = await requireProject(deps, report.projectId);
  const now = deps.now();
  const pending = await guarded("Report", () =>
    deps.store.updateReport(
      report.id,
      report.status,
      {
        status: "order_pending_approval",
        vendorName: vendor.vendorName,
        vendorEmail: vendor.vendorEmail,
        vendorReference: vendor.vendorReference,
        orderAttempt: report.status === "order_blocked" ? report.orderAttempt + 1 : report.orderAttempt,
        approvalId: null,
      },
      now,
    ),
  );
  await record(deps, project.id, actor, "report_order_requested", { type: report.reportType, vendor: vendor.vendorName, attempt: pending.orderAttempt });
  const decision = await deps.gate.request({
    kind: "email",
    idempotencyKey: outboundKey(pending),
    summary: `Order ${REPORT_LABELS[report.reportType]} from ${vendor.vendorName} for ${project.name}`,
    payload: { projectId: project.id, reportId: report.id, reportType: report.reportType, vendorName: vendor.vendorName, vendorEmail: vendor.vendorEmail },
    requestedBy: actor,
  });
  return applyOrderDecision(deps, actor, pending, decision);
}

/** Re-check the approval for an order that was waiting on a broker. Safe to call repeatedly. */
export async function reconcileReportOrder(deps: ConstructionDeps, actor: string, reportId: string): Promise<ConstructionReport> {
  const report = await requireReport(deps, reportId);
  if (report.status !== "order_pending_approval") return report;
  const project = await requireProject(deps, report.projectId);
  const decision = await deps.gate.request({
    kind: "email",
    idempotencyKey: outboundKey(report),
    summary: `Order ${REPORT_LABELS[report.reportType]} from ${report.vendorName ?? "vendor"} for ${project.name}`,
    payload: { projectId: project.id, reportId: report.id, reportType: report.reportType, vendorName: report.vendorName, vendorEmail: report.vendorEmail },
    requestedBy: actor,
  });
  return applyOrderDecision(deps, actor, report, decision);
}

/** Move a report through the statuses staff set by hand (after the order was approved). */
export async function setReportStatus(deps: ConstructionDeps, actor: string, reportId: string, to: ReportStatus, updateInput: unknown = {}): Promise<ConstructionReport> {
  const update: ReportUpdateInput = parse(reportUpdateSchema, updateInput);
  const report = await requireReport(deps, reportId);
  if (!MANUAL_STATUSES.includes(to)) throw new ConstructionError("forbidden", "Orders move to ordered only through broker approval");
  if (!canTransition(report.status, to)) {
    throw new ConstructionError("conflict", `A report that is ${report.status.replaceAll("_", " ")} cannot become ${to.replaceAll("_", " ")}`);
  }
  const now = deps.now();
  const patch: Partial<ConstructionReport> = {};
  if (update.vendorReference) patch.vendorReference = update.vendorReference;
  if (update.documentId) patch.documentId = update.documentId;
  if (update.notes) patch.notes = update.notes;
  patch.status = to;
  if (to === "delivered") patch.deliveredAt = now.toISOString();
  if (to === "accepted") {
    patch.acceptedAt = now.toISOString();
    if (!report.deliveredAt) patch.deliveredAt = now.toISOString();
  }
  const updated = await guarded("Report", () => deps.store.updateReport(report.id, report.status, patch, now));
  await record(deps, report.projectId, actor, "report_status_changed", { type: report.reportType, from: report.status, to });
  return updated;
}

// Contractor license ---------------------------------------------------------------------

export async function runLicenseCheck(deps: ConstructionDeps, actor: string, projectId: string, licenseNumberInput?: string | null): Promise<ContractorLicenseCheck> {
  const project = await requireProject(deps, projectId);
  const number = normalizeLicenseNumber(licenseNumberInput ?? project.generalContractorLicense ?? "");
  if (!number) throw new ConstructionError("validation", "Enter the contractor's CSLB license number (1 to 8 digits)", { licenseNumber: "CSLB license numbers are 1 to 8 digits" });
  const now = deps.now();

  let status: ContractorLicenseCheck["status"];
  let issues: ContractorLicenseCheck["issues"] = [];
  let snapshot: ContractorLicenseCheck["snapshot"] = null;
  if (!deps.licenses.available) {
    status = "lookup_unavailable";
  } else {
    try {
      snapshot = await deps.licenses.lookup(number);
      if (!snapshot) status = "not_found";
      else {
        issues = evaluateLicense(snapshot, now);
        status = issues.length === 0 ? "clear" : "issues";
      }
    } catch (err) {
      if (!(err instanceof LicenseLookupError)) throw err;
      status = "lookup_unavailable";
    }
  }

  const check = await deps.store.insertLicenseCheck(
    { projectId, licenseNumber: number, contractorName: snapshot?.businessName ?? project.generalContractorName, status, issues, snapshot, checkedAt: now.toISOString(), checkedBy: actor },
    now,
  );
  if (project.generalContractorLicense !== number) await deps.store.updateProject(projectId, { generalContractorLicense: number }, now);
  await record(deps, projectId, actor, "license_checked", { licenseNumber: number, status, issues });
  return check;
}

export type LicenseReadiness = "verified" | "issues" | "stale" | "not_checked" | "unverifiable";

export function licenseReadiness(latest: ContractorLicenseCheck | undefined, now: Date): LicenseReadiness {
  if (!latest) return "not_checked";
  if (latest.status === "lookup_unavailable" || latest.status === "not_found") return "unverifiable";
  if (latest.status === "issues") return "issues";
  return isCheckStale(latest.checkedAt, now) ? "stale" : "verified";
}

// Conversion and lease-up ------------------------------------------------------------------

async function requireConversion(deps: ConstructionDeps, projectId: string): Promise<ConstructionConversion> {
  const existing = await deps.store.getConversion(projectId);
  if (existing) return existing;
  const project = await requireProject(deps, projectId);
  return deps.store.upsertConversion(
    projectId,
    { takeoutPath: defaultTakeoutPath(project.program), hudCostCertStatus: defaultHudCostCertStatus(project.program), unitsTotal: project.units },
    deps.now(),
  );
}

const HUD_CERT_ORDER = ["not_started", "in_preparation", "submitted", "under_review", "approved"] as const;

export async function updateConversion(deps: ConstructionDeps, actor: string, projectId: string, input: unknown): Promise<ConstructionConversion> {
  const data: ConversionInput = parse(conversionSchema, input);
  const project = await requireProject(deps, projectId);
  const current = await requireConversion(deps, projectId);
  const now = deps.now();
  const patch: Partial<ConstructionConversion> = {
    coDate: data.coDate,
    unitsTotal: data.unitsTotal,
    loanMaturityDate: data.loanMaturityDate,
    extensionDeadline: data.extensionDeadline,
    payoffTargetDate: data.payoffTargetDate,
    notes: data.notes,
  };

  const path = data.takeoutPath ?? current.takeoutPath;
  patch.takeoutPath = path;
  let cert = data.hudCostCertStatus ?? current.hudCostCertStatus;
  if (path === "refinance") cert = "not_applicable";
  else if (cert === "not_applicable") cert = "not_started";
  if (path === "hud_conversion" && cert !== current.hudCostCertStatus) {
    const from = HUD_CERT_ORDER.indexOf(current.hudCostCertStatus as (typeof HUD_CERT_ORDER)[number]);
    const to = HUD_CERT_ORDER.indexOf(cert as (typeof HUD_CERT_ORDER)[number]);
    if (from >= 0 && to >= 0 && to < from) throw new ConstructionError("conflict", "HUD cost certification moves forward only", { hudCostCertStatus: "Cannot move backward" });
  }
  patch.hudCostCertStatus = cert;
  const today = civilDateOf(now);
  if (cert === "submitted" && !current.hudCostCertSubmittedAt) patch.hudCostCertSubmittedAt = today;
  if (cert === "approved" && !current.hudCostCertApprovedAt) patch.hudCostCertApprovedAt = today;

  const payoff = data.payoffStatus ?? current.payoffStatus;
  patch.payoffStatus = payoff;
  if (payoff === "payoff_confirmed" && !current.payoffConfirmedAt) patch.payoffConfirmedAt = today;

  const updated = await deps.store.upsertConversion(projectId, patch, now);
  await record(deps, projectId, actor, "conversion_updated", { coDate: updated.coDate, takeoutPath: updated.takeoutPath, hudCostCertStatus: updated.hudCostCertStatus, payoffStatus: updated.payoffStatus });

  if (payoff === "payoff_confirmed" && project.phase !== "closed_out") await setProjectPhase(deps, actor, projectId, "closed_out");
  else if (updated.coDate && project.phase === "under_construction") await setProjectPhase(deps, actor, projectId, "conversion");
  return updated;
}

export async function addLeaseUpSnapshot(deps: ConstructionDeps, actor: string, projectId: string, input: unknown): Promise<LeaseUpSnapshot> {
  const data: SnapshotInput = parse(snapshotSchema, input);
  const project = await requireProject(deps, projectId);
  const conversion = await requireConversion(deps, projectId);
  const total = conversion.unitsTotal ?? project.units;
  if (!total) throw new ConstructionError("validation", "Set the total unit count before recording lease-up", { unitsTotal: "Total units required" });
  if (data.unitsOccupied > data.unitsLeased) throw new ConstructionError("validation", "Occupied units cannot exceed leased units", { unitsOccupied: "Cannot exceed leased units" });
  if (data.unitsLeased > total) throw new ConstructionError("validation", `Leased units cannot exceed the ${total} total units`, { unitsLeased: `Cannot exceed ${total}` });
  if (Number.isNaN(Date.parse(`${data.asOf}T00:00:00Z`))) throw new ConstructionError("validation", "Not a real date", { asOf: "Not a real date" });
  if (data.asOf > civilDateOf(deps.now())) throw new ConstructionError("validation", "The as-of date cannot be in the future", { asOf: "Cannot be in the future" });

  const snap = await deps.store.upsertSnapshot({ conversionId: conversion.id, ...data }, deps.now());
  await record(deps, projectId, actor, "leaseup_recorded", { asOf: data.asOf, unitsLeased: data.unitsLeased, unitsOccupied: data.unitsOccupied });
  await evaluateProjectTakeout(deps, actor, projectId);
  return snap;
}

// Take-out ---------------------------------------------------------------------------------------

export type ConversionView = {
  conversion: ConstructionConversion;
  snapshots: LeaseUpSnapshot[];
  metrics: LeaseUpMetrics;
  evaluation: TakeoutEvaluation;
  takeout: ConstructionTakeout | null;
};

export async function getConversionView(deps: ConstructionDeps, project: ConstructionProject): Promise<ConversionView> {
  const conversion = await requireConversion(deps, project.id);
  const snapshots = await deps.store.listSnapshots(conversion.id);
  const metrics = computeLeaseUpMetrics(snapshots, conversion.unitsTotal ?? project.units ?? 0, deps.now());
  const evaluation = evaluateTakeout({ project, conversion, metrics, now: deps.now() });
  const takeout = await deps.store.getTakeout(conversion.id);
  return { conversion, snapshots, metrics, evaluation, takeout };
}

/**
 * Evaluate the take-out trigger and record it. Only records the trigger; it
 * never opens a deal or contacts a lender. Idempotent: one take-out row per
 * conversion.
 */
export async function evaluateProjectTakeout(deps: ConstructionDeps, actor: string, projectId: string, options: { manual?: boolean } = {}): Promise<ConversionView> {
  const project = await requireProject(deps, projectId);
  let view = await getConversionView(deps, project);
  const evaluation = view.evaluation;
  const manualOk = options.manual && evaluation.applicable && project.phase !== "pre_closing";
  const reasons = manualOk && !evaluation.reasons.includes("manual") ? [...evaluation.reasons, "manual" as const] : evaluation.reasons;
  if (!evaluation.triggered && !manualOk) return view;

  const now = deps.now();
  let takeout = view.takeout;
  if (!takeout) {
    try {
      takeout = await deps.store.insertTakeout({ conversionId: view.conversion.id, reasons, suggestedPrograms: evaluation.suggestedPrograms, triggeredAt: now.toISOString() }, now);
      await record(deps, projectId, actor, "takeout_triggered", { reasons });
    } catch (err) {
      if (!(err instanceof DuplicateRecordError)) throw err;
      takeout = await deps.store.getTakeout(view.conversion.id);
    }
  } else if (takeout.status === "triggered" && takeout.reasons.join() !== reasons.join()) {
    takeout = await guarded("Take-out", () => deps.store.updateTakeout(takeout!.id, "triggered", { reasons, suggestedPrograms: evaluation.suggestedPrograms }, now));
  } else if (takeout.status === "dismissed" && options.manual) {
    takeout = await guarded("Take-out", () => deps.store.updateTakeout(takeout!.id, "dismissed", { status: "triggered", reasons, resolvedAt: null, resolvedBy: null }, now));
    await record(deps, projectId, actor, "takeout_reopened", { reasons });
  }
  view = { ...view, takeout };
  return view;
}

export async function dismissTakeout(deps: ConstructionDeps, actor: string, projectId: string): Promise<ConstructionTakeout> {
  const project = await requireProject(deps, projectId);
  const conversion = await requireConversion(deps, project.id);
  const takeout = await deps.store.getTakeout(conversion.id);
  if (!takeout || takeout.status !== "triggered") throw new ConstructionError("conflict", "There is no open take-out trigger to dismiss");
  const now = deps.now();
  const updated = await guarded("Take-out", () => deps.store.updateTakeout(takeout.id, "triggered", { status: "dismissed", resolvedAt: now.toISOString(), resolvedBy: actor }, now));
  await record(deps, projectId, actor, "takeout_dismissed", {});
  return updated;
}

/** Open the refinance deal for a triggered take-out (staff action; idempotent). */
export async function createTakeoutDeal(deps: ConstructionDeps, actor: string, projectId: string): Promise<ConstructionTakeout> {
  const project = await requireProject(deps, projectId);
  const view = await getConversionView(deps, project);
  const takeout = view.takeout;
  if (!takeout) throw new ConstructionError("conflict", "No take-out trigger has been recorded for this project");
  if (takeout.status === "deal_created") return takeout;
  if (takeout.status !== "triggered") throw new ConstructionError("conflict", "This take-out was dismissed; reopen it first");
  if (!deps.deals) throw new ConstructionError("unavailable", "The deals module is not connected yet, so the refinance deal cannot be opened automatically");

  const request = buildTakeoutDeal({
    project,
    takeoutId: takeout.id,
    suggestedPrograms: takeout.suggestedPrograms,
    reasons: takeout.reasons,
    metrics: view.metrics,
    latestSnapshot: view.snapshots.at(-1),
  });
  const { dealId } = await deps.deals.createDeal(request);
  const now = deps.now();
  const updated = await guarded("Take-out", () =>
    deps.store.updateTakeout(takeout.id, "triggered", { status: "deal_created", newDealId: dealId, resolvedAt: now.toISOString(), resolvedBy: actor }, now),
  );
  if (project.phase !== "closed_out") await setProjectPhase(deps, actor, projectId, "taken_out");
  await record(deps, projectId, actor, "takeout_deal_created", { dealId });
  return updated;
}

/** Cron or workflow entry point: evaluate every refinance-path project and record triggers. Opens no deals. */
export async function sweepTakeoutTriggers(deps: ConstructionDeps, actor: string): Promise<{ checked: number; triggered: string[] }> {
  const projects = await deps.store.listProjects();
  const triggered: string[] = [];
  let checked = 0;
  for (const p of projects) {
    if (p.phase === "pre_closing" || p.phase === "taken_out" || p.phase === "closed_out") continue;
    checked += 1;
    const before = await deps.store.getConversion(p.id).then((c) => (c ? deps.store.getTakeout(c.id) : null));
    const view = await evaluateProjectTakeout(deps, actor, p.id);
    if (view.takeout && !before) triggered.push(p.id);
  }
  return { checked, triggered };
}

// Read models -----------------------------------------------------------------------------------------

export type ProjectOverview = {
  project: ConstructionProject;
  reports: ConstructionReport[];
  readiness: ReportReadiness;
  licenseChecks: ContractorLicenseCheck[];
  license: LicenseReadiness;
  conversion: ConversionView;
  events: ConstructionEvent[];
};

export async function getProjectOverview(deps: ConstructionDeps, projectId: string): Promise<ProjectOverview | null> {
  const project = await deps.store.getProject(projectId);
  if (!project) return null;
  const now = deps.now();
  const [reports, licenseChecks, conversion, events] = await Promise.all([
    deps.store.listReports(projectId),
    deps.store.listLicenseChecks(projectId),
    getConversionView(deps, project),
    deps.store.listEvents(projectId),
  ]);
  return {
    project,
    reports,
    readiness: reportReadiness(project, reports, now),
    licenseChecks,
    license: licenseReadiness(licenseChecks[0], now),
    conversion,
    events,
  };
}

export type ProjectSummary = {
  project: ConstructionProject;
  reportsRequired: number;
  reportsAccepted: number;
  reportsOverdue: number;
  license: LicenseReadiness;
  occupancyPct: number | null;
  takeoutStatus: ConstructionTakeout["status"] | null;
  takeoutTriggered: boolean;
};

export async function listProjectSummaries(deps: ConstructionDeps): Promise<ProjectSummary[]> {
  const now = deps.now();
  const projects = await deps.store.listProjects();
  return Promise.all(
    projects.map(async (project) => {
      const [reports, checks, conversion] = await Promise.all([deps.store.listReports(project.id), deps.store.listLicenseChecks(project.id), getConversionView(deps, project)]);
      const readiness = reportReadiness(project, reports, now);
      return {
        project,
        reportsRequired: readiness.required.length,
        reportsAccepted: readiness.required.filter((q) => reports.some((r) => r.reportType === q.type && r.status === "accepted")).length,
        reportsOverdue: reports.filter((r) => isOverdue(r, now)).length,
        license: licenseReadiness(checks[0], now),
        occupancyPct: conversion.metrics.asOf ? conversion.metrics.occupancyPct : null,
        takeoutStatus: conversion.takeout?.status ?? null,
        takeoutTriggered: conversion.evaluation.triggered || conversion.takeout?.status === "triggered",
      };
    }),
  );
}
