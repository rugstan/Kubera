import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ProspectStoreError,
  emptyStatusCounts,
  validateStaffEdit,
  type ProspectFilter,
  type ProspectStore,
  type ScanFinish,
  type ScanStart,
  type UpsertResult,
} from "./prospect-store";
import type { SuppressionKey } from "./suppression";
import type {
  NewProspectOutreach,
  OutreachPatch,
  OutreachReason,
  OutreachStatus,
  Prospect,
  ProspectOutreach,
  ProspectScan,
  ProspectStatus,
  ScannedProspect,
  ScoreFactor,
  StaffProspectEdit,
  Suppression,
  SuppressionKind,
  SuppressionReason,
} from "./types";

// Supabase-backed prospecting store (service role; RLS denies the API roles).

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new ProspectStoreError(`${what}: ${error.message}`);
}

type ProspectRow = {
  id: string;
  created_at: string;
  updated_at: string;
  dedupe_key: string;
  source: Prospect["source"];
  source_ref: string | null;
  scan_id: string | null;
  address_line1: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  property_type: Prospect["propertyType"];
  units: number | null;
  building_sqft: number | null;
  year_built: number | null;
  owner_name: string | null;
  owner_kind: Prospect["ownerKind"];
  mailing_line1: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  contact_name: string | null;
  contact_email: string | null;
  loan_original_cents: number | string | null;
  loan_lender: string | null;
  loan_origination_date: string | null;
  loan_maturity_date: string;
  loan_rate_pct: number | string | null;
  loan_type: string | null;
  last_sale_date: string | null;
  last_sale_price_cents: number | string | null;
  data_as_of: string;
  score: number;
  score_factors: ScoreFactor[];
  recommended_program: Prospect["recommendedProgram"];
  window_bucket: Prospect["windowBucket"];
  status: ProspectStatus;
  assigned_to: string | null;
  notes: string | null;
  last_scanned_at: string;
  updated_by: string | null;
};

const numOrNull = (v: number | string | null): number | null => (v === null || v === undefined ? null : Number(v));

export function prospectFromRow(r: ProspectRow): Prospect {
  const hasMailing = r.mailing_line1 || r.mailing_city || r.mailing_state || r.mailing_zip;
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    dedupeKey: r.dedupe_key,
    source: r.source,
    sourceRef: r.source_ref,
    scanId: r.scan_id,
    addressLine1: r.address_line1,
    city: r.city,
    state: r.state,
    zip: r.zip,
    apn: r.apn,
    propertyType: r.property_type,
    units: r.units,
    buildingSqft: r.building_sqft,
    yearBuilt: r.year_built,
    ownerName: r.owner_name,
    ownerKind: r.owner_kind,
    mailing: hasMailing ? { line1: r.mailing_line1, city: r.mailing_city, state: r.mailing_state, zip: r.mailing_zip } : null,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    loanOriginalCents: numOrNull(r.loan_original_cents),
    loanLender: r.loan_lender,
    loanOriginationDate: r.loan_origination_date,
    loanMaturityDate: r.loan_maturity_date,
    loanRatePct: numOrNull(r.loan_rate_pct),
    loanType: r.loan_type,
    lastSaleDate: r.last_sale_date,
    lastSalePriceCents: numOrNull(r.last_sale_price_cents),
    dataAsOf: r.data_as_of,
    score: r.score,
    scoreFactors: r.score_factors ?? [],
    recommendedProgram: r.recommended_program,
    windowBucket: r.window_bucket,
    status: r.status,
    assignedTo: r.assigned_to,
    notes: r.notes,
    lastScannedAt: r.last_scanned_at,
    updatedBy: r.updated_by,
  };
}

/** The machine-owned columns a scan writes. */
function scannedColumns(p: ScannedProspect, scanId: string | null) {
  return {
    dedupe_key: p.dedupeKey,
    source: p.source,
    source_ref: p.sourceRef,
    scan_id: scanId ?? p.scanId,
    address_line1: p.addressLine1,
    city: p.city,
    state: p.state,
    zip: p.zip,
    apn: p.apn,
    property_type: p.propertyType,
    units: p.units,
    building_sqft: p.buildingSqft,
    year_built: p.yearBuilt,
    owner_name: p.ownerName,
    owner_kind: p.ownerKind,
    mailing_line1: p.mailing?.line1 ?? null,
    mailing_city: p.mailing?.city ?? null,
    mailing_state: p.mailing?.state ?? null,
    mailing_zip: p.mailing?.zip ?? null,
    loan_original_cents: p.loanOriginalCents,
    loan_lender: p.loanLender,
    loan_origination_date: p.loanOriginationDate,
    loan_maturity_date: p.loanMaturityDate,
    loan_rate_pct: p.loanRatePct,
    loan_type: p.loanType,
    last_sale_date: p.lastSaleDate,
    last_sale_price_cents: p.lastSalePriceCents,
    data_as_of: p.dataAsOf,
    score: p.score,
    score_factors: p.scoreFactors,
    recommended_program: p.recommendedProgram,
    window_bucket: p.windowBucket,
  };
}

