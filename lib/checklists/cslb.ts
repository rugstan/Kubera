// Contractor license verification for checklist items with
// `lookup: "cslb_license"`. The automated CSLB public-lookup client belongs
// to the construction desk (lib/construction, WS-AA); this module defines the
// record it fills and accepts a staff member's manual check of the CSLB site
// in the meantime. Either way the item stores the same verification shape.

import { z } from "zod";

export const CSLB_STATUSES = ["active", "expired", "suspended", "revoked", "inactive", "not_found"] as const;
export type CslbStatus = (typeof CSLB_STATUSES)[number];

export const cslbVerificationSchema = z.object({
  licenseNumber: z.string().trim().regex(/^\d{1,8}$/, "CSLB license numbers are up to 8 digits."),
  businessName: z.string().trim().min(2).max(200),
  status: z.enum(CSLB_STATUSES),
  /** License classifications, e.g. "B" (general building), "A" (general engineering), "C-10". */
  classifications: z.array(z.string().trim().regex(/^(A|B|B-2|C|C-\d{1,2}|D-\d{1,2})$/)).max(30),
  expiresOn: z.iso.date().nullable(),
  bondOnFile: z.boolean(),
  workersCompOnFile: z.boolean(),
});
export type CslbVerificationInput = z.input<typeof cslbVerificationSchema>;

export type CslbVerification = z.output<typeof cslbVerificationSchema> & {
  checkedAt: string;
  checkedBy: string;
  source: "cslb_manual" | "cslb_api";
  /** Problems that keep the license from satisfying the item. */
  problems: string[];
  /** Active, general contractor classification, bonded, insured and unexpired at closing. */
  satisfied: boolean;
};

/** Implemented by the construction desk's CSLB client (WS-AA). */
export interface ContractorLicenseVerifier {
  lookup(licenseNumber: string): Promise<z.output<typeof cslbVerificationSchema> | null>;
}

export function evaluateCslb(v: z.output<typeof cslbVerificationSchema>, opts: { now: Date; checkedBy: string; source: CslbVerification["source"]; closingDate?: Date }): CslbVerification {
  const problems: string[] = [];
  if (v.status !== "active") problems.push(`License status is ${v.status.replace(/_/g, " ")}.`);
  if (!v.classifications.some((c) => c === "A" || c === "B")) problems.push("No general contractor classification (A or B).");
  if (!v.bondOnFile) problems.push("No contractor bond on file.");
  if (!v.workersCompOnFile) problems.push("No workers' compensation certificate or exemption on file.");
  const ref = opts.closingDate ?? opts.now;
  if (v.expiresOn && Date.parse(`${v.expiresOn}T00:00:00Z`) < ref.getTime()) problems.push(`License expires ${v.expiresOn}, before closing.`);
  return { ...v, checkedAt: opts.now.toISOString(), checkedBy: opts.checkedBy, source: opts.source, problems, satisfied: problems.length === 0 };
}
