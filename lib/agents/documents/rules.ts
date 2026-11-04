// Deterministic extractor over tables (CSV, XLSX, PDF text lines, NeMo tables).
//
// Scalars: each row's label is matched against the field synonyms (exact match
// scores higher than a whole-word "contains"); rows and fields are paired
// greedily by score, so "Total operating expenses" never lands in "Insurance".
// The value comes from the Total/Annual column when the sheet has one, the sum
// of twelve month columns when it does not, or the last amount on the row.
//
// Rows (rent roll units, census rows, STR months, budget lines): the header row
// is found by matching column synonyms; data rows run until a blank or "Total"
// row. Columns holding personal data the spreads do not need (tenant names,
// resident names, dates of birth) are dropped, never read.

import { BUDGET_CATEGORIES, T12_DEDUCTION_KEYS, T12_EXPENSE_KEYS, specFor, type BudgetCategory } from "./specs";
import type { Cell, DocType, DocTypeSpec, ExtractedField, ExtractedRow, ExtractionResult, FieldSpec, FieldValue, RowSpec, Table } from "./types";
import { coerceField, normalizeLabel, parseMonth, parseNumber } from "./values";

const EXACT = 0.92;
const FIELD_FROM_TOTAL_COLUMN = 0.92;
const FIELD_FROM_MONTH_SUM = 0.88;

/** Amounts stored as positive numbers whatever sign the statement uses. */
const ABSOLUTE_FIELDS = new Set<string>([
  ...T12_DEDUCTION_KEYS,
  ...T12_EXPENSE_KEYS,
  "totalOperatingExpenses",
  "capitalExpenditures",
  "realEstateDebt",
  "notesPayable",
  "otherLiabilities",
  "totalLiabilities",
  "contingentLiabilities",
  "annualPersonalDebtService",
  "landCost",
  "hardCosts",
  "softCosts",
  "contingency",
  "developerFee",
  "financingCosts",
  "totalCost",
]);

export function labelScore(label: string, synonym: string): number {
  const l = normalizeLabel(label);
  const s = normalizeLabel(synonym);
  if (!l || !s) return 0;
  if (l === s) return EXACT;
  if (s.length < 4) return 0;
  const padded = ` ${l} `;
  if (!padded.includes(` ${s} `)) return 0;
  // Whole-word containment; closer lengths score higher (0.70..0.85).
  return Math.round((0.7 + 0.15 * (s.length / l.length)) * 1000) / 1000;
}

function bestSynonymScore(label: string, field: FieldSpec): number {
  let best = 0;
  for (const syn of field.synonyms) best = Math.max(best, labelScore(label, syn));
  return best;
}

const isText = (c: Cell): c is string => typeof c === "string" && /[a-z]/i.test(c);
const isNumberish = (c: Cell) => c !== null && parseNumber(c) !== null;

// --- column context (T-12 month / total columns) --------------------------------------

type ColumnContext = { headerRow: number; totalCol: number | null; monthCols: number[]; excluded: Set<number>; months: string[] };

const TOTAL_HEADER = /^(total|annual|annualized|t 12|t12|ttm|trailing 12|trailing twelve|12 month total|12 months|year total|ytd total|full year|actual|actuals)\b/;
const EXCLUDED_HEADER = /\b(per unit|per key|per bed|per sf|psf|pct|percent|of egi|of revenue|of total|budget|variance|var|prior year|py|notes?|comments?)\b|%/;

function columnContext(table: Table): ColumnContext | null {
  const limit = Math.min(table.rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const row = table.rows[r]!;
    const monthCols: number[] = [];
    const months: string[] = [];
    let totalCol: number | null = null;
    const excluded = new Set<number>();
    row.forEach((c, i) => {
      if (i === 0 || c === null) return;
      const month = typeof c === "number" ? parseMonth(c) : isText(c) || /\d/.test(String(c)) ? parseMonth(String(c).trim()) : null;
      if (month) {
        monthCols.push(i);
        months.push(month);
        return;
      }
      if (isText(c)) {
        const n = normalizeLabel(c);
        if (EXCLUDED_HEADER.test(n) || /%/.test(c)) excluded.add(i);
        else if (TOTAL_HEADER.test(n) && totalCol === null) totalCol = i;
      }
    });
    if (monthCols.length >= 3 || totalCol !== null) return { headerRow: r, totalCol, monthCols, excluded, months };
  }
  return null;
}

type Candidate = { table: number; row: number; field: FieldSpec; score: number };

/** GL account codes ("4010", "5100-00") that precede the label in accounting exports. */
const ACCOUNT_CODE = /^\d{3,6}(?:[-.]\d{1,4})?$/;

