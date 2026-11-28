// Loan package helpers: the copy rules every staff-typed summary string goes
// through, the content-addressed storage path and manifest entry of the
// lender-ready deal summary PDF (lib/deals/submission/summary.ts and
// package-pdf.tsx renderDealSummaryPdf), and the desk's metric shape.
//
// Copy rules (Global rule 4): Corin is the broker, not the lender; a summary
// never says a loan is approved, qualified, guaranteed or usury-exempt.

import { createHash } from "node:crypto";
import type { Deal, PackageItem } from "@/lib/deals/types";
import type { AssetClass } from "./types";

/**
 * The lender desk's underwriting metrics (matching form and quote comparison).
 * Shaped to be filled from WS-L's spreads (lib/spreads); every field is optional.
 */
export type PackageSpreads = {
  asOf?: string | null;
  noiCents?: number | null;
  /** Lender-haircut / normalized NOI when it differs from the borrower's. */
  underwrittenNoiCents?: number | null;
  valueCents?: number | null;
  costCents?: number | null;
  ltvPct?: number | null;
  ltcPct?: number | null;
  dscr?: number | null;
  debtYieldPct?: number | null;
  occupancyPct?: number | null;
  revenueCents?: number | null;
  expensesCents?: number | null;
  units?: number | null;
  unitLabel?: string | null;
  adrCents?: number | null;
  revparCents?: number | null;
  /** Senior housing payor mix, e.g. { "Private pay": 70, Medicaid: 30 }. */
  payorMix?: Record<string, number> | null;
};

export class PackageCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageCopyError";
  }
}

/** Phrases the summary may not contain (Global rule 4 and gate H). */
const FORBIDDEN_COPY: { re: RegExp; why: string }[] = [
  { re: /\b(pre-?)?approved\b/i, why: "Only the lender approves a loan" },
  { re: /\bqualif(y|ies|ied) for\b/i, why: "Do not state that the borrower qualifies" },
  { re: /(?<!\bnot )\bguarantee(d|s)?\s+(closing|close|rate|approval|terms|timeline)\b|(?<!\bnot )\bguaranteed\b/i, why: "Nothing about the loan is guaranteed" },
  { re: /\busury[-\s]exempt\b|\bexempt from usury\b/i, why: "Never state that a specific loan is usury-exempt" },
  { re: /\bwill close (in|within|by)\b/i, why: "Never promise a closing timeline" },
  { re: /\bfees? protected\b/i, why: "Do not claim fee protection" },
];

export function checkSummaryCopy(texts: readonly string[]): void {
  for (const t of texts) {
    for (const { re, why } of FORBIDDEN_COPY) if (re.test(t)) throw new PackageCopyError(`"${t.slice(0, 80)}": ${why}.`);
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Storage path of a deal summary PDF: content-addressed, so the same bytes land once. */
export function summaryStoragePath(dealId: string, sha256: string): string {
  return `packages/${dealId}/deal-summary-${sha256.slice(0, 16)}.pdf`;
}

/** Manifest kind of the lender-ready deal summary PDF (lib/deals/submission/summary.ts). */
export const DEAL_SUMMARY_KIND = "DEAL_SUMMARY";

/**
 * The manifest entry for a stored deal summary. The storage path is content
 * addressed, so the same bytes land once; the share page finds the summary by
 * this kind and the PDF's SHA-256.
 */
export function dealSummaryPackageItem(dealId: string, sha256: string): PackageItem {
  return { documentId: `deal-summary-${sha256.slice(0, 24)}`, label: "Deal summary (Corin)", kind: DEAL_SUMMARY_KIND, storagePath: summaryStoragePath(dealId, sha256), sha256 };
}

/** The asset class implied by an approved box set or a program, when the deal does not say. */
export function defaultAssetClass(program: Deal["program"]): AssetClass | null {
  switch (program) {
    case "HUD_232":
      return "SENIOR_LIVING";
    case "HUD_MULTIFAMILY":
    case "AGENCY":
      return "MULTIFAMILY";
    case "HOTEL_CMBS":
    case "PIP_BRIDGE":
      return "HOSPITALITY";
    case "CONSTRUCTION":
      return "CONSTRUCTION";
    default:
      return null;
  }
}

