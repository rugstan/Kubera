import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROFILE_COLUMNS,
  SPONSOR_COLUMNS,
  SUMMARY_COLUMNS,
  profileFromRow,
  profileToRow,
  sponsorFromRow,
  sponsorToRow,
  summaryFromRow,
  summaryToRow,
  type Row,
} from "./rows";
import { assertProfileFields, assertSponsorFields, assertSummary, ConcurrentUpdateError, GuardError, mergeProfilePatch, mergeSponsorPatch } from "./store";
import {
  blankSponsorProfileFields,
  blankSubmissionProfileFields,
  type DealSummaryRecord,
  type SponsorProfile,
  type SponsorProfilePatch,
  type SubmissionProfile,
  type SubmissionProfilePatch,
  type SubmissionStore,
} from "./types";

// Supabase-backed submission store (service role; RLS denies the API roles on
// these tables). The sponsor profile is personal information: errors name the
// failing constraint only. Postgres puts the failing row in `details`, which
// is never read, logged or shown, and no value is ever put in a message.

type PgError = { message: string; code?: string };

function fail(error: PgError | null, what: string): void {
  if (!error) return;
  const message = error.message ?? "";
  const constraint = /constraint "([a-z0-9_]+)"/.exec(message)?.[1];
  if (error.code === "23505") throw new ConcurrentUpdateError(what);
  if (error.code === "23514") throw new GuardError(`${what}: a value failed the ${constraint ?? "a"} check`);
  if (error.code === "23503") throw new GuardError(`${what}: the deal was not found`);
  if (/immutable/i.test(message)) throw new GuardError(`${what}: rows are immutable`);
  throw new Error(`${what}: ${error.code ?? "database"} error${constraint ? ` (${constraint})` : ""}`);
}

function stripMeta<T extends { id: string; dealId: string; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string | null; recordVersion: number }>(row: T) {
  const { id: _i, dealId: _d, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, recordVersion: _v, ...fields } = row;
  return fields;
}

export class SupabaseSubmissionStore implements SubmissionStore {
  constructor(private readonly db: SupabaseClient) {}

  async getProfile(dealId: string): Promise<SubmissionProfile | null> {
    const { data, error } = await this.db.from("deal_submission_profiles").select(PROFILE_COLUMNS).eq("deal_id", dealId).maybeSingle();
    fail(error, "Read submission profile");
    return data ? profileFromRow(data as unknown as Row) : null;
  }

  async upsertProfile(dealId: string, expectedVersion: number | null, patch: SubmissionProfilePatch, actor: string): Promise<SubmissionProfile> {
    if (expectedVersion === null) {
      if (!patch.playbook) throw new GuardError("A new submission profile needs a playbook");
      const fields = assertProfileFields(mergeProfilePatch(blankSubmissionProfileFields(patch.playbook), patch));
      const { data, error } = await this.db
        .from("deal_submission_profiles")
        .insert({ ...profileToRow(fields), deal_id: dealId, created_by: actor, updated_by: actor })
        .select(PROFILE_COLUMNS)
        .single();
      fail(error, "Submission profile");
      return profileFromRow(data as unknown as Row);
    }
    // Read, merge (programDetails per section, fieldSources per key), and write
    // back only while record_version is still the one the merge was based on.
    const cur = await this.getProfile(dealId);
    if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError("Submission profile");
    const merged = assertProfileFields(mergeProfilePatch(stripMeta(cur), patch));
    const changed = Object.fromEntries(Object.keys(patch).map((k) => [k, (merged as Record<string, unknown>)[k]]));
    const { data, error } = await this.db
      .from("deal_submission_profiles")
      .update({ ...profileToRow(changed), record_version: expectedVersion + 1, updated_by: actor })
      .eq("deal_id", dealId)
      .eq("record_version", expectedVersion)
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    fail(error, "Submission profile");
    if (!data) throw new ConcurrentUpdateError("Submission profile");
    return profileFromRow(data as unknown as Row);
  }

  async getSponsor(dealId: string): Promise<SponsorProfile | null> {
    const { data, error } = await this.db.from("deal_sponsor_profiles").select(SPONSOR_COLUMNS).eq("deal_id", dealId).maybeSingle();
    fail(error, "Read sponsor profile");
    return data ? sponsorFromRow(data as unknown as Row) : null;
  }

  async upsertSponsor(dealId: string, expectedVersion: number | null, patch: SponsorProfilePatch, actor: string): Promise<SponsorProfile> {
    if (expectedVersion === null) {
      const fields = assertSponsorFields(mergeSponsorPatch(blankSponsorProfileFields(), patch));
      const { data, error } = await this.db
        .from("deal_sponsor_profiles")
        .insert({ ...sponsorToRow(fields), deal_id: dealId, created_by: actor, updated_by: actor })
        .select(SPONSOR_COLUMNS)
        .single();
      fail(error, "Sponsor profile");
      return sponsorFromRow(data as unknown as Row);
    }
    const cur = await this.getSponsor(dealId);
    if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError("Sponsor profile");
    const merged = assertSponsorFields(mergeSponsorPatch(stripMeta(cur), patch));
    const changed = Object.fromEntries(Object.keys(patch).map((k) => [k, (merged as Record<string, unknown>)[k]]));
    const { data, error } = await this.db
      .from("deal_sponsor_profiles")
      .update({ ...sponsorToRow(changed), record_version: expectedVersion + 1, updated_by: actor })
      .eq("deal_id", dealId)
      .eq("record_version", expectedVersion)
      .select(SPONSOR_COLUMNS)
      .maybeSingle();
    fail(error, "Sponsor profile");
    if (!data) throw new ConcurrentUpdateError("Sponsor profile");
    return sponsorFromRow(data as unknown as Row);
  }

  async insertSummary(s: Omit<DealSummaryRecord, "id" | "createdAt">): Promise<DealSummaryRecord> {
    const existing = await this.getSummaryByPdfSha(s.dealId, s.pdfSha256);
    if (existing) return existing;
    assertSummary(s);
    const { data, error } = await this.db.from("deal_summaries").insert(summaryToRow(s)).select(SUMMARY_COLUMNS).single();
    if (error?.code === "23505") {
      // Another request locked the same summary first: return its row.
      const raced = await this.getSummaryByPdfSha(s.dealId, s.pdfSha256);
      if (raced) return raced;
    }
    fail(error, "Deal summary");
    return summaryFromRow(data as unknown as Row);
  }

  async getSummary(id: string): Promise<DealSummaryRecord | null> {
    const { data, error } = await this.db.from("deal_summaries").select(SUMMARY_COLUMNS).eq("id", id).maybeSingle();
    fail(error, "Read deal summary");
    return data ? summaryFromRow(data as unknown as Row) : null;
  }

  async getSummaryByPdfSha(dealId: string, pdfSha256: string): Promise<DealSummaryRecord | null> {
    const { data, error } = await this.db.from("deal_summaries").select(SUMMARY_COLUMNS).eq("deal_id", dealId).eq("pdf_sha256", pdfSha256).maybeSingle();
    fail(error, "Read deal summary");
    return data ? summaryFromRow(data as unknown as Row) : null;
  }
}