function rowLabel(row: Cell[]): { label: string; index: number } | null {
  for (let i = 0; i < row.length; i++) {
    const c = row[i] ?? null;
    if (isText(c)) return { label: c, index: i };
    if (c === null) continue;
    if (i < 2 && ACCOUNT_CODE.test(String(c).trim())) continue;
    return null;
  }
  return null;
}

function scalarFromRow(row: Cell[], labelIndex: number, field: FieldSpec, ctx: ColumnContext | null): { value: FieldValue; confidence: number; how: string } | null {
  const after = row.slice(labelIndex + 1);
  // "As of: 12/31/2025" may sit in the label cell itself.
  const own = /:\s*(.+)$/.exec(String(row[labelIndex]))?.[1] ?? null;
  if (field.kind === "string" || field.kind === "date" || field.kind === "month" || field.kind === "boolean") {
    const raw = after.find((c) => c !== null) ?? own;
    let value = coerceField(field, raw).value;
    if (value === null && field.kind === "boolean") value = /\b(yes|gmp|guaranteed maximum price)\b/i.test(String(row[labelIndex])) ? true : null;
    return value === null ? null : { value, confidence: 1, how: "label" };
  }
  if (ctx && ctx.totalCol !== null) {
    const v = coerceField(field, row[ctx.totalCol] ?? null).value;
    if (v !== null) return { value: v, confidence: FIELD_FROM_TOTAL_COLUMN / EXACT, how: "total column" };
  }
  if (ctx && ctx.monthCols.length >= 3) {
    const vals = ctx.monthCols.map((i) => coerceField(field, row[i] ?? null).value).filter((v): v is number => typeof v === "number");
    if (vals.length >= 3) {
      const last12 = vals.slice(-12);
      return { value: last12.reduce((s, v) => s + v, 0), confidence: FIELD_FROM_MONTH_SUM / EXACT, how: `sum of ${last12.length} months` };
    }
  }
  for (let i = row.length - 1; i > labelIndex; i--) {
    if (ctx?.excluded.has(i)) continue;
    const c = row[i] ?? null;
    if (!isNumberish(c)) continue;
    const v = coerceField(field, c).value;
    if (v !== null) return { value: v, confidence: 1, how: "amount" };
  }
  // Durations ("10 years") and amounts inside text ("6.25% fixed", "1.25x").
  const raw = after.find((c) => c !== null) ?? own;
  const got = coerceField(field, raw);
  if (got.value !== null) return { value: got.value, confidence: got.lenient ? 0.95 : 1, how: got.lenient ? "amount in text" : "duration" };
  return null;
}

function finalizeNumber(field: FieldSpec, value: FieldValue): FieldValue {
  if (typeof value === "number" && ABSOLUTE_FIELDS.has(field.key)) return Math.abs(value);
  return value;
}

export type Provenance = Record<string, { table: number; row: number }>;

