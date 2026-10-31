// Test helper: runs a golden document fixture (evals/documents) through the
// deterministic extractor and returns what the store would hold.

import { parseDocument } from "@/lib/agents/documents/parse";
import { extractWithRules } from "@/lib/agents/documents/rules";
import type { ExtractionRecord, StoredFields } from "@/lib/agents/documents/store";
import { assessExtraction, validateExtraction } from "@/lib/agents/documents/validate";
import { loadDocumentEvals, sourceBytes } from "@/evals/documents/load";

export function goldenFields(caseId: string): StoredFields {
  for (const { suite } of loadDocumentEvals().suites) {
    const c = suite.cases.find((x) => x.id === caseId);
    if (!c) continue;
    const src = sourceBytes(c);
    const r = validateExtraction(extractWithRules(suite.docType, parseDocument(src.bytes, src.contentType).tables));
    return { scalars: r.scalars, rows: r.rows };
  }
  throw new Error(`no golden case ${caseId}`);
}

let seq = 0;

/** A stored extraction record built from a golden case. */
export function goldenRecord(caseId: string, overrides: Partial<ExtractionRecord> = {}): ExtractionRecord {
  for (const { suite } of loadDocumentEvals().suites) {
    const c = suite.cases.find((x) => x.id === caseId);
    if (!c) continue;
    const src = sourceBytes(c);
    const r = validateExtraction(extractWithRules(suite.docType, parseDocument(src.bytes, src.contentType).tables));
    const a = assessExtraction(r);
    seq++;
    return {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)).toISOString(),
      updated_at: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)).toISOString(),
      source_type: "manual",
      document_id: null,
      mail_message_id: null,
      attachment_name: null,
      lead_id: null,
      deal_id: "11111111-1111-4111-8111-111111111111",
      doc_type: suite.docType,
      source_format: c.source.format,
      source_sha256: null,
      status: a.status,
      engine: "rules",
      model: null,
      prompt_version: null,
      fields: { scalars: r.scalars, rows: r.rows },
      row_count: r.rows.length,
      overall_confidence: a.overallConfidence,
      low_confidence_fields: a.lowConfidenceFields,
      warnings: r.warnings,
      error: null,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      superseded_by: null,
      ...overrides,
    };
  }
  throw new Error(`no golden case ${caseId}`);
}
