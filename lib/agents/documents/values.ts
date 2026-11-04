// Parsing helpers for cell values: money, percentages, dates and labels as they
// appear in operating statements, rent rolls and term sheets.

import type { Cell, FieldKind, FieldSpec, FieldValue } from "./types";

/** Lower-case, alphanumerics only, single spaces ("G&A" -> "g a", "R&M:" -> "r m"). */
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MULTIPLIER: Record<string, number> = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, bn: 1e9 };

/**
 * Parses "$1,234.56", "(1,234)", "-1,234", "1.2M", "12.5%", "1,234 CR".
 * Returns null for text that is not a number. Percent signs are reported so the
 * caller can scale.
 */
export function parseNumber(input: Cell): { value: number; percent: boolean } | null {
  if (input === null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? { value: input, percent: false } : null;
  let s = input.trim();
  if (!s || s === "-" || s === "—" || s === "–") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (/\bcr$/i.test(s)) {
    negative = true;
    s = s.replace(/\s*cr$/i, "");
  }
  s = s.replace(/^(usd|us\$|\$)\s*/i, "").replace(/\s*(usd)$/i, "");
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/^\$\s*/, "");
  const percent = s.endsWith("%");
  if (percent) s = s.slice(0, -1).trim();
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?\s*(k|m|mm|b|bn)?$/i.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  let value = Number(`${(m[1] ?? "0").replace(/,/g, "")}${m[2] ?? ""}`);
  if (m[3]) value *= MULTIPLIER[m[3].toLowerCase()] ?? 1;
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, percent };
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Excel serial date (1900 system) to ISO; only for plausible serials (1982..2064). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 30_000 || serial > 60_000) return null;
  const ms = Math.round((serial - 25_569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

const year4 = (y: number) => (y < 100 ? 2000 + y : y);

/**
 * Parses "12/31/2025", "2025-12-31", "Dec 31, 2025", "December 2025",
 * "Dec-25", "2025-12" and Excel serials. Month-only inputs resolve to the last
 * day of the month (period ends) unless `firstDay` is set.
 */
export function parseDate(input: Cell, opts: { firstDay?: boolean } = {}): string | null {
  if (input === null) return null;
  if (typeof input === "number") return excelSerialToIso(input);
  const s = input.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s].*)?$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return validYmd(year4(Number(m[3])), Number(m[1]), Number(m[2]));
  m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1]!]) return validYmd(Number(m[3]), MONTHS[m[1]!]!, Number(m[2]));
  m = /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2]!]) return validYmd(Number(m[3]), MONTHS[m[2]!]!, Number(m[1]));
  const month = parseMonth(s);
  if (month) {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    return validYmd(y, mo, opts.firstDay ? 1 : lastDay(y, mo));
  }
  return null;
}

/** "2025-12", "Dec 2025", "Dec-25", "December '25", "12/2025", Excel serials -> "YYYY-MM". */
export function parseMonth(input: Cell): string | null {
  if (input === null) return null;
  if (typeof input === "number") return excelSerialToIso(input)?.slice(0, 7) ?? null;
  const s = input.trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${pad(Number(m[2]))}`;
  m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${pad(Number(m[1]))}`;
  m = /^([a-z]{3,9})\.?[\s-]*'?(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS[m[1]!]) return `${year4(Number(m[2]))}-${pad(MONTHS[m[1]!]!)}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return null;
}

/** Durations: "10 years" -> 10 (years), "120 months" -> 120 (months), per the target unit. */
export function parseDuration(input: Cell, unit: "years" | "months"): number | null {
  if (input === null) return null;
  if (typeof input === "number") return input;
  const s = input.toLowerCase();
  if (/interest[\s-]*only|\bio\b|none|n\/a/.test(s) && unit === "years" && !/\d/.test(s)) return 0;
  const m = /(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|mo)\b/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const isYears = /^y/.test(m[2]!);
    if (unit === "years") return isYears ? n : n / 12;
    return isYears ? n * 12 : n;
  }
  const plain = parseNumber(s.split(/\s/)[0] ?? "");
  return plain ? plain.value : null;
}

function parseBoolean(input: Cell): boolean | null {
  if (input === null) return null;
  if (typeof input === "number") return input !== 0;
  const s = input.trim().toLowerCase();
  if (/^(y|yes|true|x|gmp|included)$/.test(s)) return true;
  if (/^(n|no|false|none|n\/a)$/.test(s)) return false;
  return null;
}

/**
 * Coerces a raw cell to a field kind. Percent kinds take "92%", "92" or "0.92"
 * and return a fraction; rate kinds take "6.25%", "6.25" or "0.0625" and
 * return percentage points.
 */
export function coerceValue(kind: FieldKind, input: Cell): FieldValue {
  if (input === null || (typeof input === "string" && !input.trim())) return null;
  switch (kind) {
    case "money":
    case "number": {
      const n = parseNumber(input);
      return n ? n.value : null;
    }
    case "integer": {
      const n = parseNumber(input);
      return n ? Math.round(n.value) : null;
    }
    case "percent": {
      const n = parseNumber(input);
      if (!n) return null;
      if (n.percent || Math.abs(n.value) > 1.5) return n.value / 100;
      return n.value;
    }
    case "rate": {
      const n = parseNumber(input);
      if (!n) return null;
      if (!n.percent && Math.abs(n.value) < 0.3) return round(n.value * 100, 6);
      return n.value;
    }
    case "date":
      return parseDate(input);
    case "month":
      return parseMonth(input);
    case "boolean":
      return parseBoolean(input);
    case "string": {
      const s = String(input).trim().replace(/\s+/g, " ");
      return s ? s.slice(0, 300) : null;
    }
  }
}

/** The first amount in free text: "6.25% fixed" -> "6.25%", "1.25x" -> "1.25", "425 bps" -> "425". */
export function firstNumberIn(s: string): string | null {
  const m = /\(?-?\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:%|mm\b|m\b|k\b)?\)?/i.exec(s);
  return m ? m[0].trim() : null;
}

/**
 * Coerces a raw cell for a field: durations in the field's unit, then the
 * plain kind, then (for numeric kinds) the first amount inside free text.
 * `lenient` reports that the last step was needed.
 */
export function coerceField(field: Pick<FieldSpec, "kind" | "unit">, input: Cell): { value: FieldValue; lenient: boolean } {
  if (field.unit && typeof input === "string" && /[a-z]/i.test(input)) {
    const d = parseDuration(input, field.unit);
    if (d !== null) return { value: field.kind === "integer" ? Math.round(d) : d, lenient: false };
  }
  const value = coerceValue(field.kind, input);
  if (value !== null || typeof input !== "string") return { value, lenient: false };
  if (!["money", "number", "integer", "percent", "rate"].includes(field.kind)) return { value, lenient: false };
  const token = firstNumberIn(input);
  return token ? { value: coerceValue(field.kind, token), lenient: true } : { value: null, lenient: false };
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** True when two amounts agree within `tolerance` (relative) or $1. */
export function agrees(a: number, b: number, tolerance = 0.005): boolean {
  const diff = Math.abs(a - b);
  return diff <= 1 || diff <= tolerance * Math.max(Math.abs(a), Math.abs(b));
}

/** Strips digit runs that look like account, routing, SSN or card numbers from free text. */
export function scrubIdentifiers(s: string): string {
  return s
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted]")
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, "[redacted]")
    .replace(/\b\d{8,17}\b/g, "[redacted]");
}
