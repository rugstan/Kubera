// Persistence for the deal submission profile, the sponsor profile and the
// locked summaries (types.ts SubmissionStore), plus an in-memory store for
// tests and the fake-auth demo desks that keeps the database's guarantees:
// one profile and one sponsor row per deal, optimistic concurrency on
// record_version (ConcurrentUpdateError), the column checks (via schema.ts),
// and immutable summaries unique on (deal, PDF hash).
// The Supabase implementation is store-supabase.ts (server only).

import { randomUUID } from "node:crypto";
import { ConcurrentUpdateError, GuardError } from "../store";
import { submissionProfileFieldsSchema, sponsorProfileFieldsSchema } from "./schema";
import {
  blankSponsorProfileFields,
  blankSubmissionProfileFields,
  isTargetStage,
  isSubmissionPlaybook,
  type DealSummaryRecord,
  type FieldSources,
  type SponsorProfile,
  type SponsorProfileFields,
  type SponsorProfilePatch,
  type SubmissionProfile,
  type SubmissionProfileFields,
  type SubmissionProfilePatch,
  type SubmissionStore,
} from "./types";

export { ConcurrentUpdateError, GuardError };

const clone = <T>(v: T): T => structuredClone(v);

/** Applies SubmissionProfilePatch's merge rules: programDetails per section, fieldSources per key (null removes it), every other key replaced. */
export function mergeProfilePatch(cur: SubmissionProfileFields, patch: SubmissionProfilePatch): SubmissionProfileFields {
  const { programDetails, fieldSources, ...rest } = patch;
  const next: SubmissionProfileFields = { ...cur };
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (next as Record<string, unknown>)[k] = clone(v);
  if (programDetails) {
    next.programDetails = { ...cur.programDetails };
    for (const [k, v] of Object.entries(programDetails)) if (v !== undefined) (next.programDetails as Record<string, unknown>)[k] = clone(v);
  }
  if (fieldSources) {
    const merged: Record<string, unknown> = { ...cur.fieldSources };
    for (const [k, v] of Object.entries(fieldSources)) {
      if (v === null) delete merged[k];
      else if (v !== undefined) merged[k] = clone(v);
    }
    next.fieldSources = merged as FieldSources;
  }
  return next;
}

export function mergeSponsorPatch(cur: SponsorProfileFields, patch: SponsorProfilePatch): SponsorProfileFields {
  const next: SponsorProfileFields = { ...cur };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (next as Record<string, unknown>)[k] = clone(v);
  return next;
}

/** The keys a profile patch changes on the row (programDetails and fieldSources count once each). */
export function patchedProfileKeys(patch: SubmissionProfilePatch): (keyof SubmissionProfileFields)[] {
  return Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k as keyof SubmissionProfileFields);
}

function firstIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const i = error.issues[0];
  return i ? `${i.path.map(String).join(".") || "row"}: ${i.message}` : "invalid";
}

/** The row checks the database applies (and the stricter schema checks). Throws GuardError. */
export function assertProfileFields(fields: SubmissionProfileFields): SubmissionProfileFields {
  const r = submissionProfileFieldsSchema.safeParse(fields);
  if (!r.success) throw new GuardError(`Submission profile: ${firstIssue(r.error)}`);
  return r.data;
}

export function assertSponsorFields(fields: SponsorProfileFields): SponsorProfileFields {
  const r = sponsorProfileFieldsSchema.safeParse(fields);
  // Only the path is named: sponsor values are personal and never go into an error message.
  if (!r.success) throw new GuardError(`Sponsor profile: ${r.error.issues[0]?.path.map(String).join(".") || "row"} is not valid`);
  return r.data;
}

const SHA256 = /^[0-9a-f]{64}$/;

/** deal_summaries checks (hashes, stage, template version, versions, storage path). */
export function assertSummary(s: Omit<DealSummaryRecord, "id" | "createdAt">): void {
  const bad =
    !SHA256.test(s.specSha256) ? "spec_sha256" :
    !SHA256.test(s.pdfSha256) ? "pdf_sha256" :
    !isTargetStage(s.targetStage) ? "target_stage" :
    !isSubmissionPlaybook(s.playbook) ? "playbook" :
    !(s.templateVersion.length >= 1 && s.templateVersion.length <= 40) ? "template_version" :
    !(s.pdfStoragePath.length >= 1 && s.pdfStoragePath.length <= 500) ? "pdf_storage_path" :
    !(Number.isInteger(s.profileVersion) && s.profileVersion > 0) ? "profile_version" :
    !(s.sponsorVersion === null || (Number.isInteger(s.sponsorVersion) && s.sponsorVersion > 0)) ? "sponsor_version" :
    !(s.createdBy.length >= 1 && s.createdBy.length <= 200) ? "created_by" :
    !/^\d{4}-\d{2}-\d{2}$/.test(s.asOf) ? "as_of" :
    JSON.stringify(s.spec).length > 400_000 ? "spec" :
    null;
  if (bad) throw new GuardError(`Deal summary: ${bad} is not valid`);
}

