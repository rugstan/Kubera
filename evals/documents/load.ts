// Golden fixtures for the document agent: one suite per document type, each
// case a source document (CSV / text lines, an XLSX sheet grid, or PDF text
// lines rendered to a real PDF) and the values a correct extraction returns.
// Sources are kept as reviewable JSON; binary files are built at test time.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { buildPdf } from "@/lib/agents/documents/parse/pdf";
import { buildXlsx } from "@/lib/agents/documents/parse/xlsx";
import { DOC_TYPES } from "@/lib/agents/documents/types";

export const DOCUMENT_EVAL_DIR = path.resolve(import.meta.dirname);

const cell = z.union([z.string(), z.number(), z.null()]);
const value = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const source = z.discriminatedUnion("format", [
  z.object({ format: z.literal("csv"), lines: z.array(z.string()).min(1) }),
  z.object({ format: z.literal("text"), lines: z.array(z.string()).min(1) }),
  z.object({ format: z.literal("xlsx"), sheets: z.array(z.object({ name: z.string().min(1), rows: z.array(z.array(cell)) })).min(1) }),
  z.object({ format: z.literal("pdf"), lines: z.array(z.array(z.string()).min(1)).min(1), compress: z.boolean().optional() }),
]);

export const documentEvalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(10),
  source,
  expected: z.object({
    status: z.enum(["extracted", "needs_review"]),
    scalars: z.record(z.string(), value),
    rowCount: z.number().int().min(0).optional(),
    rows: z.array(z.object({ index: z.number().int().min(0), values: z.record(z.string(), value) })).optional(),
    warnings: z.array(z.string()).optional(),
    lowConfidence: z.array(z.string()).optional(),
    /** Text that must not appear anywhere in the stored extraction (names, account numbers). */
    forbiddenText: z.array(z.string()).optional(),
  }),
});
export type DocumentEvalCase = z.infer<typeof documentEvalCaseSchema>;

export const documentEvalSuiteSchema = z.object({ docType: z.enum(DOC_TYPES), cases: z.array(documentEvalCaseSchema).min(3) });
export type DocumentEvalSuite = z.infer<typeof documentEvalSuiteSchema>;

export type LoadedDocumentSuite = { file: string; suite: DocumentEvalSuite };

export function loadDocumentEvals(dir = DOCUMENT_EVAL_DIR): { suites: LoadedDocumentSuite[]; errors: string[] } {
  const suites: LoadedDocumentSuite[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      errors.push(`${file}: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const parsed = documentEvalSuiteSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${file}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      continue;
    }
    for (const c of parsed.data.cases) {
      if (ids.has(c.id)) errors.push(`${file}: duplicate case id ${c.id}`);
      ids.add(c.id);
    }
    suites.push({ file, suite: parsed.data });
  }
  return { suites, errors };
}

export type SourceBytes = { bytes: Uint8Array; contentType: string; fileName: string };

/** Renders a case's source to the bytes an upload would carry. */
export function sourceBytes(c: DocumentEvalCase): SourceBytes {
  const enc = new TextEncoder();
  switch (c.source.format) {
    case "csv":
      return { bytes: enc.encode(c.source.lines.join("\r\n") + "\r\n"), contentType: "text/csv", fileName: `${c.id}.csv` };
    case "text":
      return { bytes: enc.encode(c.source.lines.join("\n") + "\n"), contentType: "text/plain", fileName: `${c.id}.txt` };
    case "xlsx":
      return { bytes: buildXlsx(c.source.sheets), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: `${c.id}.xlsx` };
    case "pdf":
      return { bytes: buildPdf(c.source.lines, { compress: c.source.compress ?? false }), contentType: "application/pdf", fileName: `${c.id}.pdf` };
  }
}

/** Plain text of a case (for the model eval run). */
export function sourceText(c: DocumentEvalCase): string {
  switch (c.source.format) {
    case "csv":
    case "text":
      return c.source.lines.join("\n");
    case "xlsx":
      return c.source.sheets.map((s) => `# ${s.name}\n${s.rows.map((r) => r.map((x) => (x === null ? "" : String(x))).join("\t")).join("\n")}`).join("\n\n");
    case "pdf":
      return c.source.lines.map((l) => l.join("\t")).join("\n");
  }
}

/** Compares one extracted value with the expected one (numbers to 1e-6 relative or 0.005 absolute). */
export function valueMatches(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number") return typeof actual === "number" && Math.abs(actual - expected) <= Math.max(0.005, Math.abs(expected) * 1e-6);
  if (typeof expected === "string") return typeof actual === "string" && actual.trim().toLowerCase() === expected.trim().toLowerCase();
  return actual === expected;
}
