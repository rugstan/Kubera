// Supabase (service role) implementation of ApprovalStore. Conditional
// updates (`status = 'pending'`, `executed_at is null`) make each transition
// atomic; the approvals_guard trigger rejects anything that slips through.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalStore, Decision, NewApproval } from "./store";
import { APPROVAL_STATUSES, type ApprovalListFilter, type ApprovalRecord, type ApprovalStatus, type ApprovalTemplate } from "./types";

export type ApprovalRow = {
  id: string;
  created_at: string;
  kind: string;
  idempotency_key: string;
  summary: string;
  template_id: string | null;
  payload: Record<string, unknown> | null;
  payload_sha256: string;
  requested_by: string;
  requested_by_user: string | null;
  deal_id: string | null;
  lead_id: string | null;
  status: string;
  expires_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_label: string | null;
  decided_by_dre: string | null;
  decision_reason: string | null;
  auto_approved: boolean;
  executed_at: string | null;
  execution_ref: string | null;
};

const COLUMNS =
  "id, created_at, kind, idempotency_key, summary, template_id, payload, payload_sha256, requested_by, requested_by_user, deal_id, lead_id, status, expires_at, decided_at, decided_by, decided_by_label, decided_by_dre, decision_reason, auto_approved, executed_at, execution_ref";

function asStatus(s: string): ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(s) ? (s as ApprovalStatus) : "pending";
}

export function fromRow(r: ApprovalRow): ApprovalRecord {
  return {
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind,
    idempotencyKey: r.idempotency_key,
    summary: r.summary,
    templateId: r.template_id,
    payload: r.payload ?? {},
    payloadSha256: r.payload_sha256,
    requestedBy: r.requested_by,
    requestedByUser: r.requested_by_user,
    dealId: r.deal_id,
    leadId: r.lead_id,
    status: asStatus(r.status),
    expiresAt: r.expires_at,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    decidedByLabel: r.decided_by_label,
    decidedByDre: r.decided_by_dre,
    decisionReason: r.decision_reason,
    autoApproved: r.auto_approved,
    executedAt: r.executed_at,
    executionRef: r.execution_ref,
  };
}

export function toInsertRow(row: NewApproval, now: Date): Omit<ApprovalRow, "id" | "executed_at" | "execution_ref"> {
  return {
    created_at: now.toISOString(),
    kind: row.kind,
    idempotency_key: row.idempotencyKey,
    summary: row.summary,
    template_id: row.templateId,
    payload: row.payload,
    payload_sha256: row.payloadSha256,
    requested_by: row.requestedBy,
    requested_by_user: row.requestedByUser,
    deal_id: row.dealId,
    lead_id: row.leadId,
    status: row.status,
    expires_at: row.expiresAt,
    decided_at: row.decidedAt,
    decided_by: row.decidedBy,
    decided_by_label: row.decidedByLabel,
    decided_by_dre: row.decidedByDre,
    decision_reason: row.decisionReason,
    auto_approved: row.autoApproved,
  };
}

export function supabaseApprovalStore(db: SupabaseClient): ApprovalStore {
  const table = () => db.from("approvals");

  const byKey = async (key: string) => {
    const { data, error } = await table().select(COLUMNS).eq("idempotency_key", key).maybeSingle<ApprovalRow>();
    if (error) throw new Error(`approvals lookup failed: ${error.message}`);
    return data ? fromRow(data) : null;
  };

  return {
    async insertIfAbsent(row, now) {
      const { data, error } = await table()
        .upsert(toInsertRow(row, now), { onConflict: "idempotency_key", ignoreDuplicates: true })
        .select(COLUMNS);
      if (error) throw new Error(`approval request failed: ${error.message}`);
      const inserted = (data ?? []) as ApprovalRow[];
      if (inserted[0]) return { record: fromRow(inserted[0]), created: true };
      const existing = await byKey(row.idempotencyKey);
      if (!existing) throw new Error("approval request conflict could not be resolved");
      return { record: existing, created: false };
    },

    async get(id) {
      const { data, error } = await table().select(COLUMNS).eq("id", id).maybeSingle<ApprovalRow>();
      if (error) throw new Error(`approvals lookup failed: ${error.message}`);
      return data ? fromRow(data) : null;
    },

    getByKey: byKey,

    async list(filter: ApprovalListFilter = {}) {
      let q = table().select(COLUMNS).order("created_at", { ascending: false }).limit(Math.min(filter.limit ?? 200, 500));
      if (filter.status) q = Array.isArray(filter.status) ? q.in("status", filter.status) : q.eq("status", filter.status);
      if (filter.dealId) q = q.eq("deal_id", filter.dealId);
      const { data, error } = await q;
      if (error) throw new Error(`approvals list failed: ${error.message}`);
      return ((data ?? []) as ApprovalRow[]).map(fromRow);
    },

    async decide(id, d: Decision, now) {
      let q = table()
        .update({
          status: d.status,
          decided_at: now.toISOString(),
          decided_by: d.decidedBy,
          decided_by_label: d.decidedByLabel,
          decided_by_dre: d.decidedByDre,
          decision_reason: d.decisionReason,
        })
        .eq("id", id)
        .eq("status", "pending");
      if (d.status === "approved") q = q.gt("expires_at", now.toISOString());
      const { data, error } = await q.select(COLUMNS);
      // The guard trigger raises when the database clock says the row expired; treat as "not decided".
      if (error) {
        if (/expired|already/i.test(error.message)) return null;
        throw new Error(`approval decision failed: ${error.message}`);
      }
      const rows = (data ?? []) as ApprovalRow[];
      return rows[0] ? fromRow(rows[0]) : null;
    },

    async expireDue() {
      const { data, error } = await db.rpc("expire_due_approvals");
      if (error) throw new Error(`approval expiry failed: ${error.message}`);
      return ((data ?? []) as ApprovalRow[]).map(fromRow);
    },

    async claimExecution(id, now, executionRef) {
      const { data, error } = await table()
        .update({ executed_at: now.toISOString(), ...(executionRef ? { execution_ref: executionRef } : {}) })
        .eq("id", id)
        .eq("status", "approved")
        .is("executed_at", null)
        .select(COLUMNS);
      if (error) throw new Error(`approval execution claim failed: ${error.message}`);
      const rows = (data ?? []) as ApprovalRow[];
      return rows[0] ? fromRow(rows[0]) : null;
    },

    async setExecutionRef(id, executionRef) {
      const { error } = await table().update({ execution_ref: executionRef }).eq("id", id).not("executed_at", "is", null).is("execution_ref", null);
      if (error) throw new Error(`approval execution reference failed: ${error.message}`);
    },

    async activeTemplate(templateId) {
      const { data, error } = await db
        .from("approval_templates")
        .select("template_id, kind, description, body_sha256, approved_by, approved_by_dre, approved_at, revoked_at")
        .eq("template_id", templateId)
        .is("revoked_at", null)
        .maybeSingle<{
          template_id: string;
          kind: string;
          description: string;
          body_sha256: string;
          approved_by: string;
          approved_by_dre: string;
          approved_at: string;
          revoked_at: string | null;
        }>();
      if (error) throw new Error(`approval template lookup failed: ${error.message}`);
      if (!data) return null;
      const t: ApprovalTemplate = {
        templateId: data.template_id,
        kind: data.kind,
        description: data.description,
        bodySha256: data.body_sha256,
        approvedBy: data.approved_by,
        approvedByDre: data.approved_by_dre,
        approvedAt: data.approved_at,
        revokedAt: data.revoked_at,
      };
      return t;
    },
  };
}