type OutreachRow = {
  id: string;
  created_at: string;
  updated_at: string;
  prospect_id: string;
  version: number;
  channel: ProspectOutreach["channel"];
  status: OutreachStatus;
  reason_code: OutreachReason | null;
  idempotency_key: string;
  recipient: string;
  subject: string;
  body_text: string;
  body_sha256: string;
  generated_by: ProspectOutreach["generatedBy"];
  model: string | null;
  guardrail_hits: string[];
  approval_id: string | null;
  provider_message_id: string | null;
  error: string | null;
  drafted_by: string;
  sent_at: string | null;
  mailed_at: string | null;
  mailed_by: string | null;
};

export function outreachFromRow(r: OutreachRow): ProspectOutreach {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    prospectId: r.prospect_id,
    version: r.version,
    channel: r.channel,
    status: r.status,
    reasonCode: r.reason_code,
    idempotencyKey: r.idempotency_key,
    recipient: r.recipient,
    subject: r.subject,
    bodyText: r.body_text,
    bodySha256: r.body_sha256,
    generatedBy: r.generated_by,
    model: r.model,
    guardrailHits: r.guardrail_hits ?? [],
    approvalId: r.approval_id,
    providerMessageId: r.provider_message_id,
    error: r.error,
    draftedBy: r.drafted_by,
    sentAt: r.sent_at,
    mailedAt: r.mailed_at,
    mailedBy: r.mailed_by,
  };
}

type ScanRow = {
  id: string;
  created_at: string;
  finished_at: string | null;
  provider: ProspectScan["provider"];
  status: ProspectScan["status"];
  params: Record<string, unknown>;
  found: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error: string | null;
  started_by: string;
};

const scanFromRow = (r: ScanRow): ProspectScan => ({
  id: r.id,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
  provider: r.provider,
  status: r.status,
  params: r.params ?? {},
  found: r.found,
  createdCount: r.created_count,
  updatedCount: r.updated_count,
  skippedCount: r.skipped_count,
  error: r.error,
  startedBy: r.started_by,
});

type SuppressionRow = { id: string; created_at: string; kind: SuppressionKind; value_hash: string; label: string; reason: SuppressionReason; created_by: string };

const suppressionFromRow = (r: SuppressionRow): Suppression => ({ id: r.id, createdAt: r.created_at, kind: r.kind, valueHash: r.value_hash, label: r.label, reason: r.reason, createdBy: r.created_by });

export class SupabaseProspectStore implements ProspectStore {
  constructor(private readonly db: SupabaseClient) {}

  async startScan(input: ScanStart, now: Date): Promise<ProspectScan> {
    const { data, error } = await this.db
      .from("prospect_scans")
      .insert({ provider: input.provider, params: input.params, started_by: input.startedBy.slice(0, 200), created_at: now.toISOString() })
      .select("*")
      .single();
    fail(error, "scan start");
    return scanFromRow(data as ScanRow);
  }

