// Row mapping for the submission tables (deal_submission_profiles,
// deal_sponsor_profiles, deal_summaries). Columns are the snake_case of the
// record keys, as everywhere on the deal desk (lib/deals/rows.ts); jsonb
// values pass through untouched. Reads name their columns explicitly, so a
// column added later is never selected (or returned) by accident.

import { fromRow, toRow, type Row } from "../rows";
import { PROFILE_NUMBER_LIMITS, SPONSOR_NUMBER_LIMITS } from "./schema";
import {
  blankSponsorProfileFields,
  blankSubmissionProfileFields,
  type DealSummaryRecord,
  type SponsorProfile,
  type SponsorProfileFields,
  type SubmissionProfile,
  type SubmissionProfileFields,
} from "./types";

export type { Row };

export const snakeColumn = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const META_KEYS = ["id", "dealId", "createdAt", "createdBy", "updatedAt", "updatedBy", "recordVersion"] as const;

/** Profile record keys in column order (meta, then SubmissionProfileFields). */
export const PROFILE_KEYS: readonly (keyof SubmissionProfile)[] = [...META_KEYS, ...(Object.keys(blankSubmissionProfileFields("bridge")) as (keyof SubmissionProfileFields)[])];
export const SPONSOR_KEYS: readonly (keyof SponsorProfile)[] = [...META_KEYS, ...(Object.keys(blankSponsorProfileFields()) as (keyof SponsorProfileFields)[])];
export const SUMMARY_KEYS: readonly (keyof DealSummaryRecord)[] = [
  "id",
  "dealId",
  "createdAt",
  "createdBy",
  "asOf",
  "playbook",
  "targetStage",
  "templateVersion",
  "spec",
  "specSha256",
  "pdfSha256",
  "pdfStoragePath",
  "profileVersion",
  "sponsorVersion",
];

/** PostgREST select lists. */
export const PROFILE_COLUMNS = PROFILE_KEYS.map(snakeColumn).join(", ");
export const SPONSOR_COLUMNS = SPONSOR_KEYS.map(snakeColumn).join(", ");
export const SUMMARY_COLUMNS = SUMMARY_KEYS.map(snakeColumn).join(", ");

// bigint and numeric columns can arrive as strings; integers as numbers.
const PROFILE_NUMBERS = [...Object.keys(PROFILE_NUMBER_LIMITS), "recordVersion"];
const SPONSOR_NUMBERS = [...Object.keys(SPONSOR_NUMBER_LIMITS), "recordVersion"];
const SUMMARY_NUMBERS = ["profileVersion", "sponsorVersion"];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : String(v));
const day = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : (DATE_ONLY.exec(String(v))?.[0] ?? String(v)));

const PROFILE_DATES = ["targetCloseDate", "existingMaturityDate", "occupancyAsOf", "purchaseCloseDate", "asIsValueAsOf", "noiPeriodEnd"] as const;

function withMeta<T extends { createdAt: string; updatedAt?: string }>(r: T): T {
  const out = { ...r, createdAt: iso(r.createdAt) };
  if ("updatedAt" in r) (out as { updatedAt: string }).updatedAt = iso(r.updatedAt);
  return out;
}

export function profileFromRow(row: Row): SubmissionProfile {
  const p = withMeta(fromRow<SubmissionProfile>(row, PROFILE_NUMBERS));
  for (const k of PROFILE_DATES) (p as Record<string, unknown>)[k] = day(p[k]);
  return { ...p, highlights: p.highlights ?? [], risks: p.risks ?? [], sources: p.sources ?? [], uses: p.uses ?? [], programDetails: p.programDetails ?? {}, fieldSources: p.fieldSources ?? {}, maskAddress: Boolean(p.maskAddress) };
}

export function sponsorFromRow(row: Row): SponsorProfile {
  const s = withMeta(fromRow<SponsorProfile>(row, SPONSOR_NUMBERS));
  return { ...s, statedAsOf: day(s.statedAsOf), creditEvents: s.creditEvents ?? {} };
}

export function summaryFromRow(row: Row): DealSummaryRecord {
  const s = fromRow<DealSummaryRecord>(row, SUMMARY_NUMBERS);
  return { ...s, createdAt: iso(s.createdAt), asOf: day(s.asOf) ?? "" };
}

/** Columns for an insert or update. Only keys present in `fields` are written. */
export function profileToRow(fields: Partial<SubmissionProfileFields>): Row {
  return toRow(fields);
}

export function sponsorToRow(fields: Partial<SponsorProfileFields>): Row {
  return toRow(fields);
}

export function summaryToRow(s: Omit<DealSummaryRecord, "id" | "createdAt">): Row {
  return toRow(s);
}
