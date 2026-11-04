// Portal uploads go through the WS-K document vault: a `documents` row in
// `pending_upload`, the object in the quarantine bucket, finalize (size, type,
// magic bytes, quota), then the malware scan. Only a `clean` document leaves
// quarantine, and only then is the checklist item received. Staff open the
// file through the audited viewer (/documents/[id]).

import { finalizeDocument } from "@/lib/documents/finalize";
import { reserveUpload, type VaultDeps } from "@/lib/documents/mint";
import type { AllowedContentType, DocumentKind, DocumentStatus } from "@/lib/documents/types";

export type VaultFailure = { ok: false; status: number; message: string };

export interface ChecklistVault {
  /** The lead the deal's vault documents are filed under (documents.lead_id), or null. */
  leadForDeal(dealId: string): Promise<string | null>;
  reserve(input: { leadId: string; kind: DocumentKind; fileName: string; contentType: AllowedContentType; sizeBytes: number }): Promise<{ ok: true; documentId: string; uploadUrl: string; storagePath: string } | VaultFailure>;
  /** Verifies the uploaded object and queues it for the malware scan (idempotent). */
  finalize(documentId: string, actor: string): Promise<{ ok: true; status: DocumentStatus } | VaultFailure>;
  /** Current vault status of each document (missing ids are left out). */
  statuses(documentIds: readonly string[]): Promise<Map<string, { status: DocumentStatus; rejectReason: string | null }>>;
}

/** Checklist item → vault document kind (lender packages and the viewer filter by kind). */
const KIND_BY_ITEM: Record<string, DocumentKind> = {
  t12: "T12",
  t3: "T12",
  operating_history: "T12",
  rent_roll: "RENT_ROLL",
  rent_roll_certified: "RENT_ROLL",
  census_payor_mix: "CENSUS",
  str_report: "STR_REPORT",
  franchise_agreement: "FRANCHISE_AGREEMENT",
  pip_budget: "PIP_BUDGET",
  pfs: "PFS",
  business_tax_returns: "TAX_RETURN",
  personal_tax_returns: "TAX_RETURN",
  appraisal: "APPRAISAL",
  appraisal_as_complete: "APPRAISAL",
};

export function documentKindForItem(item: { itemKey: string; templateKey: string }): DocumentKind {
  return KIND_BY_ITEM[item.templateKey] ?? KIND_BY_ITEM[item.itemKey] ?? "OTHER";
}

/** The checklist vault on the WS-K vault services. */
export function checklistVault(vault: VaultDeps, leadForDeal: (dealId: string) => Promise<string | null>): ChecklistVault {
  return {
    leadForDeal,
    async reserve(input) {
      const r = await reserveUpload(vault, input);
      return r.ok ? { ok: true, documentId: r.documentId, uploadUrl: r.uploadUrl, storagePath: r.path } : { ok: false, status: r.status, message: r.message };
    },
    async finalize(documentId, actor) {
      const r = await finalizeDocument(vault, documentId, { actor });
      return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, message: r.message };
    },
    async statuses(documentIds) {
      const out = new Map<string, { status: DocumentStatus; rejectReason: string | null }>();
      for (const id of new Set(documentIds)) {
        const row = await vault.store.get(id);
        if (row) out.set(id, { status: row.status, rejectReason: row.reject_reason });
      }
      return out;
    },
  };
}
