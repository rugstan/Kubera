// Display formatting for the submission editor, preview and summary (pure, so
// server and client components share it and it is unit tested). Units follow
// lib/deals/submission/types.ts: money in integer cents, percentages 0–100,
// ratios as plain numbers, dates "YYYY-MM-DD".

import { FIELD_SOURCE_LABELS, METRIC_UNITS, type FieldSource, type IsoDate, type Metric, type MetricInput, type MetricUnit } from "@/lib/deals/submission/types";

const wholeUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const centsUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** "$1,250,000" for whole dollars, "$1,250,000.50" otherwise. */
export function usd(cents: number): string {
  return cents % 100 === 0 ? wholeUsd.format(cents / 100) : centsUsd.format(cents / 100);
}

/** Cents as the dollars a staff member types back into a form ("1250000" or "1250000.5"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
  return neg ? `-${s}` : s;
}

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function ratio(n: number): string {
  return `${n.toFixed(2)}x`;
}

export function count(n: number): string {
  return plain.format(n);
}

/** "Sep 30, 2026" from "2026-09-30" (or an ISO timestamp); the input itself when it does not parse. */
export function date(iso: IsoDate | string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatUnit(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "pct":
      return pct(value);
    case "x":
      return ratio(value);
    case "cents":
      return usd(Math.round(value));
    case "months":
      return `${count(value)} months`;
    case "weeks":
      return `${count(value)} weeks`;
    case "count":
      return count(value);
  }
}

/** A metric's value in its fixed unit, or null when an input is missing (never a zero or a guess). */
export function metricValue(m: Pick<Metric, "key" | "value">): string | null {
  return m.value === null ? null : formatUnit(m.value, METRIC_UNITS[m.key]);
}

/** A metric input's value, formatted by what the input is (money, a rate, months, a ratio). */
export function formatMetricInput(i: Pick<MetricInput, "field" | "value">): string {
  if (i.value === null) return "missing";
  if (/Cents$|^deal\.loan|^uses$|^sources$|totalCost|arv|\.pip$/i.test(i.field)) return usd(Math.round(i.value));
  if (/Pct$/.test(i.field)) return pct(i.value, 2);
  if (/Months$/.test(i.field)) return `${count(i.value)} months`;
  if (/global_cash_flow/.test(i.field)) return ratio(i.value);
  return count(i.value);
}

/** "Needs: as-is value, loan amount" for a metric whose inputs are missing. */
export function needsLine(m: Pick<Metric, "missing">): string {
  return m.missing.length ? `Needs: ${m.missing.join(", ")}` : "Needs more inputs";
}

/**
 * The short tag shown beside a stored value: "Per borrower", "From document
 * (Sep 30, 2026)", "From spread (Oct 20, 2026)", "From Corin record", "Public
 * record" or "Entered". A value with no source entry counts as entered.
 */
export function sourceLabel(source: FieldSource | null | undefined): string {
  if (!source) return FIELD_SOURCE_LABELS.entered;
  switch (source.source) {
    case "document":
    case "spread":
      return source.asOf ? `${FIELD_SOURCE_LABELS[source.source]} (${date(source.asOf)})` : FIELD_SOURCE_LABELS[source.source];
    case "record":
      return source.record === "hm_underwriting" ? "From the hard money file" : source.record === "construction_projects" ? "From the construction project" : "From the principals file";
    default:
      return FIELD_SOURCE_LABELS[source.source];
  }
}

/** The tag for a computed figure. */
export const CORIN_CALCULATION = "Corin calculation";
