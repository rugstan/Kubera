// Cross-checks per document type. A check that agrees raises confidence of
// the fields it covers; one that disagrees lowers it (and so sends them to
// review) and adds a warning. Missing totals are computed from their parts and
// marked `computed`.

import { T12_DEDUCTION_KEYS, T12_EXPENSE_KEYS, T12_INCOME_KEYS, specFor } from "./specs";
import { REVIEW_THRESHOLD, type ExtractedField, type ExtractionResult, type FieldSpec, type FieldValue } from "./types";
import { agrees, round, scrubIdentifiers } from "./values";

const AGREE_BOOST = 0.05;
const DISAGREE_CAP = 0.5;
const CONFIDENCE_CAP = 0.99;

type Fields = Record<string, ExtractedField>;

const num = (f: Fields, k: string): number | null => (typeof f[k]?.value === "number" ? (f[k]!.value as number) : null);

function boost(f: Fields, keys: string[]) {
  for (const k of keys) if (f[k] && f[k]!.source !== "reviewer") f[k]!.confidence = Math.min(CONFIDENCE_CAP, round(f[k]!.confidence + AGREE_BOOST, 3));
}
function cap(f: Fields, keys: string[]) {
  for (const k of keys) if (f[k] && f[k]!.source !== "reviewer") f[k]!.confidence = Math.min(f[k]!.confidence, DISAGREE_CAP);
}
function computed(f: Fields, key: string, value: number, parts: string[], evidence: string) {
  const confs = parts.map((p) => f[p]?.confidence ?? 1);
  f[key] = { value: round(value, 2), confidence: round(Math.min(...confs, 0.95) * 0.95, 3), source: "computed", evidence };
}

/** Checks `total ≈ Σ parts` (when both sides exist) or computes the total. */
function checkSum(f: Fields, total: string, parts: string[], warnings: string[], label: string, minParts = 1, signs?: Record<string, number>) {
  const present = parts.filter((p) => num(f, p) !== null);
  if (present.length < minParts) return;
  const sum = present.reduce((s, p) => s + num(f, p)! * (signs?.[p] ?? 1), 0);
  const t = num(f, total);
  if (t === null) {
    computed(f, total, sum, present, `computed: ${label}`);
    return;
  }
  if (agrees(t, sum, 0.01)) boost(f, [total, ...present]);
  else {
    cap(f, [total]);
    warnings.push(`${label}_mismatch`);
  }
}

function validateT12(r: ExtractionResult) {
  const f = r.scalars;
  const signs: Record<string, number> = {};
  for (const k of T12_DEDUCTION_KEYS) signs[k] = -1;
  checkSum(f, "effectiveGrossIncome", [...T12_INCOME_KEYS, ...T12_DEDUCTION_KEYS], r.warnings, "egi", 1, signs);
  checkSum(f, "totalOperatingExpenses", [...T12_EXPENSE_KEYS], r.warnings, "opex", 2);
  const egi = num(f, "effectiveGrossIncome");
  const opex = num(f, "totalOperatingExpenses");
  if (egi !== null && opex !== null) {
    const noi = num(f, "noi");
    if (noi === null) computed(f, "noi", egi - opex, ["effectiveGrossIncome", "totalOperatingExpenses"], "computed: EGI - total operating expenses");
    else if (agrees(noi, egi - opex, 0.01)) boost(f, ["noi"]);
    else {
      cap(f, ["noi"]);
      r.warnings.push("noi_mismatch");
    }
  }
  const months = num(f, "months");
  if (months !== null && (months < 1 || months > 12)) {
    cap(f, ["months"]);
    r.warnings.push("months_out_of_range");
  }
  if (months !== null && months < 12) r.warnings.push("partial_year_statement");
}

function validateRentRoll(r: ExtractionResult) {
  const total = num(r.scalars, "totalUnits");
  if (!r.rows.length) {
    r.warnings.push("no_unit_rows");
    return;
  }
  if (total === null) r.scalars.totalUnits = { value: r.rows.length, confidence: 0.9, source: "computed", evidence: "unit rows" };
  else if (total !== r.rows.length) {
    cap(r.scalars, ["totalUnits"]);
    r.warnings.push("unit_count_mismatch");
  } else boost(r.scalars, ["totalUnits"]);
  for (const row of r.rows) {
    const m = row.values.marketRent;
    const p = row.values.inPlaceRent;
    if (typeof m === "number" && typeof p === "number" && m > 0 && (p > m * 3 || p < 0)) row.confidence = Math.min(row.confidence, DISAGREE_CAP);
  }
}

