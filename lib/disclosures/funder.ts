// Funder disclosure: tells the borrower who the lender of record is, that
// Kubera is the broker and not the lender, how loan funds flow (lender to
// escrow — Kubera never receives, holds or disburses them) and what the lender
// pays Kubera. Deals that name Kubera as lender, originator or beneficiary are
// held for counsel instead of disclosed.

import { z } from "zod";
import { lenderCategories } from "@/lib/compliance/schemas";
import { site } from "@/lib/site";
import { DRAFT_NOTICE, formatUsd, mldsTemplateApproved, type DocumentSpec } from "./mlds";

export const FUNDER_TEMPLATE_VERSION = "kubera-funder-2026.11";
const KUBERA_NAME = /\bkubera\b/i;

export const funderDisclosureSchema = z.object({
  preparedOn: z.iso.date(),
  borrowers: z.array(z.object({ name: z.string().trim().min(1).max(160), email: z.email().max(200) })).min(1).max(6),
  lenderOfRecord: z.object({
    name: z.string().trim().min(1).max(160),
    category: z.enum(lenderCategories),
    /** Charter, NMLS or CFL license number. */
    licenseOrCharter: z.string().trim().max(60).optional(),
  }),
  /** Who is named as beneficiary on the deed of trust (normally the lender of record). */
  beneficiaryName: z.string().trim().min(1).max(160),
  tableFunded: z.boolean().default(false),
  /** Compensation the lender pays Kubera (also shown on the MLDS). */
  lenderPaidCompensationUsd: z.number().finite().min(0),
  /** Escrow or title company that receives and disburses loan funds. */
  escrowAgent: z.string().trim().min(1).max(160),
});
export type FunderDisclosureInput = z.input<typeof funderDisclosureSchema>;
export type FunderDisclosure = z.output<typeof funderDisclosureSchema>;

export type FunderReview = { ok: boolean; heldForCounsel: boolean; reasons: string[] };

/** Validate a funder disclosure against the broker-only rule. */
export function reviewFunderDisclosure(input: FunderDisclosureInput): FunderReview {
  const d = funderDisclosureSchema.parse(input);
  const reasons: string[] = [];
  if (KUBERA_NAME.test(d.lenderOfRecord.name)) reasons.push("Kubera cannot be the lender of record.");
  if (KUBERA_NAME.test(d.beneficiaryName)) reasons.push("Kubera cannot be the trust-deed beneficiary.");
  if (d.tableFunded && (KUBERA_NAME.test(d.lenderOfRecord.name) || KUBERA_NAME.test(d.beneficiaryName))) reasons.push("Table funding in Kubera's name requires counsel review (B&P §10234).");
  if (KUBERA_NAME.test(d.escrowAgent)) reasons.push("Kubera never receives or disburses loan funds; an independent escrow agent is required.");
  return { ok: reasons.length === 0, heldForCounsel: reasons.length > 0, reasons };
}

export function funderDocument(input: FunderDisclosureInput, opts: { approved?: boolean } = {}): DocumentSpec {
  const d = funderDisclosureSchema.parse(input);
  const review = reviewFunderDisclosure(d);
  if (!review.ok) throw new Error(`Funder disclosure held for counsel: ${review.reasons.join(" ")}`);
  const draft = !(opts.approved ?? mldsTemplateApproved());
  const brokerLine = `${site.legalName} · Real estate broker, California Department of Real Estate${site.dreCorporateLicense ? ` · DRE License #${site.dreCorporateLicense}` : ""}`;
  return {
    title: "Lender of record and funds disclosure",
    subtitle: brokerLine,
    draft,
    notice: draft ? [DRAFT_NOTICE] : [],
    sections: [
      {
        title: "Who is lending",
        rows: [
          { label: "Borrower(s)", value: d.borrowers.map((b) => b.name).join("; ") },
          { label: "Lender of record", value: d.lenderOfRecord.name, emphasis: true },
          ...(d.lenderOfRecord.licenseOrCharter ? [{ label: "Lender license / charter", value: d.lenderOfRecord.licenseOrCharter }] : []),
          { label: "Deed of trust beneficiary", value: d.beneficiaryName },
          { label: "Table funded", value: d.tableFunded ? "Yes" : "No" },
          { label: "Escrow / title agent handling funds", value: d.escrowAgent },
          { label: "Compensation the lender pays Kubera", value: formatUsd(d.lenderPaidCompensationUsd) },
        ],
      },
      {
        title: "Kubera's role",
        paragraphs: [
          `${site.legalName} is a licensed California real estate broker that arranges this loan. It is not the lender, does not fund the loan, and is not the beneficiary of the deed of trust.`,
          "Loan funds move from the lender to the escrow or title agent named above. Kubera does not receive, hold, transfer or disburse loan funds, and has no role in construction draws or loan servicing.",
          "This is not a loan commitment. Terms are subject to the lender's underwriting and final approval.",
        ],
      },
    ],
    signatureLines: d.borrowers.map((b) => ({ label: "Borrower acknowledgment", name: b.name })),
    footer: `${brokerLine} · Template ${FUNDER_TEMPLATE_VERSION}${draft ? " · DRAFT" : ""}`,
  };
}
