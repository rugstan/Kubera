// Shared types for the document agent (WS-L).
//
// A document goes through four stages:
//
//   parse     bytes -> tables and text (CSV, XLSX, PDF text layer, or NeMo Retriever)
//   classify  which of the seven document types it is (when the vault kind does not say)
//   extract   typed fields with per-field confidence (rules over tables, a model over
//             text, or Claude over the PDF itself), merged and cross-checked
//   review    low-confidence or missing required fields go to the staff review queue;
//             everything else is accepted for the spreads layer (lib/spreads)
//
// Extraction is analysis. It never sends anything outside Kubera except the model
// call itself, which passes the routing guard (lib/ai/routing.ts).

export const DOC_TYPES = ["T12", "RENT_ROLL", "CENSUS", "STR", "PFS", "CONSTRUCTION_BUDGET", "TERM_SHEET"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const SOURCE_FORMATS = ["pdf", "xlsx", "csv", "text"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export const EXTRACTION_STATUSES = ["pending", "extracted", "needs_review", "approved", "rejected", "failed", "superseded"] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

/** Statuses the spreads layer may read. */
export const ACCEPTED_STATUSES: readonly ExtractionStatus[] = ["extracted", "approved"];

/**
 * Value kinds. `percent` is stored as a fraction (92% -> 0.92); `rate` is an
 * interest rate in percentage points (6.25% -> 6.25), matching lib/sizing.
 * `date` is an ISO date (YYYY-MM-DD); `month` is YYYY-MM.
 */
export type FieldKind = "money" | "number" | "integer" | "percent" | "rate" | "date" | "month" | "string" | "boolean";

export type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
  /** Lower-case labels / column headers the rules extractor matches (normalized). */
  synonyms: readonly string[];
  /** Missing required fields send the extraction to review. */
  required?: boolean;
  /** For the model prompt: what the field means and its sign convention. */
  hint?: string;
  /** Durations: text such as "10 years" or "120 months" is converted to this unit. */
  unit?: "years" | "months";
};

export type RowSpec = {
  key: string;
  label: string;
  columns: readonly FieldSpec[];
  /** A header row must match these columns; a data row must have them. */
  requiredColumns: readonly string[];
  /** Columns that must never be extracted (personal data the spreads do not need). */
  ignoredColumns?: readonly string[];
  /** The document is complete without rows (a budget may be totals only). */
  optional?: boolean;
};

export type DocTypeSpec = {
  docType: DocType;
  label: string;
  /** Routing-guard level of the extracted content. */
  classification: "confidential" | "restricted";
  /** Words whose presence suggests this document type (classifier). */
  keywords: readonly string[];
  scalars: readonly FieldSpec[];
  rows?: RowSpec;
};

export type FieldValue = number | string | boolean | null;

export type FieldSource = "rules" | "model" | "computed" | "reviewer";

export type ExtractedField = {
  value: FieldValue;
  /** 0..1. Below REVIEW_THRESHOLD a non-null value goes to review. */
  confidence: number;
  source: FieldSource;
  /** Where it came from: "row 14: Real estate taxes", "p.2", or the model's quote. Never a value of another field. */
  evidence?: string;
};

export type ExtractedRow = {
  values: Record<string, FieldValue>;
  confidence: number;
  source: FieldSource;
};

export type ExtractionResult = {
  docType: DocType;
  scalars: Record<string, ExtractedField>;
  rows: ExtractedRow[];
  warnings: string[];
};

/** Fields at or above this confidence are accepted without review. */
export const REVIEW_THRESHOLD = 0.8;

/** A cell from a table: text, a number, or empty. */
export type Cell = string | number | null;
export type Table = { name: string; rows: Cell[][] };

export type ParsedSource = {
  format: SourceFormat;
  tables: Table[];
  /** Plain text (PDF text layer, NeMo text, or the CSV/text itself). */
  text: string;
  /** 0..1: how much of the text looks like real words and numbers (0 for scanned PDFs). */
  textQuality: number;
  pages?: number;
  warnings: string[];
};

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
