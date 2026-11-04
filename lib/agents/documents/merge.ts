// Merges a rules extraction with a model extraction of the same document.
// Agreement raises confidence; disagreement keeps the more confident value,
// caps it at 0.5 and adds a conflict warning, so a reviewer sees it.

import type { ExtractedField, ExtractionResult, FieldValue } from "./types";
import { agrees, round } from "./values";

function same(a: FieldValue, b: FieldValue): boolean {
  if (typeof a === "number" && typeof b === "number") return agrees(a, b, 0.005);
  if (typeof a === "string" && typeof b === "string") return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

export function mergeExtractions(rules: ExtractionResult, model: ExtractionResult): ExtractionResult {
  const scalars: Record<string, ExtractedField> = {};
  const warnings = [...rules.warnings, ...model.warnings];
  const keys = new Set([...Object.keys(rules.scalars), ...Object.keys(model.scalars)]);
  for (const k of keys) {
    const a = rules.scalars[k];
    const b = model.scalars[k];
    if (!a || !b) {
      scalars[k] = { ...(a ?? b)! };
      continue;
    }
    const [hi, lo] = a.confidence >= b.confidence ? [a, b] : [b, a];
    if (same(a.value, b.value)) {
      scalars[k] = { ...hi, confidence: round(Math.min(0.99, hi.confidence + 0.05), 3) };
    } else {
      scalars[k] = { ...hi, confidence: Math.min(hi.confidence, lo.confidence, 0.5) };
      warnings.push(`conflict_${k}`);
    }
  }
  let rows = rules.rows;
  if (model.rows.length || rules.rows.length) {
    const r = rules.rows.length;
    const m = model.rows.length;
    if (r && m && Math.abs(r - m) / Math.max(r, m) > 0.1) warnings.push("row_count_conflict");
    if (r === 0 || m > r * 1.1) rows = model.rows;
    if (r && m === r) rows = rules.rows.map((row) => ({ ...row, confidence: round(Math.min(0.99, row.confidence + 0.03), 3) }));
  }
  return { docType: rules.docType, scalars, rows, warnings: [...new Set(warnings)] };
}
