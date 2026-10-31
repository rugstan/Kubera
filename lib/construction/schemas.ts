// Input validation for the construction desk. Form fields arrive as strings;
// blank strings become null so optional inputs behave the same from forms and code.

import { z } from "zod";
import { normalizeLicenseNumber } from "./cslb";
import { ASSET_TYPES, CONSTRUCTION_PROGRAMS, HUD_COST_CERT_STATUSES, PAYOFF_STATUSES, PROJECT_PHASES, TAKEOUT_PATHS } from "./types";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const text = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional().transform((v) => v ?? null));

const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);

export const uuidOrNull = z.preprocess(
  blankToNull,
  z.uuid("Must be a valid id").nullable().optional().transform((v) => v ?? null),
);

const civilDate = z.preprocess(
  blankToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Not a real date")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
);

const count = (max = 100_000) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v)) : v),
    z.number().int("Whole number").min(0).max(max).nullable().optional().transform((v) => v ?? null),
  );

const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

const optionalLicense = z.preprocess(
  blankToNull,
  z
    .string()
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v == null) return null;
      const n = normalizeLicenseNumber(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "CSLB license numbers are 1 to 8 digits" });
        return z.NEVER;
      }
      return n;
    }),
);

export const projectInputSchema = z.object({
  name: requiredText(200),
  dealId: uuidOrNull,
  leadId: uuidOrNull,
  program: z.enum(CONSTRUCTION_PROGRAMS),
  assetType: z.enum(ASSET_TYPES),
  propertyAddress: text(300),
  city: text(120),
  state: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Two-letter state")
      .transform((s) => s.toUpperCase())
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  ),
  zip: z.preprocess(blankToNull, z.string().trim().regex(/^\d{5}(-\d{4})?$/, "ZIP code").nullable().optional().transform((v) => v ?? null)),
  units: count(),
  seismicZone: checkbox,
  newConstruction: checkbox,
  generalContractorName: text(200),
  generalContractorLicense: optionalLicense,
  notes: text(4000),
});
export type ProjectInput = z.output<typeof projectInputSchema>;

export const vendorSchema = z.object({
  vendorName: requiredText(200),
  vendorEmail: z.preprocess(blankToNull, z.email("Vendor email").nullable().optional().transform((v) => v ?? null)),
  vendorReference: text(120),
});
export type VendorInput = z.output<typeof vendorSchema>;

export const reportUpdateSchema = z.object({
  vendorReference: text(120),
  documentId: uuidOrNull,
  notes: text(2000),
});
export type ReportUpdateInput = z.output<typeof reportUpdateSchema>;

export const conversionSchema = z.object({
  coDate: civilDate,
  unitsTotal: count(),
  loanMaturityDate: civilDate,
  extensionDeadline: civilDate,
  takeoutPath: z.enum(TAKEOUT_PATHS).optional(),
  hudCostCertStatus: z.enum(HUD_COST_CERT_STATUSES).optional(),
  payoffStatus: z.enum(PAYOFF_STATUSES).optional(),
  payoffTargetDate: civilDate,
  notes: text(2000),
});
export type ConversionInput = z.output<typeof conversionSchema>;

const money = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v.replaceAll(",", ""))) : v),
  z.number().min(0).max(1_000_000_000).nullable().optional().transform((v) => v ?? null),
);

export const snapshotSchema = z.object({
  asOf: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")),
  unitsLeased: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(0).max(100_000)),
  unitsOccupied: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(0).max(100_000)),
  avgMonthlyRent: money,
  noiT3Annualized: money,
});
export type SnapshotInput = z.output<typeof snapshotSchema>;

export const phaseSchema = z.enum(PROJECT_PHASES);
