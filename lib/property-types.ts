// The property types a lead can name: the qualifier's first step, the sizer's
// prefill link and the short form on every financing page. Pure data with no
// imports, so client forms and the server share one list.

export const PROPERTY_TYPES = [
  "ASSISTED_LIVING",
  "MEMORY_CARE",
  "RCFE",
  "SNF",
  "HOTEL_FLAGGED",
  "HOTEL_BOUTIQUE",
  "HOTEL_TO_SENIOR_CONVERSION",
  "MULTIFAMILY",
  "MIXED_USE",
  "COMMERCIAL",
  /** 2–4 unit residential investor property (DSCR rental or hard money). */
  "RESIDENTIAL_2_4",
  "OFFICE",
  "INDUSTRIAL",
  "RETAIL",
  "SELF_STORAGE",
  "MEDICAL_OFFICE",
  /** Manufactured housing communities (mobile home parks). */
  "MANUFACTURED_HOUSING",
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * Income property handled like "Commercial / bridge" always was: no unit count
 * is required, and sizing uses the general commercial (CRE) boxes, since the
 * sizer has no property-specific commercial programs.
 */
export const COMMERCIAL_PROPERTY_TYPES = [
  "COMMERCIAL",
  "OFFICE",
  "INDUSTRIAL",
  "RETAIL",
  "SELF_STORAGE",
  "MEDICAL_OFFICE",
  "MANUFACTURED_HOUSING",
] as const satisfies readonly PropertyType[];

export function isCommercialProperty(type: string): boolean {
  return (COMMERCIAL_PROPERTY_TYPES as readonly string[]).includes(type);
}
