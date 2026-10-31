// Loan package executive summary: a one-to-two page PDF built from the deal
// record and its spreads (WS-L), added to the locked package manifest next to
// the vault documents a lender receives.
//
// Deterministic: the same deal, spreads, notes and as-of date give the same
// bytes (fixed PDF dates), so re-sending to another lender reuses the same
// locked package version instead of minting a new one.
//
// Copy rules (Global rule 4): Kubera is the broker, not the lender; the summary
// never says a loan is approved, qualified, guaranteed or usury-exempt, and
// carries the license line.

import { createHash } from "node:crypto";
import type { Deal, PackageItem } from "@/lib/deals/types";
import { DEAL_PROGRAM_LABELS } from "@/lib/deals/types";
import { licenseLine, site } from "@/lib/site";
import { ASSET_CLASS_LABELS, type AssetClass } from "./types";

/**
 * Underwriting metrics for the summary. Shaped to be filled from WS-L's
 * spreads (lib/spreads) or entered by staff; every field is optional.
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

export type ExecutiveSummaryInput = {
  deal: Pick<Deal, "id" | "title" | "program" | "borrowerName" | "propertyAddress" | "propertyState" | "loanAmountCents">;
  assetClass?: AssetClass | null;
  spreads?: PackageSpreads | null;
  /** Advisor-written highlights and risk notes (plain sentences). */
  highlights?: string[];
  risks?: string[];
  /** Use of proceeds, one line. */
  purpose?: string | null;
  /** YYYY-MM-DD; drives the "prepared" line and the PDF dates. */
  asOf: string;
  advisor?: { name: string; email: string; dreLicense?: string | null } | null;
};

export type SummarySection = { title: string; rows?: { label: string; value: string }[]; paragraphs?: string[] };

export type ExecutiveSummarySpec = {
  title: string;
  subtitle: string;
  sections: SummarySection[];
  footer: string;
  asOf: string;
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

const usd = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const pct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? null : `${n.toFixed(digits)}%`);
const x = (n: number | null | undefined) => (n === null || n === undefined ? null : `${n.toFixed(2)}x`);
const rows = (pairs: [string, string | null | undefined][]) => pairs.filter((p): p is [string, string] => typeof p[1] === "string" && p[1].length > 0).map(([label, value]) => ({ label, value }));
const clean = (list: readonly string[] | undefined) => (list ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 12).map((s) => s.slice(0, 400));

export function buildExecutiveSummary(input: ExecutiveSummaryInput): ExecutiveSummarySpec {
  const { deal } = input;
  const s = input.spreads ?? {};
  const highlights = clean(input.highlights);
  const risks = clean(input.risks);
  const purpose = input.purpose?.trim().slice(0, 400) || null;
  checkSummaryCopy([...highlights, ...risks, ...(purpose ? [purpose] : [])]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new PackageCopyError("asOf must be YYYY-MM-DD");

  // Derive what the spreads imply when a ratio was not given.
  const noi = s.underwrittenNoiCents ?? s.noiCents ?? null;
  const loan = deal.loanAmountCents;
  const ltv = s.ltvPct ?? (loan && s.valueCents ? (loan / s.valueCents) * 100 : null);
  const ltc = s.ltcPct ?? (loan && s.costCents ? (loan / s.costCents) * 100 : null);
  const debtYield = s.debtYieldPct ?? (loan && noi ? (noi / loan) * 100 : null);

  const sections: SummarySection[] = [
    {
      title: "Request",
      rows: rows([
        ["Program", DEAL_PROGRAM_LABELS[deal.program]],
        ["Loan request", usd(loan)],
        ["Borrower", deal.borrowerName],
        ["Property", [deal.propertyAddress, deal.propertyState].filter(Boolean).join(", ") || null],
        ["Asset class", input.assetClass ? ASSET_CLASS_LABELS[input.assetClass] : null],
        ["Use of proceeds", purpose],
      ]),
    },
  ];
  const metrics = rows([
    ["Net operating income", usd(s.noiCents)],
    ["Underwritten NOI", s.underwrittenNoiCents !== undefined && s.underwrittenNoiCents !== s.noiCents ? usd(s.underwrittenNoiCents) : null],
    ["Revenue (trailing)", usd(s.revenueCents)],
    ["Operating expenses (trailing)", usd(s.expensesCents)],
    ["Value (as-is / appraised)", usd(s.valueCents)],
    ["Total cost", usd(s.costCents)],
    ["Loan-to-value", pct(ltv)],
    ["Loan-to-cost", pct(ltc)],
    ["Debt service coverage", x(s.dscr)],
    ["Debt yield", pct(debtYield, 2)],
    ["Occupancy", pct(s.occupancyPct)],
    [s.unitLabel ? s.unitLabel.charAt(0).toUpperCase() + s.unitLabel.slice(1) : "Units", s.units ? s.units.toLocaleString("en-US") : null],
    ["ADR", usd(s.adrCents)],
    ["RevPAR", usd(s.revparCents)],
  ]);
  if (metrics.length) sections.push({ title: `Underwriting snapshot${s.asOf ? ` (spreads as of ${s.asOf})` : ""}`, rows: metrics });
  if (s.payorMix && Object.keys(s.payorMix).length) {
    sections.push({ title: "Payor mix", rows: Object.entries(s.payorMix).map(([label, share]) => ({ label, value: `${share.toFixed(0)}%` })) });
  }
  if (highlights.length) sections.push({ title: "Highlights", paragraphs: highlights.map((h) => `• ${h}`) });
  if (risks.length) sections.push({ title: "Risks and mitigants", paragraphs: risks.map((r) => `• ${r}`) });
  sections.push({
    title: "About this package",
    paragraphs: [
      `${site.legalName} is the broker for this request, not the lender. Figures come from the borrower's documents and Kubera's spreads; the lender performs its own underwriting and makes every credit decision.`,
      ...(input.advisor ? [`Advisor: ${input.advisor.name} (${input.advisor.email}${input.advisor.dreLicense ? `, DRE ${input.advisor.dreLicense}` : ""}).`] : []),
      "Confidential: for the addressed institution's credit review only.",
    ],
  });
  return {
    title: `${deal.title} — executive summary`,
    subtitle: `Prepared ${input.asOf} by ${site.legalName} for lender review`,
    sections,
    footer: licenseLine(),
    asOf: input.asOf,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Storage path of a summary: content-addressed, so the same bytes land once. */
export function summaryStoragePath(dealId: string, sha256: string): string {
  return `packages/${dealId}/executive-summary-${sha256.slice(0, 16)}.pdf`;
}

/** The manifest entry for a stored summary. */
export function summaryPackageItem(dealId: string, sha256: string): PackageItem {
  return { documentId: `summary-${sha256.slice(0, 24)}`, label: "Executive summary (Kubera)", kind: "EXECUTIVE_SUMMARY", storagePath: summaryStoragePath(dealId, sha256), sha256 };
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