function assertActor(actor: string): void {
  if (!(actor.length >= 1 && actor.length <= 200)) throw new GuardError("An actor (1 to 200 characters) is required");
}

export type MemorySubmissionStoreOptions = {
  /** The deals the store may hold rows for (the foreign key); omitted = any deal. */
  dealExists?: (dealId: string) => boolean;
};

export class MemorySubmissionStore implements SubmissionStore {
  /** By deal id. */
  readonly profiles = new Map<string, SubmissionProfile>();
  /** By deal id. */
  readonly sponsors = new Map<string, SponsorProfile>();
  /** By summary id. */
  readonly summaries = new Map<string, DealSummaryRecord>();

  constructor(private readonly opts: MemorySubmissionStoreOptions = {}) {}

  private assertDeal(dealId: string): void {
    if (this.opts.dealExists && !this.opts.dealExists(dealId)) throw new GuardError(`Deal ${dealId} not found`);
  }

  async getProfile(dealId: string): Promise<SubmissionProfile | null> {
    const p = this.profiles.get(dealId);
    return p ? clone(p) : null;
  }

  async upsertProfile(dealId: string, expectedVersion: number | null, patch: SubmissionProfilePatch, actor: string, now: Date): Promise<SubmissionProfile> {
    assertActor(actor);
    const ts = now.toISOString();
    const cur = this.profiles.get(dealId);
    if (expectedVersion === null) {
      if (cur) throw new ConcurrentUpdateError("Submission profile");
      if (!patch.playbook) throw new GuardError("A new submission profile needs a playbook");
      this.assertDeal(dealId);
      const fields = assertProfileFields(mergeProfilePatch(blankSubmissionProfileFields(patch.playbook), patch));
      const row: SubmissionProfile = { id: randomUUID(), dealId, createdAt: ts, createdBy: actor, updatedAt: ts, updatedBy: actor, recordVersion: 1, ...fields };
      this.profiles.set(dealId, row);
      return clone(row);
    }
    if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError("Submission profile");
    const { id, dealId: _d, createdAt, createdBy, updatedAt: _u, updatedBy: _ub, recordVersion, ...curFields } = cur;
    void _d;
    void _u;
    void _ub;
    const fields = assertProfileFields(mergeProfilePatch(curFields, patch));
    const row: SubmissionProfile = { id, dealId, createdAt, createdBy, updatedAt: ts, updatedBy: actor, recordVersion: recordVersion + 1, ...fields };
    this.profiles.set(dealId, row);
    return clone(row);
  }

  async getSponsor(dealId: string): Promise<SponsorProfile | null> {
    const s = this.sponsors.get(dealId);
    return s ? clone(s) : null;
  }

  async upsertSponsor(dealId: string, expectedVersion: number | null, patch: SponsorProfilePatch, actor: string, now: Date): Promise<SponsorProfile> {
    assertActor(actor);
    const ts = now.toISOString();
    const cur = this.sponsors.get(dealId);
    if (expectedVersion === null) {
      if (cur) throw new ConcurrentUpdateError("Sponsor profile");
      this.assertDeal(dealId);
      const fields = assertSponsorFields(mergeSponsorPatch(blankSponsorProfileFields(), patch));
      const row: SponsorProfile = { id: randomUUID(), dealId, createdAt: ts, createdBy: actor, updatedAt: ts, updatedBy: actor, recordVersion: 1, ...fields };
      this.sponsors.set(dealId, row);
      return clone(row);
    }
    if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError("Sponsor profile");
    const { id, dealId: _d, createdAt, createdBy, updatedAt: _u, updatedBy: _ub, recordVersion, ...curFields } = cur;
    void _d;
    void _u;
    void _ub;
    const fields = assertSponsorFields(mergeSponsorPatch(curFields, patch));
    const row: SponsorProfile = { id, dealId, createdAt, createdBy, updatedAt: ts, updatedBy: actor, recordVersion: recordVersion + 1, ...fields };
    this.sponsors.set(dealId, row);
    return clone(row);
  }

  async insertSummary(s: Omit<DealSummaryRecord, "id" | "createdAt">, now: Date): Promise<DealSummaryRecord> {
    const existing = [...this.summaries.values()].find((x) => x.dealId === s.dealId && x.pdfSha256 === s.pdfSha256);
    if (existing) return clone(existing);
    assertSummary(s);
    this.assertDeal(s.dealId);
    const row: DealSummaryRecord = { ...clone(s), id: randomUUID(), createdAt: now.toISOString() };
    this.summaries.set(row.id, row);
    return clone(row);
  }

  async getSummary(id: string): Promise<DealSummaryRecord | null> {
    const s = this.summaries.get(id);
    return s ? clone(s) : null;
  }

  async getSummaryByPdfSha(dealId: string, pdfSha256: string): Promise<DealSummaryRecord | null> {
    const s = [...this.summaries.values()].find((x) => x.dealId === dealId && x.pdfSha256 === pdfSha256);
    return s ? clone(s) : null;
  }
}
