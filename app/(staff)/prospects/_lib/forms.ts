// Form parsing for the prospects desk. Pure, so it is unit tested without a server.

import { z } from "zod";
import { INTEL_LIMITS, OUTREACH_CHANNELS, PROPERTY_TYPES, PROSPECT_PROGRAMS, PROSPECT_STATUSES, SUPPRESSION_KINDS, SUPPRESSION_REASONS, WINDOW_BUCKETS, type IntelDraft, type IntelEdit, type OutreachChannel, type PropertyType, type ProspectStatus, type StaffProspectEdit } from "@/lib/agents/intel/types";
import type { MaturityQuery } from "@/lib/agents/intel/maturity";
import type { ProspectFilter } from "@/lib/agents/intel/prospect-store";

export class FormInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormInputError";
  }
}

export const str = (f: FormData, k: string): string => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idOf(f: FormData, k = "id"): string {
  const v = str(f, k);
  if (!UUID.test(v)) throw new FormInputError("That record could not be found. Reload the page and try again.");
  return v;
}

/** ZIP codes separated by commas, spaces or new lines. */
export function parseZips(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((z) => z.trim()).filter(Boolean))];
}

const num = (f: FormData, k: string, fallback?: number): number => {
  const raw = str(f, k);
  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw new FormInputError(`${k} is missing`);
  }
  const n = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) throw new FormInputError(`${k} must be a number`);
  return n;
};

export function scanQueryFromForm(f: FormData): MaturityQuery {
  const types = f.getAll("propertyType").filter((v): v is PropertyType => typeof v === "string" && (PROPERTY_TYPES as readonly string[]).includes(v));
  const minLoan = str(f, "minLoanAmount");
  return {
    zips: parseZips(str(f, "zips")),
    fromMonths: num(f, "fromMonths", 0),
    toMonths: num(f, "toMonths", 18),
    ...(types.length ? { propertyTypes: types } : {}),
    ...(minLoan ? { minLoanAmount: num(f, "minLoanAmount") } : {}),
  };
}

const optional = <T extends string>(v: string, allowed: readonly T[]): T | undefined => ((allowed as readonly string[]).includes(v) ? (v as T) : undefined);

/** List filters from the query string. Unknown values are ignored. */
export function filterFromSearch(sp: Record<string, string | string[] | undefined>): ProspectFilter & { status?: ProspectStatus | "active" } {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const minScore = Number(one("minScore"));
  return {
    status: one("status") === "active" || !one("status") ? "active" : optional(one("status"), PROSPECT_STATUSES),
    ...(optional(one("program"), PROSPECT_PROGRAMS) ? { program: optional(one("program"), PROSPECT_PROGRAMS)! } : {}),
    ...(optional(one("window"), WINDOW_BUCKETS) ? { window: optional(one("window"), WINDOW_BUCKETS)! } : {}),
    ...(one("minScore") && Number.isFinite(minScore) ? { minScore: Math.max(0, Math.min(100, Math.round(minScore))) } : {}),
    ...(one("q") ? { q: one("q").slice(0, 80) } : {}),
    limit: 200,
  };
}

export function staffEditFromForm(f: FormData): StaffProspectEdit {
  const status = optional(str(f, "status"), PROSPECT_STATUSES);
  return {
    contactName: str(f, "contactName") || null,
    contactEmail: str(f, "contactEmail") || null,
    assignedTo: str(f, "assignedTo") || null,
    notes: str(f, "notes") || null,
    ...(status ? { status } : {}),
  };
}

export function channelFromForm(f: FormData): OutreachChannel {
  const c = optional(str(f, "channel"), OUTREACH_CHANNELS);
  if (!c) throw new FormInputError("Choose email or letter");
  return c;
}

export const suppressionSchema = z.object({
  kind: z.enum(SUPPRESSION_KINDS),
  value: z.string().trim().min(1, "Enter the value to suppress").max(320),
  reason: z.enum(SUPPRESSION_REASONS),
});

/**
 * Applies a staff edit to a draft's text. The structure is the stored one:
 * sections and the signals each bullet cites are fixed, so an edit can fix
 * wording or drop a bullet (clear its text) but never invent a citation.
 */
export function intelEditFromForm(f: FormData, draft: Pick<IntelDraft, "sections">): IntelEdit {
  const headline = str(f, "headline");
  const summary = str(f, "summary");
  if (!headline) throw new FormInputError("The headline cannot be empty");
  if (!summary) throw new FormInputError("The summary cannot be empty");
  const sections = draft.sections
    .map((s, i) => ({
      title: str(f, `section-${i}-title`) || s.title,
      bullets: s.bullets.map((b, j) => ({ text: str(f, `bullet-${i}-${j}`), signalIds: b.signalIds })).filter((b) => b.text),
    }))
    .filter((s) => s.bullets.length);
  if (!sections.length) throw new FormInputError("Keep at least one bullet");
  return { headline: headline.slice(0, INTEL_LIMITS.headline), summary, sections };
}
