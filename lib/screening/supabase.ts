// Supabase (service role) implementations of ScreeningStore and DealHoldStore.
// The database opens and releases holds by trigger as well; these methods are
// idempotent against that (an existing open hold is returned, not duplicated).

import type { SupabaseClient } from "@supabase/supabase-js";
import { DispositionConflictError, type DealHold, type DealHoldStore, type ScreeningStore } from "./store";
import type { ScreeningRecord } from "./types";

type Row = Record<string, unknown>;

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

export function screeningFromRow(r: Row): ScreeningRecord {
  return {
    id: String(r.id),
    dealId: String(r.deal_id),
    principalId: (r.principal_id as string | null) ?? null,
    subjectKind: r.subject_kind as ScreeningRecord["subjectKind"],
    subjectName: String(r.subject_name),
    purpose: r.purpose as ScreeningRecord["purpose"],
    provider: String(r.provider),
    listVersion: (r.list_version as string | null) ?? null,
    listsChecked: (r.lists_checked as string[] | null) ?? [],
    result: r.result as ScreeningRecord["result"],
    matchScore: r.match_score === null || r.match_score === undefined ? null : Number(r.match_score),
    matches: (r.matches as ScreeningRecord["matches"] | null) ?? [],
    error: (r.error as string | null) ?? null,
    disposition: r.disposition as ScreeningRecord["disposition"],
    reviewer: (r.reviewer as string | null) ?? null,
    reviewedAt: iso(r.reviewed_at),
    reviewNote: (r.review_note as string | null) ?? null,
    requestedBy: String(r.requested_by),
    screenedAt: iso(r.screened_at)!,
    createdAt: iso(r.created_at)!,
  };
}

export function holdFromRow(r: Row): DealHold {
  return {
    id: String(r.id),
    dealId: String(r.deal_id),
    reason: r.reason as DealHold["reason"],
    sourceKind: r.source_kind as DealHold["sourceKind"],
    sourceId: String(r.source_id),
    detail: String(r.detail),
    createdAt: iso(r.created_at)!,
    createdBy: String(r.created_by),
    releasedAt: iso(r.released_at),
    releasedBy: (r.released_by as string | null) ?? null,
    releaseNote: (r.release_note as string | null) ?? null,
  };
}

export function supabaseScreeningStore(db: SupabaseClient): ScreeningStore {
  return {
    async insert(rec, now) {
      const { data, error } = await db
        .from("screenings")
        .insert({
          deal_id: rec.dealId,
          principal_id: rec.principalId,
          subject_kind: rec.subjectKind,
          subject_name: rec.subjectName,
          purpose: rec.purpose,
          provider: rec.provider,
          list_version: rec.listVersion,
          lists_checked: rec.listsChecked,
          result: rec.result,
          match_score: rec.matchScore,
          matches: rec.matches,
          error: rec.error,
          disposition: rec.disposition,
          requested_by: rec.requestedBy,
          screened_at: rec.screenedAt,
          created_at: now.toISOString(),
        })
        .select("*")
        .single();
      if (error) fail("screening insert failed", error);
      return screeningFromRow(data as Row);
    },
    async get(id) {
      const { data, error } = await db.from("screenings").select("*").eq("id", id).maybeSingle();
      if (error) fail("screening lookup failed", error);
      return data ? screeningFromRow(data as Row) : null;
    },
    async forDeal(dealId) {
      const { data, error } = await db.from("screenings").select("*").eq("deal_id", dealId).order("screened_at").limit(2000);
      if (error) fail("screening list failed", error);
      return (data ?? []).map((r) => screeningFromRow(r as Row));
    },
    async setDisposition(id, from, patch) {
      const { data, error } = await db
        .from("screenings")
        .update({ disposition: patch.disposition, reviewer: patch.reviewer, reviewed_at: patch.reviewedAt, review_note: patch.reviewNote })
        .eq("id", id)
        .eq("disposition", from)
        .select("*")
        .maybeSingle();
      if (error) fail("screening review failed", error);
      if (!data) throw new DispositionConflictError();
      return screeningFromRow(data as Row);
    },
  };
}

export function supabaseDealHoldStore(db: SupabaseClient): DealHoldStore {
  const openFor = async (sourceKind: string, sourceId: string, reason: string) => {
    const { data, error } = await db.from("deal_holds").select("*").eq("source_kind", sourceKind).eq("source_id", sourceId).eq("reason", reason).is("released_at", null).maybeSingle();
    if (error) fail("hold lookup failed", error);
    return data ? holdFromRow(data as Row) : null;
  };
  return {
    async open(hold, now) {
      const existing = await openFor(hold.sourceKind, hold.sourceId, hold.reason);
      if (existing) return existing;
      const { data, error } = await db
        .from("deal_holds")
        .insert({ deal_id: hold.dealId, reason: hold.reason, source_kind: hold.sourceKind, source_id: hold.sourceId, detail: hold.detail, created_by: hold.createdBy, created_at: now.toISOString() })
        .select("*")
        .maybeSingle();
      if (error) {
        // Lost a race with the database trigger: the open hold now exists.
        const raced = await openFor(hold.sourceKind, hold.sourceId, hold.reason);
        if (raced) return raced;
        fail("hold insert failed", error);
      }
      return holdFromRow(data as Row);
    },
    async release(sourceKind, sourceId, by, note, now) {
      const { data, error } = await db
        .from("deal_holds")
        .update({ released_at: now.toISOString(), released_by: by, release_note: note })
        .eq("source_kind", sourceKind)
        .eq("source_id", sourceId)
        .eq("reason", "sanctions_potential_match")
        .is("released_at", null)
        .select("id");
      if (error) fail("hold release failed", error);
      return (data ?? []).length;
    },
    async active(dealId) {
      const { data, error } = await db.from("deal_holds").select("*").eq("deal_id", dealId).is("released_at", null).order("created_at");
      if (error) fail("hold list failed", error);
      return (data ?? []).map((r) => holdFromRow(r as Row));
    },
    async all(dealId) {
      const { data, error } = await db.from("deal_holds").select("*").eq("deal_id", dealId).order("created_at");
      if (error) fail("hold list failed", error);
      return (data ?? []).map((r) => holdFromRow(r as Row));
    },
  };
}
