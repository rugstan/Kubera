// Workflow entry point: the event the scan worker (or a staff "re-run") emits
// when a vault document is clean, and the handler an Inngest function binds to
// it. The handler is idempotent per (document, content hash): a re-delivered
// event for a document whose live extraction already matches the stored bytes
// is skipped.

import { z } from "zod";
import { DocumentNotReadyError, extractDocument, type ExtractionDeps, type ExtractionOutcome } from "./pipeline";
import { DOC_TYPE_BY_VAULT_KIND } from "./specs";
import { DOC_TYPES } from "./types";

export const DOCUMENT_EVENTS = {
  /** A vault document passed the malware scan (or staff asked for a re-run). */
  documentClean: "corin/document.clean",
  /** An extraction finished (for spreads, Jev re-sizing and lender matching). */
  documentExtracted: "corin/document.extracted",
} as const;

export const documentCleanSchema = z.object({
  documentId: z.string().uuid(),
  dealId: z.string().uuid().nullable().optional(),
  docType: z.enum(DOC_TYPES).optional(),
  /** Re-run even when the live extraction already covers these bytes. */
  force: z.boolean().optional(),
  requestedBy: z.string().min(1).max(200).optional(),
});
export type DocumentClean = z.infer<typeof documentCleanSchema>;

export type DocumentExtracted = {
  extractionId: string;
  documentId: string | null;
  dealId: string | null;
  leadId: string | null;
  docType: string | null;
  status: string;
};

export type HandlerResult = { skipped: true; reason: string } | { skipped: false; outcome: ExtractionOutcome; emit: { name: string; data: DocumentExtracted } };

export async function documentCleanHandler(data: unknown, deps: ExtractionDeps): Promise<HandlerResult> {
  const input = documentCleanSchema.parse(data);
  if (!input.force) {
    const doc = await deps.vault?.documents.get(input.documentId);
    const docType = input.docType ?? (doc ? DOC_TYPE_BY_VAULT_KIND[doc.kind] : undefined);
    const live = docType ? await deps.store.findLive({ documentId: input.documentId, docType }) : null;
    if (live && doc?.sha256 && live.source_sha256 === doc.sha256) return { skipped: true, reason: "already_extracted" };
  }
  try {
    const outcome = await extractDocument(deps, {
      source: "vault_document",
      documentId: input.documentId,
      ...(input.docType ? { docType: input.docType } : {}),
      ...(input.dealId !== undefined ? { dealId: input.dealId } : {}),
      ...(input.requestedBy ? { actor: input.requestedBy } : {}),
    });
    const e = outcome.extraction;
    return {
      skipped: false,
      outcome,
      emit: {
        name: DOCUMENT_EVENTS.documentExtracted,
        data: { extractionId: e.id, documentId: e.document_id, dealId: e.deal_id, leadId: e.lead_id, docType: e.doc_type, status: e.status },
      },
    };
  } catch (err) {
    if (err instanceof DocumentNotReadyError) return { skipped: true, reason: err.message };
    throw err;
  }
}
