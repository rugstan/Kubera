// Scores an extraction against a golden case. Shared by the vitest suite
// (rules engine, deterministic) and the model eval runner (run.ts).

import type { ExtractionResult } from "@/lib/agents/documents/types";
import type { Assessment } from "@/lib/agents/documents/validate";
import { valueMatches, type DocumentEvalCase } from "./load";

export type CaseScore = { id: string; checked: number; passed: number; failures: string[] };

export function scoreCase(c: DocumentEvalCase, result: ExtractionResult, assessment: Assessment, opts: { checkStatus?: boolean } = {}): CaseScore {
  const failures: string[] = [];
  let checked = 0;
  const check = (ok: boolean, msg: string) => {
    checked++;
    if (!ok) failures.push(msg);
  };
  const e = c.expected;
  if (opts.checkStatus ?? true) check(assessment.status === e.status, `status ${assessment.status} != ${e.status} (low: ${assessment.lowConfidenceFields.join(", ")}; warnings: ${result.warnings.join(", ")})`);
  for (const [k, v] of Object.entries(e.scalars)) {
    const got = result.scalars[k]?.value ?? null;
    check(valueMatches(got, v), `${k}: got ${JSON.stringify(got)}, want ${JSON.stringify(v)}`);
  }
  if (e.rowCount !== undefined) check(result.rows.length === e.rowCount, `rows: got ${result.rows.length}, want ${e.rowCount}`);
  for (const row of e.rows ?? []) {
    const got = result.rows[row.index];
    for (const [k, v] of Object.entries(row.values)) check(valueMatches(got?.values[k] ?? null, v), `rows[${row.index}].${k}: got ${JSON.stringify(got?.values[k] ?? null)}, want ${JSON.stringify(v)}`);
  }
  for (const w of e.warnings ?? []) check(result.warnings.includes(w), `missing warning ${w}`);
  for (const f of e.lowConfidence ?? []) check(assessment.lowConfidenceFields.includes(f), `${f} should be flagged for review`);
  const blob = JSON.stringify(result);
  for (const t of e.forbiddenText ?? []) check(!blob.includes(t), `forbidden text "${t}" leaked into the extraction`);
  return { id: c.id, checked, passed: checked - failures.length, failures };
}