function validateStr(r: ExtractionResult) {
  if (!r.rows.length) r.warnings.push("no_month_rows");
  let bad = 0;
  for (const row of r.rows) {
    const { occupancy: o, adr: a, revpar: rp } = row.values;
    if (typeof o === "number" && (o < 0 || o > 1)) {
      row.confidence = Math.min(row.confidence, DISAGREE_CAP);
      bad++;
    }
    if (typeof o === "number" && typeof a === "number" && typeof rp === "number" && !agrees(rp, o * a, 0.02)) {
      row.confidence = Math.min(row.confidence, DISAGREE_CAP);
      bad++;
    }
  }
  if (bad) r.warnings.push("str_revpar_mismatch");
}

function validateCensus(r: ExtractionResult) {
  if (!r.rows.length) r.warnings.push("no_census_rows");
}

function validatePfs(r: ExtractionResult) {
  const f = r.scalars;
  checkSum(f, "totalAssets", ["cashOnHand", "marketableSecurities", "retirementAccounts", "realEstateValue", "businessInterests", "otherAssets"], r.warnings, "assets", 2);
  checkSum(f, "totalLiabilities", ["realEstateDebt", "notesPayable", "otherLiabilities"], r.warnings, "liabilities", 1);
  const a = num(f, "totalAssets");
  const l = num(f, "totalLiabilities");
  if (a !== null && l !== null) {
    const nw = num(f, "netWorth");
    if (nw === null) computed(f, "netWorth", a - l, ["totalAssets", "totalLiabilities"], "computed: assets - liabilities");
    else if (agrees(nw, a - l, 0.005)) boost(f, ["netWorth"]);
    else {
      cap(f, ["netWorth"]);
      r.warnings.push("net_worth_mismatch");
    }
  }
}

const BUDGET_SCALAR_BY_CATEGORY: Record<string, string> = {
  land: "landCost",
  hard: "hardCosts",
  soft: "softCosts",
  contingency: "contingency",
  developer_fee: "developerFee",
  financing: "financingCosts",
};

function validateBudget(r: ExtractionResult) {
  const f = r.scalars;
  if (r.rows.length) {
    const byCat: Record<string, number> = {};
    for (const row of r.rows) {
      if (typeof row.values.amount !== "number") continue;
      const c = String(row.values.category ?? "hard");
      byCat[c] = (byCat[c] ?? 0) + row.values.amount;
    }
    for (const [cat, key] of Object.entries(BUDGET_SCALAR_BY_CATEGORY)) {
      const sum = byCat[cat];
      if (sum === undefined) continue;
      const v = num(f, key);
      const rowConf = Math.min(...r.rows.filter((x) => x.values.category === cat).map((x) => x.confidence));
      if (v === null) f[key] = { value: round(sum, 2), confidence: round(Math.min(rowConf, 0.95) * 0.95, 3), source: "computed", evidence: `sum of ${cat} lines` };
      else if (agrees(v, sum, 0.005)) boost(f, [key]);
      else {
        cap(f, [key]);
        r.warnings.push(`budget_${cat}_mismatch`);
      }
    }
    if (byCat.reserve) r.warnings.push("budget_has_reserves");
  }
  // Reserves are part of total cost but have no scalar of their own.
  const reserves = r.rows.filter((x) => x.values.category === "reserve" && typeof x.values.amount === "number").reduce((s, x) => s + (x.values.amount as number), 0);
  const parts = ["landCost", "hardCosts", "softCosts", "contingency", "developerFee", "financingCosts"];
  const present = parts.filter((p) => num(f, p) !== null);
  if (present.length >= 2) {
    const sum = present.reduce((s, p) => s + num(f, p)!, 0) + reserves;
    const t = num(f, "totalCost");
    if (t === null) computed(f, "totalCost", sum, present, "computed: sum of budget categories");
    else if (agrees(t, sum, 0.005)) boost(f, ["totalCost", ...present]);
    else {
      cap(f, ["totalCost"]);
      r.warnings.push("budget_total_mismatch");
    }
  }
}

