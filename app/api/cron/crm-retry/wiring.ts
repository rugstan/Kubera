import type { SupabaseClient } from "@supabase/supabase-js";
import { decideWithRules } from "@/lib/ai/jev";
import { pushLead, pushPartner, type CrmProgress } from "@/lib/crm/twenty";
import type { Benchmarks } from "@/lib/rates";
import { MAX_ATTEMPTS, firstPushCutoff, type CrmPusher, type FailedLeadRow, type FailedPartnerRow, type RetryDeps, type RetryStore, type RowPatch } from "./retry";

const LEAD_COLUMNS = "id, contact, intake, decision, rationale, engine, latency_ms, crm_attempts, crm_last_attempt_at, crm_progress";
const PARTNER_COLUMNS = "id, profile, crm_attempts, crm_last_attempt_at, crm_progress";

/**
 * Rows the cron should push: a recorded failure (`crm_error`), or a row that
 * was never pushed at all and is older than the first attempt's grace period
 * (the after() push was lost, or Twenty was not configured at submission).
 * The timestamp is quoted because `.` and `:` are reserved inside or().
 */
export function pendingFilter(nowMs: number): string {
  return `crm_error.not.is.null,created_at.lt."${firstPushCutoff(nowMs)}"`;
}

export function supabaseRetryStore(db: SupabaseClient): RetryStore {
  const update = async (table: "leads" | "partners", id: string, patch: RowPatch | { crm_progress: CrmProgress }) => {
    const { error } = await db.from(table).update(patch).eq("id", id);
    if (error) throw new Error(`${table} update failed: ${error.message}`);
  };
  return {
    async failedLeads(limit, nowMs) {
      const { data, error } = await db
        .from("leads")
        .select(LEAD_COLUMNS)
        .or(pendingFilter(nowMs))
        .is("twenty_person_id", null)
        .lt("crm_attempts", MAX_ATTEMPTS)
        .order("crm_last_attempt_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`leads query failed: ${error.message}`);
      return (data ?? []) as FailedLeadRow[];
    },
    async failedPartners(limit, nowMs) {
      const { data, error } = await db
        .from("partners")
        .select(PARTNER_COLUMNS)
        .or(pendingFilter(nowMs))
        .is("twenty_company_id", null)
        .lt("crm_attempts", MAX_ATTEMPTS)
        .order("crm_last_attempt_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`partners query failed: ${error.message}`);
      return (data ?? []) as FailedPartnerRow[];
    },
    updateLead: (id, patch) => update("leads", id, patch),
    updatePartner: (id, patch) => update("partners", id, patch),
    saveLeadProgress: (id, progress) => update("leads", id, { crm_progress: progress }),
    savePartnerProgress: (id, progress) => update("partners", id, { crm_progress: progress }),
  };
}

export const twentyPusher: CrmPusher = { pushLead, pushPartner };

/**
 * The persisted decision is canonical (it is what the borrower and staff saw);
 * only the indicative quote shown in the CRM note is recomputed from the intake.
 */
export function rebuildJevFactory(benchmarks: Benchmarks): RetryDeps["rebuildJev"] {
  return (intake, stored) => {
    const fresh = decideWithRules(intake, benchmarks);
    return { ...fresh, decision: stored.decision, rationale: stored.rationale, engine: stored.engine, latencyMs: stored.latency_ms };
  };
}
