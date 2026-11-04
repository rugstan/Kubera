// Staff review queue for extractions: list what needs a human, apply field
// corrections, approve or reject. Corrected fields become `reviewer` values
// with confidence 1; the cross-checks re-run so a corrected part recomputes
// nothing silently (a disagreeing total is flagged again). Events record field
// names only, never values.

import { budgetRecordFrom } from "./pipeline";
import { specFor } from "./specs";
import { RESTRICTED_FIELDS_UNAVAILABLE, type ConstructionBudgetStore, type ExtractionEventLog, type ExtractionRecord, type ExtractionStore } from "./store";
import { systemClock, type Clock, type ExtractedField, type ExtractionResult, type FieldValue } from "./types";
import { assessExtraction, validateExtraction } from "./validate";
import { coerceField } from "./values";

export type ReviewDeps = { store: ExtractionStore; events: ExtractionEventLog; budgets?: ConstructionBudgetStore; clock?: Clock };

export type Corrections = {
  /** Field key -> corrected value (null clears it). Values are coerced to the field's kind. */
  scalars?: Record<string, FieldValue>;
  /** Row index -> corrected column values. */
  rows?: { index: number; values: Record<string, FieldValue> }[];
  /** Row indexes to drop (duplicates, subtotal lines read as data). */
  removeRows?: number[];
  /** Rows to add. */
  addRows?: Record<string, FieldValue>[];
};

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "not_reviewable" | "invalid_correction" | "required_missing" | "conflict",
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

const REVIEWABLE = ["needs_review", "extracted"] as const;

export async function listReviewQueue(store: ExtractionStore, limit = 50): Promise<ExtractionRecord[]> {
  return store.listByStatus("needs_review", Math.min(Math.max(limit, 1), 500));
}

export function toResult(rec: ExtractionRecord): ExtractionResult {
  if (!rec.doc_type) throw new ReviewError("extraction has no document type", "not_reviewable");
  return { docType: rec.doc_type, scalars: rec.fields.scalars, rows: rec.fields.rows, warnings: [] };
}

/** Pure: applies corrections to a result. Throws ReviewError on unknown fields or bad values. */
export function applyCorrections(result: ExtractionResult, c: Corrections): { result: ExtractionResult; changed: string[] } {
  const spec = specFor(result.docType);
  const scalars: Record<string, ExtractedField> = structuredClone(result.scalars);
  let rows = structuredClone(result.rows);
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(c.scalars ?? {})) {
    const field = spec.scalars.find((f) => f.key === key);
    if (!field) throw new ReviewError(`unknown field ${key}`, "invalid_correction");
    const value = raw === null ? null : coerceField(field, typeof raw === "boolean" ? (raw ? "yes" : "no") : raw).value;
    if (raw !== null && value === null) throw new ReviewError(`invalid value for ${key}`, "invalid_correction");
    if (value === null) delete scalars[key];
    else scalars[key] = { value, confidence: 1, source: "reviewer", evidence: "corrected by reviewer" };
    changed.push(key);
  }
  const rowSpec = spec.rows;
  const coerceRow = (values: Record<string, FieldValue>, base: Record<string, FieldValue> = {}) => {
    if (!rowSpec) throw new ReviewError("this document type has no rows", "invalid_correction");
    const out: Record<string, FieldValue> = { ...base };
    for (const [k, raw] of Object.entries(values)) {
      const col = rowSpec.columns.find((x) => x.key === k);
      if (!col) throw new ReviewError(`unknown column ${k}`, "invalid_correction");
      const v = raw === null ? null : coerceField(col, typeof raw === "boolean" ? String(raw) : raw).value;
      if (raw !== null && v === null) throw new ReviewError(`invalid value for ${k}`, "invalid_correction");
      out[k] = v;
    }
    for (const col of rowSpec.columns) if (!(col.key in out)) out[col.key] = null;
    return out;
  };
  for (const edit of c.rows ?? []) {
    const row = rows[edit.index];
    if (!row) throw new ReviewError(`no row ${edit.index}`, "invalid_correction");
    rows[edit.index] = { values: coerceRow(edit.values, row.values), confidence: 1, source: "reviewer" };
    changed.push(`${rowSpec!.key}[${edit.index}]`);
  }
  if (c.removeRows?.length) {
    const drop = new Set(c.removeRows);
    for (const i of drop) if (!rows[i]) throw new ReviewError(`no row ${i}`, "invalid_correction");
    rows = rows.filter((_, i) => !drop.has(i));
    changed.push(`${rowSpec?.key ?? "rows"}:removed:${drop.size}`);
  }
  for (const add of c.addRows ?? []) {
    rows.push({ values: coerceRow(add), confidence: 1, source: "reviewer" });
    changed.push(`${rowSpec?.key ?? "rows"}:added`);
  }
  return { result: { ...result, scalars, rows }, changed };
}

