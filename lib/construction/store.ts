// Persistence contract for the construction desk plus an in-memory
// implementation for tests and for local development without Supabase.
// The Supabase implementation is in store-supabase.ts (server only).

import type {
  ConstructionConversion,
  ConstructionEvent,
  ConstructionProject,
  ConstructionReport,
  ConstructionTakeout,
  ContractorLicenseCheck,
  LeaseUpSnapshot,
  NewConstructionProject,
  ReportStatus,
  TakeoutStatus,
} from "./types";

export class DuplicateRecordError extends Error {
  constructor(what: string) {
    super(`${what} already exists`);
    this.name = "DuplicateRecordError";
  }
}

export class ConcurrentUpdateError extends Error {
  constructor(what: string) {
    super(`${what} was modified concurrently`);
    this.name = "ConcurrentUpdateError";
  }
}

export type NewReport = Pick<ConstructionReport, "projectId" | "reportType"> & Partial<Omit<ConstructionReport, "id" | "createdAt" | "updatedAt" | "projectId" | "reportType">>;
export type ReportPatch = Partial<Omit<ConstructionReport, "id" | "createdAt" | "updatedAt" | "projectId" | "reportType">>;
export type NewLicenseCheck = Omit<ContractorLicenseCheck, "id" | "createdAt">;
export type ConversionPatch = Partial<Omit<ConstructionConversion, "id" | "createdAt" | "updatedAt" | "projectId">>;
export type NewTakeout = Pick<ConstructionTakeout, "conversionId" | "reasons" | "suggestedPrograms" | "triggeredAt">;
export type TakeoutPatch = Partial<Pick<ConstructionTakeout, "status" | "reasons" | "suggestedPrograms" | "newDealId" | "triggeredAt" | "resolvedAt" | "resolvedBy">>;
export type NewSnapshot = Omit<LeaseUpSnapshot, "id" | "createdAt">;

export interface ConstructionStore {
  insertProject(input: NewConstructionProject, now: Date): Promise<ConstructionProject>;
  getProject(id: string): Promise<ConstructionProject | null>;
  listProjects(): Promise<ConstructionProject[]>;
  updateProject(id: string, patch: Partial<Omit<ConstructionProject, "id" | "createdAt" | "updatedAt">>, now: Date): Promise<ConstructionProject>;

  /** Throws DuplicateRecordError when a non-cancelled report of the same type exists for the project. */
  insertReport(input: NewReport, now: Date): Promise<ConstructionReport>;
  getReport(id: string): Promise<ConstructionReport | null>;
  listReports(projectId: string): Promise<ConstructionReport[]>;
  /** Applies only while the report is still in `expectedStatus`; otherwise throws ConcurrentUpdateError. */
  updateReport(id: string, expectedStatus: ReportStatus, patch: ReportPatch, now: Date): Promise<ConstructionReport>;

  insertLicenseCheck(input: NewLicenseCheck, now: Date): Promise<ContractorLicenseCheck>;
  /** Newest first. */
  listLicenseChecks(projectId: string): Promise<ContractorLicenseCheck[]>;

  getConversion(projectId: string): Promise<ConstructionConversion | null>;
  /** Creates the conversion row for a project, or merges `patch` into it. */
  upsertConversion(projectId: string, patch: ConversionPatch, now: Date): Promise<ConstructionConversion>;
  /** One snapshot per conversion and date; a second write for the same date replaces it. */
  upsertSnapshot(input: NewSnapshot, now: Date): Promise<LeaseUpSnapshot>;
  listSnapshots(conversionId: string): Promise<LeaseUpSnapshot[]>;

  getTakeout(conversionId: string): Promise<ConstructionTakeout | null>;
  /** Throws DuplicateRecordError when the conversion already has a take-out row. */
  insertTakeout(input: NewTakeout, now: Date): Promise<ConstructionTakeout>;
  updateTakeout(id: string, expectedStatus: TakeoutStatus, patch: TakeoutPatch, now: Date): Promise<ConstructionTakeout>;

  appendEvent(event: ConstructionEvent): Promise<void>;
  /** Oldest first. */
  listEvents(projectId: string): Promise<ConstructionEvent[]>;
}

