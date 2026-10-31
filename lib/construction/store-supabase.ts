import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fromRow, normalizeTimestamps, numberOrNull, toRow } from "./rows";
import {
  ConcurrentUpdateError,
  DuplicateRecordError,
  type ConstructionStore,
  type ConversionPatch,
  type NewLicenseCheck,
  type NewReport,
  type NewSnapshot,
  type NewTakeout,
  type ReportPatch,
  type TakeoutPatch,
} from "./store";
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

// Supabase-backed construction store (service role; RLS denies anon and
// authenticated roles on these tables). Column names follow the WS-AA migration.

type Row = Record<string, unknown>;

const UNIQUE_VIOLATION = "23505";

function fail(action: string, error: { message: string; code?: string }): never {
  throw new Error(`construction store: ${action} failed: ${error.message}`);
}

const project = (row: Row) => normalizeTimestamps(fromRow<ConstructionProject>(row));
const report = (row: Row) => normalizeTimestamps(fromRow<ConstructionReport>(row));
const takeout = (row: Row) => normalizeTimestamps(fromRow<ConstructionTakeout>(row));
const conversion = (row: Row) => normalizeTimestamps(fromRow<ConstructionConversion>(row));
const check = (row: Row) => normalizeTimestamps(fromRow<ContractorLicenseCheck>(row));
const snapshot = (row: Row): LeaseUpSnapshot => {
  const s = normalizeTimestamps(fromRow<LeaseUpSnapshot>(row));
  return { ...s, avgMonthlyRent: numberOrNull(s.avgMonthlyRent), noiT3Annualized: numberOrNull(s.noiT3Annualized) };
};

export class SupabaseConstructionStore implements ConstructionStore {
  constructor(private readonly db: SupabaseClient) {}

  async insertProject(input: NewConstructionProject): Promise<ConstructionProject> {
    const { data, error } = await this.db.from("construction_projects").insert(toRow(input)).select().single();
    if (error) fail("insert project", error);
    return project(data);
  }

  async getProject(id: string) {
    const { data, error } = await this.db.from("construction_projects").select().eq("id", id).maybeSingle();
    if (error) fail("get project", error);
    return data ? project(data) : null;
  }

  async listProjects() {
    const { data, error } = await this.db.from("construction_projects").select().order("created_at", { ascending: false }).limit(500);
    if (error) fail("list projects", error);
    return (data ?? []).map(project);
  }

  async updateProject(id: string, patch: Partial<ConstructionProject>) {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = patch;
    const { data, error } = await this.db.from("construction_projects").update(toRow(rest)).eq("id", id).select().single();
    if (error) fail("update project", error);
    return project(data);
  }

  async insertReport(input: NewReport) {
    const { data, error } = await this.db.from("construction_reports").insert(toRow(input)).select().single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new DuplicateRecordError(`Report ${input.reportType}`);
      fail("insert report", error);
    }
    return report(data);
  }

  async getReport(id: string) {
    const { data, error } = await this.db.from("construction_reports").select().eq("id", id).maybeSingle();
    if (error) fail("get report", error);
    return data ? report(data) : null;
  }

  async listReports(projectId: string) {
    const { data, error } = await this.db.from("construction_reports").select().eq("project_id", projectId).order("created_at").order("id");
    if (error) fail("list reports", error);
    return (data ?? []).map(report);
  }

  async updateReport(id: string, expectedStatus: ReportStatus, patch: ReportPatch) {
    const { data, error } = await this.db.from("construction_reports").update(toRow(patch)).eq("id", id).eq("status", expectedStatus).select();
    if (error) fail("update report", error);
    if (!data || data.length === 0) throw new ConcurrentUpdateError(`Report ${id}`);
    return report(data[0]);
  }

  async insertLicenseCheck(input: NewLicenseCheck) {
    const { data, error } = await this.db.from("construction_contractor_checks").insert(toRow(input)).select().single();
    if (error) fail("insert license check", error);
    return check(data);
  }

  async listLicenseChecks(projectId: string) {
    const { data, error } = await this.db.from("construction_contractor_checks").select().eq("project_id", projectId).order("checked_at", { ascending: false });
    if (error) fail("list license checks", error);
    return (data ?? []).map(check);
  }

  async getConversion(projectId: string) {
    const { data, error } = await this.db.from("construction_conversions").select().eq("project_id", projectId).maybeSingle();
    if (error) fail("get conversion", error);
    return data ? conversion(data) : null;
  }

  async upsertConversion(projectId: string, patch: ConversionPatch): Promise<ConstructionConversion> {
    const existing = await this.getConversion(projectId);
    if (existing) {
      const { data, error } = await this.db.from("construction_conversions").update(toRow(patch)).eq("id", existing.id).select().single();
      if (error) fail("update conversion", error);
      return conversion(data);
    }
    const { data, error } = await this.db.from("construction_conversions").insert({ project_id: projectId, ...toRow(patch) }).select().single();
    if (error) {
      // A concurrent request created the row first; merge into it.
      if (error.code === UNIQUE_VIOLATION) return this.upsertConversion(projectId, patch);
      fail("insert conversion", error);
    }
    return conversion(data);
  }

  async upsertSnapshot(input: NewSnapshot) {
    const { data, error } = await this.db.from("construction_leaseup_snapshots").upsert(toRow(input), { onConflict: "conversion_id,as_of" }).select().single();
    if (error) fail("upsert lease-up snapshot", error);
    return snapshot(data);
  }

  async listSnapshots(conversionId: string) {
    const { data, error } = await this.db.from("construction_leaseup_snapshots").select().eq("conversion_id", conversionId).order("as_of");
    if (error) fail("list lease-up snapshots", error);
    return (data ?? []).map(snapshot);
  }

  async getTakeout(conversionId: string) {
    const { data, error } = await this.db.from("construction_takeouts").select().eq("conversion_id", conversionId).maybeSingle();
    if (error) fail("get take-out", error);
    return data ? takeout(data) : null;
  }

  async insertTakeout(input: NewTakeout) {
    const { data, error } = await this.db.from("construction_takeouts").insert(toRow(input)).select().single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new DuplicateRecordError("Take-out");
      fail("insert take-out", error);
    }
    return takeout(data);
  }

  async updateTakeout(id: string, expectedStatus: TakeoutStatus, patch: TakeoutPatch) {
    const { data, error } = await this.db.from("construction_takeouts").update(toRow(patch)).eq("id", id).eq("status", expectedStatus).select();
    if (error) fail("update take-out", error);
    if (!data || data.length === 0) throw new ConcurrentUpdateError(`Take-out ${id}`);
    return takeout(data[0]);
  }

  async appendEvent(event: ConstructionEvent) {
    const { error } = await this.db.from("construction_events").insert(toRow(event));
    if (error) fail("append event", error);
  }

  async listEvents(projectId: string) {
    const { data, error } = await this.db.from("construction_events").select().eq("project_id", projectId).order("id");
    if (error) fail("list events", error);
    return (data ?? []).map((row) => normalizeTimestamps(fromRow<ConstructionEvent>(row)));
  }
}

/** Supabase store when the service role is configured, otherwise null. */
export function createSupabaseConstructionStore(): SupabaseConstructionStore | null {
  const db = supabaseAdmin();
  return db ? new SupabaseConstructionStore(db) : null;
}