export function extractScalars(spec: DocTypeSpec, tables: Table[]): { scalars: Record<string, ExtractedField>; contexts: (ColumnContext | null)[]; provenance: Provenance } {
  const contexts = tables.map(columnContext);
  const candidates: Candidate[] = [];
  tables.forEach((table, t) => {
    table.rows.forEach((row, r) => {
      const lab = rowLabel(row);
      if (!lab) return;
      for (const field of spec.scalars) {
        const score = bestSynonymScore(lab.label.replace(/:\s*.+$/, "") || lab.label, field);
        if (score > 0) candidates.push({ table: t, row: r, field, score });
      }
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.table - b.table || a.row - b.row);
  const usedRows = new Set<string>();
  const out: Record<string, ExtractedField> = {};
  const provenance: Provenance = {};
  for (const c of candidates) {
    const rowKey = `${c.table}:${c.row}`;
    if (out[c.field.key] || usedRows.has(rowKey)) continue;
    const row = tables[c.table]!.rows[c.row]!;
    const lab = rowLabel(row)!;
    const got = scalarFromRow(row, lab.index, c.field, contexts[c.table] ?? null);
    if (!got) continue;
    usedRows.add(rowKey);
    provenance[c.field.key] = { table: c.table, row: c.row };
    out[c.field.key] = {
      value: finalizeNumber(c.field, got.value),
      confidence: Math.round(c.score * got.confidence * 1000) / 1000,
      source: "rules",
      evidence: `${tables[c.table]!.name} row ${c.row + 1}: ${lab.label.slice(0, 80)} (${got.how})`,
    };
  }
  // Statement period from month headers (T-12 without a "period ending" line).
  if (spec.docType === "T12") {
    const ctx = contexts.find((c) => c && c.months.length >= 3);
    if (ctx) {
      const months = [...ctx.months].sort();
      if (!out.periodEnd) {
        const last = months[months.length - 1]!;
        const [y, m] = last.split("-").map(Number) as [number, number];
        const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
        out.periodEnd = { value: `${last}-${String(day).padStart(2, "0")}`, confidence: 0.85, source: "computed", evidence: "last month column" };
      }
      if (!out.months) out.months = { value: Math.min(12, months.length), confidence: 0.85, source: "computed", evidence: "month columns" };
    }
  }
  return { scalars: out, contexts, provenance };
}

// --- rows -----------------------------------------------------------------------------------

type HeaderMatch = { table: number; row: number; columns: Map<string, number>; ignored: number[]; exactness: number };

function matchHeader(spec: RowSpec, row: Cell[]): { columns: Map<string, number>; ignored: number[]; exactness: number } | null {
  const ignored: number[] = [];
  const pairs: { col: string; idx: number; score: number }[] = [];
  row.forEach((cell, idx) => {
    if (!isText(cell)) return;
    const n = normalizeLabel(cell);
    if ((spec.ignoredColumns ?? []).some((ig) => n === normalizeLabel(ig) || n.startsWith(`${normalizeLabel(ig)} `)) || /\bname\b/.test(n)) {
      ignored.push(idx);
      return;
    }
    for (const col of spec.columns) {
      const score = bestSynonymScore(cell, col);
      if (score > 0) pairs.push({ col: col.key, idx, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const columns = new Map<string, number>();
  const usedIdx = new Set<number>();
  let total = 0;
  for (const p of pairs) {
    if (columns.has(p.col) || usedIdx.has(p.idx)) continue;
    columns.set(p.col, p.idx);
    usedIdx.add(p.idx);
    total += p.score;
  }
  if (!spec.requiredColumns.every((k) => columns.has(k)) || columns.size < 2) return null;
  return { columns, ignored, exactness: total / columns.size };
}

export function findHeader(spec: RowSpec, tables: Table[]): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  tables.forEach((table, t) => {
    const limit = Math.min(table.rows.length, 40);
    for (let r = 0; r < limit; r++) {
      const m = matchHeader(spec, table.rows[r]!);
      if (m && (!best || m.columns.size > best.columns.size || (m.columns.size === best.columns.size && m.exactness > best.exactness))) {
        best = { table: t, row: r, ...m };
      }
    }
  });
  return best;
}

const STOP_ROW = /^(total|totals|grand total|subtotal|sub total|summary|occupied units|vacant units)\b/;

export function extractRows(spec: RowSpec, tables: Table[]): { rows: ExtractedRow[]; warnings: string[]; header: HeaderMatch | null; consumed: Set<number> } {
  const header = findHeader(spec, tables);
  const warnings: string[] = [];
  const consumed = new Set<number>();
  if (!header) return { rows: [], warnings, header, consumed };
  if (header.ignored.length) warnings.push("personal_columns_ignored");
  const table = tables[header.table]!;
  const rows: ExtractedRow[] = [];
  const confidenceBase = Math.min(0.95, 0.75 + 0.2 * (header.exactness / EXACT));
  let started = false;
  for (let r = header.row + 1; r < table.rows.length; r++) {
    const row = table.rows[r]!;
    if (row.every((c) => c === null)) {
      if (started && spec.key !== "lineItems") break;
      continue;
    }
    const first = rowLabel(row);
    if (first && STOP_ROW.test(normalizeLabel(first.label))) {
      if (spec.key === "lineItems") continue; // subtotals sit between budget sections
      break;
    }
    const values: Record<string, FieldValue> = {};
    for (const col of spec.columns) {
      const idx = header.columns.get(col.key);
      values[col.key] = idx === undefined ? null : finalizeNumber(col, coerceField(col, row[idx] ?? null).value);
    }
    if (!spec.requiredColumns.every((k) => values[k] !== null && values[k] !== "")) continue;
    // A repeated header line (multi-page exports) is not a data row.
    if (matchHeader(spec, row)) continue;
    started = true;
    consumed.add(r);
    rows.push({ values, confidence: Math.round(confidenceBase * 1000) / 1000, source: "rules" });
  }
  return { rows, warnings, header, consumed };
}

// --- per-type post-processing ------------------------------------------------------------

const CATEGORY_RULES: [BudgetCategory, RegExp][] = [
  ["contingency", /\bcontingenc/],
  ["developer_fee", /\b(developer|development)\s+(fee|overhead)\b/],
  ["financing", /\b(interest reserves?|loan fees?|lender fees?|financing( costs?| fees?)?|capitalized interest|construction (loan )?interest|origination( fees?)?|points|commitment fees?|broker fees?)\b/],
  ["reserve", /\b(operating reserves?|lease up reserves?|replacement reserves?|marketing reserves?|working capital)\b/],
  ["land", /\b(land|acquisition|purchase price|site acquisition|ground)\b/],
  [
    "soft",
    /\b(architect|architecture|engineering|engineer|permit|permits|impact fee|impact fees|legal|title|insurance|builders risk|appraisal|environmental|phase i|survey|inspection|plan review|entitlement|consult|accounting|property tax|taxes during|marketing|leasing|soft cost|soft costs|design|geotech|testing|utility connection|tap fees|school fees)\b/,
  ],
  [
    "hard",
    /\b(construction|sitework|site work|building|general contractor|gc|general conditions|contractor fee|contractor s fee|materials|labor|demolition|foundation|framing|mep|plumbing|electrical|hvac|roofing|ff e|ffe|furniture|fixtures|parking|landscaping|gmp|pip|renovation|hard cost|hard costs|interior|exterior|amenit|elevator|paving|concrete)\b/,
  ],
];

export function categorizeBudgetLine(description: string, declared?: FieldValue): { category: BudgetCategory; confident: boolean } {
  if (typeof declared === "string") {
    const n = normalizeLabel(declared).replace(/ /g, "_");
    const direct = BUDGET_CATEGORIES.find((c) => c === n || c.replace("_", "") === n.replace("_", ""));
    if (direct) return { category: direct, confident: true };
    const fromDeclared = CATEGORY_RULES.find(([, re]) => re.test(normalizeLabel(declared)));
    if (fromDeclared) return { category: fromDeclared[0], confident: true };
  }
  const n = normalizeLabel(description);
  const hit = CATEGORY_RULES.find(([, re]) => re.test(n));
  return hit ? { category: hit[0], confident: true } : { category: "hard", confident: false };
}

/** "2x1", "2/1", "2BR/1BA", "2 Bed 1 Bath" -> beds and baths. */
export function bedsBathsFromType(type: string): { beds: number; baths: number } | null {
  const s = type.toLowerCase();
  if (/\bstudio\b|\bjr\b|^0\s*x/.test(s)) {
    const baths = /(\d(?:\.\d)?)\s*(?:ba|bath)/.exec(s);
    return { beds: 0, baths: baths ? Number(baths[1]) : 1 };
  }
  const m = /(\d)\s*(?:br|bd|bed|bedroom)?s?\s*(?:x|\/|-|\s)\s*(\d(?:\.\d)?)\s*(?:ba|bath)?/.exec(s);
  return m ? { beds: Number(m[1]), baths: Number(m[2]) } : null;
}

function postProcessRows(docType: DocType, rows: ExtractedRow[], warnings: string[]): void {
  if (docType === "CONSTRUCTION_BUDGET") {
    let unknown = 0;
    for (const row of rows) {
      const { category, confident } = categorizeBudgetLine(String(row.values.description ?? ""), row.values.category);
      row.values.category = category;
      if (!confident) {
        row.confidence = Math.min(row.confidence, 0.6);
        unknown++;
      }
    }
    if (unknown) warnings.push("budget_lines_uncategorized");
  }
  if (docType === "RENT_ROLL") {
    for (const row of rows) {
      if ((row.values.beds === null || row.values.baths === null) && typeof row.values.unitType === "string") {
        const bb = bedsBathsFromType(row.values.unitType);
        if (bb) {
          row.values.beds ??= bb.beds;
          row.values.baths ??= bb.baths;
        }
      }
    }
  }
}

/** Rules extraction over parsed tables. */
export function extractWithRules(docType: DocType, tables: Table[]): ExtractionResult {
  const spec = specFor(docType);
  const { scalars, provenance } = extractScalars(spec, tables);
  const warnings: string[] = [];
  let rows: ExtractedRow[] = [];
  if (spec.rows) {
    const got = extractRows(spec.rows, tables);
    rows = got.rows;
    warnings.push(...got.warnings);
    // The header row and the data rows are not scalar labels: a budget line
    // "Interest reserve" is a row, not the financing-costs total.
    if (got.header) {
      for (const [k, at] of Object.entries(provenance)) {
        if (at.table === got.header.table && (at.row === got.header.row || got.consumed.has(at.row))) delete scalars[k];
      }
    }
    postProcessRows(docType, rows, warnings);
  }
  return { docType, scalars, rows, warnings };
}