export class MemoryConstructionStore implements ConstructionStore {
  private seq = 0;
  private readonly projects = new Map<string, ConstructionProject>();
  private readonly reports = new Map<string, ConstructionReport>();
  private readonly checks: ContractorLicenseCheck[] = [];
  private readonly conversions = new Map<string, ConstructionConversion>();
  private readonly snapshots = new Map<string, LeaseUpSnapshot>();
  private readonly takeouts = new Map<string, ConstructionTakeout>();
  private readonly events: ConstructionEvent[] = [];

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${String(this.seq).padStart(4, "0")}`;
  }

  async insertProject(input: NewConstructionProject, now: Date): Promise<ConstructionProject> {
    const iso = now.toISOString();
    const project: ConstructionProject = { ...input, phase: input.phase ?? "pre_closing", id: this.id("prj"), createdAt: iso, updatedAt: iso };
    this.projects.set(project.id, project);
    return { ...project };
  }

  async getProject(id: string) {
    const p = this.projects.get(id);
    return p ? { ...p } : null;
  }

  async listProjects() {
    return [...this.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((p) => ({ ...p }));
  }

  async updateProject(id: string, patch: Partial<ConstructionProject>, now: Date) {
    const p = this.projects.get(id);
    if (!p) throw new Error(`Project ${id} not found`);
    const next = { ...p, ...stripUndefined(patch), id: p.id, createdAt: p.createdAt, updatedAt: now.toISOString() };
    this.projects.set(id, next);
    return { ...next };
  }

  async insertReport(input: NewReport, now: Date) {
    for (const r of this.reports.values()) {
      if (r.projectId === input.projectId && r.reportType === input.reportType && r.status !== "cancelled") throw new DuplicateRecordError(`Report ${input.reportType}`);
    }
    const iso = now.toISOString();
    const report: ConstructionReport = {
      status: "not_ordered",
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
      ...stripUndefined(input),
      id: this.id("rpt"),
      createdAt: iso,
      updatedAt: iso,
    };
    this.reports.set(report.id, report);
    return { ...report };
  }

  async getReport(id: string) {
    const r = this.reports.get(id);
    return r ? { ...r } : null;
  }

  async listReports(projectId: string) {
    return [...this.reports.values()].filter((r) => r.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((r) => ({ ...r }));
  }

  async updateReport(id: string, expectedStatus: ReportStatus, patch: Partial<ConstructionReport>, now: Date) {
    const r = this.reports.get(id);
    if (!r) throw new Error(`Report ${id} not found`);
    if (r.status !== expectedStatus) throw new ConcurrentUpdateError(`Report ${id}`);
    const next = { ...r, ...stripUndefined(patch), id: r.id, projectId: r.projectId, reportType: r.reportType, createdAt: r.createdAt, updatedAt: now.toISOString() };
    this.reports.set(id, next);
    return { ...next };
  }

  async insertLicenseCheck(input: NewLicenseCheck, now: Date) {
    const check: ContractorLicenseCheck = { ...input, id: this.id("lic"), createdAt: now.toISOString() };
    this.checks.push(check);
    return { ...check };
  }

  async listLicenseChecks(projectId: string) {
    return this.checks.filter((c) => c.projectId === projectId).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt) || b.id.localeCompare(a.id)).map((c) => ({ ...c }));
  }

  async getConversion(projectId: string) {
    const c = this.conversions.get(projectId);
    return c ? { ...c } : null;
  }

  async upsertConversion(projectId: string, patch: ConversionPatch, now: Date) {
    const iso = now.toISOString();
    const existing = this.conversions.get(projectId);
    const base: ConstructionConversion = existing ?? {
      id: this.id("cnv"),
      createdAt: iso,
      updatedAt: iso,
      projectId,
      coDate: null,
      unitsTotal: null,
      loanMaturityDate: null,
      extensionDeadline: null,
      takeoutPath: "refinance",
      hudCostCertStatus: "not_applicable",
      hudCostCertSubmittedAt: null,
      hudCostCertApprovedAt: null,
      payoffStatus: "not_scheduled",
      payoffTargetDate: null,
      payoffConfirmedAt: null,
      notes: null,
    };
    const next = { ...base, ...stripUndefined(patch), updatedAt: iso };
    this.conversions.set(projectId, next);
    return { ...next };
  }

  async upsertSnapshot(input: NewSnapshot, now: Date) {
    const key = `${input.conversionId}|${input.asOf}`;
    const existing = this.snapshots.get(key);
    const snap: LeaseUpSnapshot = { ...input, id: existing?.id ?? this.id("snp"), createdAt: existing?.createdAt ?? now.toISOString() };
    this.snapshots.set(key, snap);
    return { ...snap };
  }

  async listSnapshots(conversionId: string) {
    return [...this.snapshots.values()].filter((s) => s.conversionId === conversionId).sort((a, b) => a.asOf.localeCompare(b.asOf)).map((s) => ({ ...s }));
  }

  async getTakeout(conversionId: string) {
    const t = this.takeouts.get(conversionId);
    return t ? { ...t } : null;
  }

  async insertTakeout(input: NewTakeout, now: Date) {
    if (this.takeouts.has(input.conversionId)) throw new DuplicateRecordError("Take-out");
    const iso = now.toISOString();
    const t: ConstructionTakeout = { ...input, id: this.id("tko"), status: "triggered", newDealId: null, resolvedAt: null, resolvedBy: null, createdAt: iso, updatedAt: iso };
    this.takeouts.set(input.conversionId, t);
    return { ...t };
  }

  async updateTakeout(id: string, expectedStatus: TakeoutStatus, patch: TakeoutPatch, now: Date) {
    const entry = [...this.takeouts.entries()].find(([, t]) => t.id === id);
    if (!entry) throw new Error(`Take-out ${id} not found`);
    const [key, t] = entry;
    if (t.status !== expectedStatus) throw new ConcurrentUpdateError(`Take-out ${id}`);
    const next = { ...t, ...stripUndefined(patch), updatedAt: now.toISOString() };
    this.takeouts.set(key, next);
    return { ...next };
  }

  async appendEvent(event: ConstructionEvent) {
    this.events.push({ ...event });
  }

  async listEvents(projectId: string) {
    return this.events.filter((e) => e.projectId === projectId).map((e) => ({ ...e }));
  }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