  async finishScan(id: string, finish: ScanFinish, now: Date): Promise<ProspectScan> {
    const { data, error } = await this.db
      .from("prospect_scans")
      .update({
        status: finish.status,
        found: finish.found,
        created_count: finish.createdCount,
        updated_count: finish.updatedCount,
        skipped_count: finish.skippedCount,
        error: finish.error?.slice(0, 1000) ?? null,
        finished_at: now.toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    fail(error, "scan finish");
    return scanFromRow(data as ScanRow);
  }

  async listScans(limit = 20): Promise<ProspectScan[]> {
    const { data, error } = await this.db.from("prospect_scans").select("*").order("created_at", { ascending: false }).limit(limit);
    fail(error, "scan list");
    return ((data ?? []) as ScanRow[]).map(scanFromRow);
  }

  async upsertScanned(p: ScannedProspect, initialStatus: ProspectStatus, now: Date): Promise<UpsertResult> {
    const ts = now.toISOString();
    const cols = scannedColumns(p, p.scanId);
    const { data: existing, error: readError } = await this.db.from("prospects").select("id").eq("dedupe_key", p.dedupeKey).maybeSingle();
    fail(readError, "prospect lookup");
    if (existing) {
      const { data, error } = await this.db.from("prospects").update({ ...cols, last_scanned_at: ts }).eq("id", (existing as { id: string }).id).select("*").single();
      fail(error, "prospect update");
      return { prospect: prospectFromRow(data as ProspectRow), created: false };
    }
    const { data, error } = await this.db
      .from("prospects")
      .insert({ ...cols, status: initialStatus, last_scanned_at: ts })
      .select("*")
      .single();
    if (error?.code === "23505") {
      // A concurrent scan inserted the same property first: refresh that row.
      const { data: again, error: updateError } = await this.db.from("prospects").update({ ...cols, last_scanned_at: ts }).eq("dedupe_key", p.dedupeKey).select("*").single();
      fail(updateError, "prospect update");
      return { prospect: prospectFromRow(again as ProspectRow), created: false };
    }
    fail(error, "prospect insert");
    return { prospect: prospectFromRow(data as ProspectRow), created: true };
  }

  async getProspect(id: string): Promise<Prospect | null> {
    const { data, error } = await this.db.from("prospects").select("*").eq("id", id).maybeSingle();
    fail(error, "prospect read");
    return data ? prospectFromRow(data as ProspectRow) : null;
  }

  async listProspects(f: ProspectFilter = {}): Promise<Prospect[]> {
    let q = this.db.from("prospects").select("*").order("score", { ascending: false }).order("loan_maturity_date", { ascending: true });
    if (f.status === "active") q = q.not("status", "in", "(not_a_fit,do_not_contact)");
    else if (f.status) q = q.eq("status", f.status);
    if (f.program) q = q.eq("recommended_program", f.program);
    if (f.window) q = q.eq("window_bucket", f.window);
    if (f.minScore !== undefined) q = q.gte("score", f.minScore);
    const term = f.q?.trim().replace(/[^\p{L}\p{N} .#-]/gu, "").slice(0, 80);
    if (term) {
      const like = `%${term}%`;
      q = q.or(["address_line1", "city", "owner_name", "apn", "zip"].map((c) => `${c}.ilike.${like}`).join(","));
    }
    const from = f.offset ?? 0;
    q = q.range(from, from + (f.limit ?? 100) - 1);
    const { data, error } = await q;
    fail(error, "prospect list");
    return ((data ?? []) as ProspectRow[]).map(prospectFromRow);
  }

  async countByStatus(): Promise<Record<ProspectStatus, number>> {
    const counts = emptyStatusCounts();
    for (const status of Object.keys(counts) as ProspectStatus[]) {
      const { count, error } = await this.db.from("prospects").select("id", { count: "exact", head: true }).eq("status", status);
      fail(error, "prospect count");
      counts[status] = count ?? 0;
    }
    return counts;
  }

  async updateStaff(id: string, edit: StaffProspectEdit, actor: string, now: Date): Promise<Prospect | null> {
    void now;
    const v = validateStaffEdit(edit);
    const patch: Record<string, unknown> = { updated_by: actor.slice(0, 200) };
    if (v.contactName !== undefined) patch.contact_name = v.contactName;
    if (v.contactEmail !== undefined) patch.contact_email = v.contactEmail;
    if (v.status !== undefined) patch.status = v.status;
    if (v.assignedTo !== undefined) patch.assigned_to = v.assignedTo;
    if (v.notes !== undefined) patch.notes = v.notes;
    const { data, error } = await this.db.from("prospects").update(patch).eq("id", id).select("*").maybeSingle();
    fail(error, "prospect edit");
    return data ? prospectFromRow(data as ProspectRow) : null;
  }

  async insertOutreach(row: NewProspectOutreach, now: Date): Promise<ProspectOutreach> {
    void now;
    const existing = await this.db.from("prospect_outreach").select("*").eq("idempotency_key", row.idempotencyKey).maybeSingle();
    fail(existing.error, "outreach lookup");
    if (existing.data) return outreachFromRow(existing.data as OutreachRow);
    for (let attempt = 0; attempt < 4; attempt++) {
      const latest = await this.db.from("prospect_outreach").select("version").eq("prospect_id", row.prospectId).order("version", { ascending: false }).limit(1);
      fail(latest.error, "outreach version");
      const version = (((latest.data ?? []) as { version: number }[])[0]?.version ?? 0) + 1;
      const { data, error } = await this.db
        .from("prospect_outreach")
        .insert({
          prospect_id: row.prospectId,
          version,
          channel: row.channel,
          status: row.status,
          reason_code: row.reasonCode ?? null,
          idempotency_key: row.idempotencyKey,
          recipient: row.recipient,
          subject: row.subject,
          body_text: row.bodyText,
          body_sha256: row.bodySha256,
          generated_by: row.generatedBy,
          model: row.model,
          guardrail_hits: row.guardrailHits,
          drafted_by: row.draftedBy.slice(0, 200),
        })
        .select("*")
        .single();
      if (error?.code === "23505" && attempt < 3) {
        // Same key inserted concurrently, or the version raced: return the row if it is ours, else try the next version.
        const again = await this.db.from("prospect_outreach").select("*").eq("idempotency_key", row.idempotencyKey).maybeSingle();
        if (again.data) return outreachFromRow(again.data as OutreachRow);
        continue;
      }
      fail(error, "outreach insert");
      return outreachFromRow(data as OutreachRow);
    }
    throw new ProspectStoreError("outreach insert: could not allocate a version");
  }

  async getOutreach(id: string): Promise<ProspectOutreach | null> {
    const { data, error } = await this.db.from("prospect_outreach").select("*").eq("id", id).maybeSingle();
    fail(error, "outreach read");
    return data ? outreachFromRow(data as OutreachRow) : null;
  }

  async listOutreach(prospectId: string): Promise<ProspectOutreach[]> {
    const { data, error } = await this.db.from("prospect_outreach").select("*").eq("prospect_id", prospectId).order("version", { ascending: false });
    fail(error, "outreach list");
    return ((data ?? []) as OutreachRow[]).map(outreachFromRow);
  }

  async listOutreachByStatus(status: OutreachStatus, limit = 50): Promise<ProspectOutreach[]> {
    const { data, error } = await this.db.from("prospect_outreach").select("*").eq("status", status).order("created_at", { ascending: true }).limit(limit);
    fail(error, "outreach list");
    return ((data ?? []) as OutreachRow[]).map(outreachFromRow);
  }

  async updateOutreach(id: string, from: readonly OutreachStatus[], patch: OutreachPatch, now: Date): Promise<ProspectOutreach | null> {
    void now;
    const cols: Record<string, unknown> = {};
    if (patch.status !== undefined) cols.status = patch.status;
    if (patch.reasonCode !== undefined) cols.reason_code = patch.reasonCode;
    if (patch.approvalId !== undefined) cols.approval_id = patch.approvalId;
    if (patch.providerMessageId !== undefined) cols.provider_message_id = patch.providerMessageId;
    if (patch.error !== undefined) cols.error = patch.error?.slice(0, 1000) ?? null;
    if (patch.sentAt !== undefined) cols.sent_at = patch.sentAt;
    if (patch.mailedAt !== undefined) cols.mailed_at = patch.mailedAt;
    if (patch.mailedBy !== undefined) cols.mailed_by = patch.mailedBy;
    const { data, error } = await this.db.from("prospect_outreach").update(cols).eq("id", id).in("status", [...from]).select("*").maybeSingle();
    fail(error, "outreach update");
    return data ? outreachFromRow(data as OutreachRow) : null;
  }

  async addSuppression(s: { kind: SuppressionKind; valueHash: string; label: string; reason: SuppressionReason; createdBy: string }, now: Date): Promise<Suppression> {
    const { data, error } = await this.db
      .from("prospect_suppressions")
      .upsert({ kind: s.kind, value_hash: s.valueHash, label: s.label, reason: s.reason, created_by: s.createdBy.slice(0, 200), created_at: now.toISOString() }, { onConflict: "kind,value_hash", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    fail(error, "suppression add");
    if (data) return suppressionFromRow(data as SuppressionRow);
    const existing = await this.db.from("prospect_suppressions").select("*").eq("kind", s.kind).eq("value_hash", s.valueHash).single();
    fail(existing.error, "suppression read");
    return suppressionFromRow(existing.data as SuppressionRow);
  }

  async listSuppressions(limit = 200): Promise<Suppression[]> {
    const { data, error } = await this.db.from("prospect_suppressions").select("*").order("created_at", { ascending: false }).limit(limit);
    fail(error, "suppression list");
    return ((data ?? []) as SuppressionRow[]).map(suppressionFromRow);
  }

  async find(keys: readonly SuppressionKey[]): Promise<{ kind: SuppressionKind; label: string }[]> {
    if (!keys.length) return [];
    const hashes = [...new Set(keys.map((k) => k.hash))];
    const { data, error } = await this.db.from("prospect_suppressions").select("kind, value_hash, label").in("value_hash", hashes);
    fail(error, "suppression lookup");
    const wanted = new Set(keys.map((k) => `${k.kind}:${k.hash}`));
    return ((data ?? []) as { kind: SuppressionKind; value_hash: string; label: string }[]).filter((r) => wanted.has(`${r.kind}:${r.value_hash}`)).map((r) => ({ kind: r.kind, label: r.label }));
  }
}