function validateTermSheet(r: ExtractionResult) {
  const f = r.scalars;
  const rate = num(f, "interestRatePct");
  if (rate !== null && (rate <= 0 || rate > 30)) {
    cap(f, ["interestRatePct"]);
    r.warnings.push("rate_out_of_range");
  }
  const ltv = num(f, "maxLtv");
  if (ltv !== null && (ltv <= 0 || ltv > 1)) {
    cap(f, ["maxLtv"]);
    r.warnings.push("ltv_out_of_range");
  }
  const dscr = num(f, "minDscr");
  if (dscr !== null && (dscr < 0.8 || dscr > 3)) {
    cap(f, ["minDscr"]);
    r.warnings.push("dscr_out_of_range");
  }
}

/** Personal identifiers never survive into stored string fields. */
function scrubStrings(r: ExtractionResult) {
  const spec = specFor(r.docType);
  const scrub = (field: FieldSpec | undefined, v: FieldValue): FieldValue => (field?.kind === "string" && typeof v === "string" ? scrubIdentifiers(v) : v);
  for (const field of spec.scalars) {
    const cur = r.scalars[field.key];
    if (cur) cur.value = scrub(field, cur.value);
  }
  if (spec.rows) for (const row of r.rows) for (const col of spec.rows.columns) row.values[col.key] = scrub(col, row.values[col.key] ?? null);
  for (const v of Object.values(r.scalars)) if (v.evidence) v.evidence = scrubIdentifiers(v.evidence).slice(0, 200);
}

export function validateExtraction(result: ExtractionResult): ExtractionResult {
  const r: ExtractionResult = {
    docType: result.docType,
    scalars: Object.fromEntries(Object.entries(result.scalars).map(([k, v]) => [k, { ...v }])),
    rows: result.rows.map((row) => ({ ...row, values: { ...row.values } })),
    warnings: [...result.warnings],
  };
  switch (r.docType) {
    case "T12":
      validateT12(r);
      break;
    case "RENT_ROLL":
      validateRentRoll(r);
      break;
    case "STR":
      validateStr(r);
      break;
    case "CENSUS":
      validateCensus(r);
      break;
    case "PFS":
      validatePfs(r);
      break;
    case "CONSTRUCTION_BUDGET":
      validateBudget(r);
      break;
    case "TERM_SHEET":
      validateTermSheet(r);
      break;
  }
  scrubStrings(r);
  r.warnings = [...new Set(r.warnings)];
  return r;
}

export type Assessment = {
  status: "extracted" | "needs_review";
  overallConfidence: number;
  lowConfidenceFields: string[];
};

/**
 * Which fields need a human: non-null values under the threshold, missing
 * required fields, low-confidence rows (as `rows[i]`), and any warning.
 */
export function assessExtraction(r: ExtractionResult): Assessment {
  const spec = specFor(r.docType);
  const low: string[] = [];
  const confs: number[] = [];
  for (const field of spec.scalars) {
    const v = r.scalars[field.key];
    if (!v || v.value === null) {
      if (field.required) low.push(field.key);
      continue;
    }
    confs.push(v.confidence);
    if (v.confidence < REVIEW_THRESHOLD) low.push(field.key);
  }
  r.rows.forEach((row, i) => {
    confs.push(row.confidence);
    if (row.confidence < REVIEW_THRESHOLD) low.push(`${spec.rows?.key ?? "rows"}[${i}]`);
  });
  if (spec.rows && !spec.rows.optional && !r.rows.length) low.push(spec.rows.key);
  const requiredMissing = spec.scalars.filter((s) => s.required && (r.scalars[s.key]?.value ?? null) === null).length;
  const mean = confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : 0;
  const overall = round(Math.max(0, Math.min(1, mean - 0.1 * requiredMissing)), 3);
  return {
    status: low.length || r.warnings.some((w) => !INFORMATIONAL_WARNINGS.has(w)) ? "needs_review" : "extracted",
    overallConfidence: overall,
    lowConfidenceFields: low,
  };
}

/** Warnings that do not by themselves need a reviewer. */
export const INFORMATIONAL_WARNINGS = new Set(["personal_columns_ignored", "partial_year_statement", "budget_has_reserves", "pdf_text_layer_unreadable"]);