export async function correctAndApprove(
  deps: ReviewDeps,
  id: string,
  args: { reviewer: string; corrections?: Corrections; notes?: string },
): Promise<ExtractionRecord> {
  const clock = deps.clock ?? systemClock;
  if (!args.reviewer.trim()) throw new ReviewError("reviewer is required", "invalid_correction");
  const rec = await deps.store.get(id);
  if (!rec) throw new ReviewError("extraction not found", "not_found");
  if (!REVIEWABLE.includes(rec.status as (typeof REVIEWABLE)[number])) throw new ReviewError(`extraction is ${rec.status}`, "not_reviewable");
  // Sealed (PFS) fields that could not be opened must never be approved, or overwritten, blind.
  if (rec.warnings.includes(RESTRICTED_FIELDS_UNAVAILABLE)) throw new ReviewError("this extraction's restricted fields cannot be decrypted (check PII_ENCRYPTION_KEY)", "not_reviewable");
  const { result: corrected, changed } = applyCorrections(toResult(rec), args.corrections ?? {});
  // Approval vouches for every field that is left: the reviewer saw them.
  const vouched: ExtractionResult = {
    ...corrected,
    scalars: Object.fromEntries(Object.entries(corrected.scalars).map(([k, v]) => [k, { ...v, confidence: 1 }])),
    rows: corrected.rows.map((r) => ({ ...r, confidence: 1 })),
  };
  const validated = validateExtraction(vouched);
  const missing = specFor(validated.docType).scalars.filter((f) => f.required && (validated.scalars[f.key]?.value ?? null) === null).map((f) => f.key);
  if (missing.length) throw new ReviewError(`required fields missing: ${missing.join(", ")}`, "required_missing");
  const mismatches = validated.warnings.filter((w) => w.endsWith("_mismatch"));
  if (mismatches.length) throw new ReviewError(`figures still disagree: ${mismatches.join(", ")}; correct them before approving`, "invalid_correction");
  const assessment = assessExtraction(validated);
  const updated = await deps.store.update(
    id,
    {
      status: "approved",
      fields: { scalars: validated.scalars, rows: validated.rows },
      row_count: validated.rows.length,
      overall_confidence: Math.max(assessment.overallConfidence, 0.99),
      low_confidence_fields: [],
      reviewed_by: args.reviewer.slice(0, 200),
      reviewed_at: clock().toISOString(),
      review_notes: args.notes?.slice(0, 2000) ?? null,
    },
    REVIEWABLE,
  );
  if (!updated) throw new ReviewError("extraction changed while it was being reviewed", "conflict");
  if (changed.length) await deps.events.record({ extraction_id: id, event_type: "corrected", actor: args.reviewer, detail: { fields: changed.slice(0, 100) } });
  await deps.events.record({ extraction_id: id, event_type: "approved", actor: args.reviewer, detail: { corrected: changed.length } });
  if (updated.doc_type === "CONSTRUCTION_BUDGET" && deps.budgets) {
    const existing = await deps.budgets.get(id);
    await deps.budgets.upsert(budgetRecordFrom(updated, existing?.budget_kind ?? "ground_up"));
  }
  return updated;
}

export async function rejectExtraction(deps: ReviewDeps, id: string, args: { reviewer: string; reason: string }): Promise<ExtractionRecord> {
  const clock = deps.clock ?? systemClock;
  if (!args.reviewer.trim() || !args.reason.trim()) throw new ReviewError("reviewer and reason are required", "invalid_correction");
  const updated = await deps.store.update(
    id,
    { status: "rejected", reviewed_by: args.reviewer.slice(0, 200), reviewed_at: clock().toISOString(), review_notes: args.reason.slice(0, 2000) },
    REVIEWABLE,
  );
  if (!updated) throw new ReviewError("extraction not found or not reviewable", "not_reviewable");
  await deps.events.record({ extraction_id: id, event_type: "rejected", actor: args.reviewer, detail: { reason: args.reason.slice(0, 200) } });
  if (updated.doc_type === "CONSTRUCTION_BUDGET" && deps.budgets) await deps.budgets.setStatus(id, "rejected");
  return updated;
}
