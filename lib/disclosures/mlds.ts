// Mortgage Loan Disclosure Statement (Traditional) — RE 882 data model.
//
// Mirrors the RE 882 sections and the B&P §10241 content requirements (counsel
// gate A): estimated maximum borrower-paid costs (appraisal, escrow, title,
// notary, recording), ALL broker compensation including lender-paid,
// loan terms and payments, credit insurance not required, broker-controlled
// funds will not be used, Kubera's name / license number / licensed address,
// and a notice that the figures are estimates.
//
// The rendered template stays marked "DRAFT — pending counsel review" until
// MLDS_TEMPLATE_APPROVED=true is set after attorney sign-off.

import { z } from "zod";
import { site } from "@/lib/site";

export const MLDS_TEMPLATE_VERSION = "kubera-re882-2026.11";
export const MLDS_TITLE = "Mortgage Loan Disclosure Statement (Traditional) — RE 882";
/** Signed MLDS copies are kept at least 3 years (B&P §10148, §10240). */
export const MLDS_RETENTION_YEARS = 3;

export function mldsTemplateApproved(): boolean {
  return process.env.MLDS_TEMPLATE_APPROVED === "true";
}

const usd = z.number().finite().min(0).max(1_000_000_000);
const isoDate = z.iso.date();
const KUBERA_NAME = /\bkubera\b/i;

export const costLineSchema = z.object({
  /** Estimated maximum amount. */
  amountUsd: usd,
  paidTo: z.enum(["broker", "others"]).default("others"),
});

const lienSchema = z.object({
  lienholder: z.string().trim().min(1).max(160),
  nature: z.string().trim().min(1).max(120),
  priority: z.number().int().min(1).max(9),
  amountUsd: usd,
});

export const mldsInputSchema = z
  .object({
    preparedOn: isoDate,
    borrowers: z
      .array(z.object({ name: z.string().trim().min(1).max(160), email: z.email().max(200), mailingAddress: z.string().trim().max(300).optional() }))
      .min(1)
      .max(6),
    property: z.object({
      address: z.string().trim().min(5).max(300),
      apn: z.string().trim().max(60).optional(),
      county: z.string().trim().max(80).optional(),
    }),
    broker: z.object({
      legalName: z.string().trim().min(1).max(160),
      dreLicense: z.string().trim().regex(/^\d{8}$/, "Kubera's 8-digit DRE license number is required"),
      licensedAddress: z.string().trim().min(5).max(300),
      representativeName: z.string().trim().min(1).max(120),
      representativeLicense: z.string().trim().regex(/^\d{8}$/, "The signing licensee's 8-digit DRE license number is required"),
      nmls: z.string().trim().max(20).optional(),
    }),
    loan: z.object({
      /** Lender of record if known. Kubera is never the lender. */
      lenderName: z.string().trim().max(160).optional(),
      principalUsd: usd.refine((v) => v > 0, "Principal must be positive"),
      termMonths: z.number().int().min(1).max(600),
      amortizationMonths: z.number().int().min(0).max(600).optional(),
      ratePct: z.number().finite().min(0).max(100),
      rateType: z.enum(["fixed", "adjustable", "initial_adjustable"]),
      /** Index, margin, caps and adjustment frequency for adjustable rates. */
      adjustableTerms: z.string().trim().max(500).optional(),
      payment: z.object({
        amountUsd: usd,
        frequency: z.enum(["monthly", "quarterly", "semi_annual", "annual"]),
        count: z.number().int().min(1).max(600),
        interestOnly: z.boolean().default(false),
      }),
      balloon: z.object({ present: z.boolean(), amountUsd: usd.optional(), dueOn: isoDate.optional() }),
      prepayment: z.object({ present: z.boolean(), description: z.string().trim().max(500).optional() }),
      lateCharge: z.object({ present: z.boolean(), description: z.string().trim().max(300).optional() }),
      impoundsRequired: z.boolean().default(false),
    }),
    /** Estimated maximum costs and expenses paid by the borrower (RE 882 Part III). */
    costs: z.object({
      appraisal: costLineSchema,
      escrow: costLineSchema,
      title: costLineSchema,
      notary: costLineSchema,
      recording: costLineSchema,
      creditInvestigation: costLineSchema.optional(),
      other: z.array(costLineSchema.extend({ label: z.string().trim().min(1).max(120) })).max(20).default([]),
    }),
    /** All compensation to Kubera, including lender-paid (B&P §10241(b)). */
    compensation: z.object({
      brokerFromBorrower: z.object({
        commissionUsd: usd,
        processingUsd: usd.default(0),
        otherUsd: usd.default(0),
        description: z.string().trim().max(300).optional(),
      }),
      brokerFromLender: z.object({
        amountUsd: usd,
        /** e.g. "Lender-paid origination split, 1.00% of principal". */
        description: z.string().trim().max(300).optional(),
      }),
      lenderFees: z.object({ originationUsd: usd.default(0), discountUsd: usd.default(0) }).default({ originationUsd: 0, discountUsd: 0 }),
    }),
    /** Amounts paid from loan proceeds on the borrower's authorization (payoffs etc.). */
    payoffs: z.array(z.object({ label: z.string().trim().min(1).max(160), amountUsd: usd })).max(20).default([]),
    existingLiens: z.array(lienSchema).max(10).default([]),
    expectedLiens: z.array(lienSchema).max(10).default([]),
    /** §10241.1: credit life / disability insurance is not required. Always false. */
    creditInsuranceRequired: z.literal(false).default(false),
    /** §10241(j), §10241.2: the loan will not be made from broker-controlled funds. Always false. */
    brokerControlledFunds: z.literal(false).default(false),
  })
  .superRefine((m, ctx) => {
    if (m.loan.balloon.present && (m.loan.balloon.amountUsd === undefined || !m.loan.balloon.dueOn)) {
      ctx.addIssue({ code: "custom", path: ["loan", "balloon"], message: "A balloon payment needs its amount and due date" });
    }
    if (m.loan.rateType !== "fixed" && !m.loan.adjustableTerms) {
      ctx.addIssue({ code: "custom", path: ["loan", "adjustableTerms"], message: "Adjustable rates need index, margin and caps" });
    }
    if (m.loan.prepayment.present && !m.loan.prepayment.description) {
      ctx.addIssue({ code: "custom", path: ["loan", "prepayment", "description"], message: "Describe the prepayment penalty" });
    }
    if (m.loan.lenderName && KUBERA_NAME.test(m.loan.lenderName)) {
      ctx.addIssue({ code: "custom", path: ["loan", "lenderName"], message: "Kubera is a broker and is never the lender of record" });
    }
    for (const [i, lien] of [...m.existingLiens, ...m.expectedLiens].entries()) {
      if (KUBERA_NAME.test(lien.lienholder)) {
        ctx.addIssue({ code: "custom", path: ["existingLiens", i, "lienholder"], message: "Kubera is never a lienholder or trust-deed beneficiary" });
      }
    }
  });

export type MldsInput = z.input<typeof mldsInputSchema>;
export type MldsData = z.output<typeof mldsInputSchema>;

export type MldsTotals = {
  totalCostsUsd: number;
  costsPaidToBrokerUsd: number;
  brokerFromBorrowerUsd: number;
  brokerFromLenderUsd: number;
  /** All compensation to Kubera, borrower-paid and lender-paid. */
  totalBrokerCompensationUsd: number;
  lenderFeesUsd: number;
  payoffsUsd: number;
  /** Deducted from principal: costs + borrower-paid broker comp + lender fees + payoffs. */
  totalDeductionsUsd: number;
  /** Positive: estimated cash to the borrower. Negative: cash the borrower must bring. */
  estimatedCashToBorrowerUsd: number;
};

export type Mlds = { data: MldsData; totals: MldsTotals; templateVersion: string; draft: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function costLines(data: MldsData): { label: string; amountUsd: number; paidTo: "broker" | "others" }[] {
  const c = data.costs;
  return [
    { label: "Appraisal fee", ...c.appraisal },
    { label: "Escrow fee", ...c.escrow },
    { label: "Title insurance policy", ...c.title },
    { label: "Notary fees", ...c.notary },
    { label: "Recording fees", ...c.recording },
    ...(c.creditInvestigation ? [{ label: "Credit investigation fees", ...c.creditInvestigation }] : []),
    ...c.other.map(({ label, amountUsd, paidTo }) => ({ label, amountUsd, paidTo })),
  ];
}

export function computeTotals(data: MldsData): MldsTotals {
  const lines = costLines(data);
  const totalCostsUsd = round2(lines.reduce((s, l) => s + l.amountUsd, 0));
  const costsPaidToBrokerUsd = round2(lines.filter((l) => l.paidTo === "broker").reduce((s, l) => s + l.amountUsd, 0));
  const b = data.compensation.brokerFromBorrower;
  const brokerFromBorrowerUsd = round2(b.commissionUsd + b.processingUsd + b.otherUsd);
  const brokerFromLenderUsd = round2(data.compensation.brokerFromLender.amountUsd);
  const lenderFeesUsd = round2(data.compensation.lenderFees.originationUsd + data.compensation.lenderFees.discountUsd);
  const payoffsUsd = round2(data.payoffs.reduce((s, p) => s + p.amountUsd, 0));
  const totalDeductionsUsd = round2(totalCostsUsd + brokerFromBorrowerUsd + lenderFeesUsd + payoffsUsd);
  return {
    totalCostsUsd,
    costsPaidToBrokerUsd,
    brokerFromBorrowerUsd,
    brokerFromLenderUsd,
    totalBrokerCompensationUsd: round2(brokerFromBorrowerUsd + brokerFromLenderUsd + costsPaidToBrokerUsd),
    lenderFeesUsd,
    payoffsUsd,
    totalDeductionsUsd,
    estimatedCashToBorrowerUsd: round2(data.loan.principalUsd - totalDeductionsUsd),
  };
}

export function buildMlds(input: MldsInput, opts: { approved?: boolean } = {}): Mlds {
  const data = mldsInputSchema.parse(input);
  return { data, totals: computeTotals(data), templateVersion: MLDS_TEMPLATE_VERSION, draft: !(opts.approved ?? mldsTemplateApproved()) };
}

/** Kubera's broker block from configuration. Throws when the license data the MLDS must show is missing. */
export function kuberaBrokerBlock(signer: { name: string; dreLicense: string }): MldsInput["broker"] {
  // Same address the public /licensing page shows (site.licensedAddress), so the
  // MLDS header and the website never disagree. DRE_LICENSED_ADDRESS overrides it.
  const licensedAddress = (process.env.DRE_LICENSED_ADDRESS ?? "").trim() || site.licensedAddress;
  if (!site.dreCorporateLicense) throw new Error("NEXT_PUBLIC_DRE_CORPORATE_LICENSE is required to generate an MLDS");
  if (!licensedAddress) throw new Error("DRE_LICENSED_ADDRESS or NEXT_PUBLIC_DRE_LICENSED_ADDRESS is required to generate an MLDS");
  return {
    legalName: site.legalName,
    dreLicense: site.dreCorporateLicense,
    licensedAddress,
    representativeName: signer.name,
    representativeLicense: signer.dreLicense,
    ...(site.nmls ? { nmls: site.nmls } : {}),
  };
}

// ---------------------------------------------------------------------------
// Presentation-neutral sections (shared by the HTML and PDF renderers and the
// e-sign prefill so every output carries the same figures).

export type Row = { label: string; value: string; emphasis?: boolean };
export type Section = { title: string; rows?: Row[]; paragraphs?: string[] };
export type DocumentSpec = { title: string; subtitle: string; draft: boolean; notice: string[]; sections: Section[]; signatureLines: { label: string; name: string; detail?: string }[]; footer: string };

export const DRAFT_NOTICE = "DRAFT — pending counsel review. Not for delivery to borrowers.";

export function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const yesNo = (b: boolean) => (b ? "Yes" : "No");
const freqLabel: Record<MldsData["loan"]["payment"]["frequency"], string> = {
  monthly: "monthly",
  quarterly: "quarterly",
  semi_annual: "semi-annual",
  annual: "annual",
};

export function mldsDocument(mlds: Mlds): DocumentSpec {
  const { data, totals } = mlds;
  const l = data.loan;
  const comp = data.compensation;
  const brokerLine = `${data.broker.legalName} · Real estate broker, California Department of Real Estate · DRE License #${data.broker.dreLicense}${data.broker.nmls ? ` · NMLS #${data.broker.nmls}` : ""}`;

  const sections: Section[] = [
    {
      title: "Parties and property",
      rows: [
        { label: "Borrower(s)", value: data.borrowers.map((b) => b.name).join("; ") },
        { label: "Broker", value: `${data.broker.legalName}, DRE License #${data.broker.dreLicense}` },
        { label: "Broker's licensed address", value: data.broker.licensedAddress },
        { label: "Lender of record", value: l.lenderName || "To be determined (Kubera is not the lender)" },
        { label: "Real property collateral", value: data.property.address },
        ...(data.property.apn ? [{ label: "APN", value: data.property.apn }] : []),
        { label: "Prepared on", value: data.preparedOn },
      ],
    },
    {
      title: "I. Summary of loan terms",
      rows: [
        { label: "A. Principal amount of loan", value: formatUsd(l.principalUsd), emphasis: true },
        { label: "B.1 Estimated costs and expenses (Part III)", value: formatUsd(totals.totalCostsUsd) },
        { label: "B.2 Broker commission / origination fee (paid by borrower)", value: formatUsd(totals.brokerFromBorrowerUsd) },
        { label: "B.3 Lender origination fee / discounts", value: formatUsd(totals.lenderFeesUsd) },
        { label: "B.4 Amounts paid on borrower's authorization", value: formatUsd(totals.payoffsUsd) },
        { label: "B. Total estimated deductions from principal", value: formatUsd(totals.totalDeductionsUsd) },
        {
          label: totals.estimatedCashToBorrowerUsd >= 0 ? "C. Estimated cash payable to borrower" : "C. Estimated cash the borrower must pay",
          value: formatUsd(Math.abs(totals.estimatedCashToBorrowerUsd)),
          emphasis: true,
        },
      ],
      paragraphs: data.payoffs.length ? [`Paid on authorization: ${data.payoffs.map((p) => `${p.label} ${formatUsd(p.amountUsd)}`).join("; ")}.`] : [],
    },
    {
      title: "II. General information about the loan",
      rows: [
        { label: "Term", value: `${l.termMonths} months${l.amortizationMonths ? ` (amortization ${l.amortizationMonths} months)` : ""}` },
        { label: "Interest rate", value: `${l.ratePct.toFixed(3)}% per year, ${l.rateType === "fixed" ? "fixed" : l.rateType === "adjustable" ? "adjustable" : "initial rate, then adjustable"}` },
        ...(l.adjustableTerms ? [{ label: "Adjustable-rate terms", value: l.adjustableTerms }] : []),
        {
          label: "Payments",
          value: `${l.payment.count} ${freqLabel[l.payment.frequency]} payments of ${formatUsd(l.payment.amountUsd)}${l.payment.interestOnly ? " (interest only)" : ""}`,
        },
        {
          label: "Balloon payment",
          value: l.balloon.present ? `Yes: ${formatUsd(l.balloon.amountUsd ?? 0)} due ${l.balloon.dueOn}` : "No",
          emphasis: l.balloon.present,
        },
        { label: "Prepayment penalty", value: l.prepayment.present ? `Yes: ${l.prepayment.description}` : "No" },
        { label: "Late charges", value: l.lateCharge.present ? `Yes${l.lateCharge.description ? `: ${l.lateCharge.description}` : ""}` : "No" },
        { label: "Impound (reserve) account required", value: yesNo(l.impoundsRequired) },
        { label: "Credit life or disability insurance required", value: "No. Credit life and disability insurance are not required as a condition of this loan." },
        { label: "Loan made from broker-controlled funds", value: "No. This loan will not be made wholly or in part from broker-controlled funds." },
      ],
      paragraphs: l.balloon.present
        ? [
            "NOTICE TO BORROWER: If you do not have the funds to pay the balloon payment when it comes due, you may have to obtain a new loan against your property. You may have to pay commissions, fees and expenses for the arranging of the new loan. In addition, if you are unable to make the monthly payments or the balloon payment, you may lose the property and all of your equity through foreclosure. Keep this in mind in deciding upon the amount and terms of this loan.",
          ]
        : [],
    },
    {
      title: "Liens",
      rows: [
        ...data.existingLiens.map((x) => ({ label: `Existing lien (priority ${x.priority})`, value: `${x.lienholder}, ${x.nature}, ${formatUsd(x.amountUsd)}` })),
        ...data.expectedLiens.map((x) => ({ label: `Expected after this loan (priority ${x.priority})`, value: `${x.lienholder}, ${x.nature}, ${formatUsd(x.amountUsd)}` })),
        ...(data.existingLiens.length + data.expectedLiens.length === 0 ? [{ label: "Liens", value: "None disclosed" }] : []),
      ],
      paragraphs: [
        "NOTICE TO BORROWER: Be sure that you state the amount of all liens as accurately as possible. If you contract with the broker to arrange this loan, but it cannot be arranged because you did not state these liens correctly, you may be liable to pay commissions, fees and expenses even though you do not obtain the loan.",
      ],
    },
    {
      title: "III. Estimated maximum costs and expenses paid by the borrower",
      rows: [
        ...costLines(data).map((c) => ({ label: c.label, value: `${formatUsd(c.amountUsd)} (paid to ${c.paidTo === "broker" ? "broker" : "others"})` })),
        { label: "Total estimated costs and expenses", value: formatUsd(totals.totalCostsUsd), emphasis: true },
      ],
    },
    {
      title: "Broker compensation (all sources)",
      rows: [
        { label: "Commission / origination fee paid by borrower", value: formatUsd(comp.brokerFromBorrower.commissionUsd) },
        { label: "Processing and other fees paid by borrower to broker", value: formatUsd(comp.brokerFromBorrower.processingUsd + comp.brokerFromBorrower.otherUsd) },
        ...(totals.costsPaidToBrokerUsd > 0 ? [{ label: "Costs above paid to broker", value: formatUsd(totals.costsPaidToBrokerUsd) }] : []),
        {
          label: "Compensation paid to broker by the lender",
          value: `${formatUsd(comp.brokerFromLender.amountUsd)}${comp.brokerFromLender.description ? ` (${comp.brokerFromLender.description})` : ""}`,
        },
        { label: "Total compensation to broker", value: formatUsd(totals.totalBrokerCompensationUsd), emphasis: true },
      ],
    },
    {
      title: "Notices",
      paragraphs: [
        "The costs, fees and compensation in this statement are estimates. Actual amounts may differ and will appear on the final closing statement.",
        "This is not a loan commitment. Loan terms are subject to the lender's underwriting, appraisal, title and final approval. Kubera Commercial, Inc. arranges this loan as a licensed real estate broker and is not the lender.",
        "Do not sign this statement until you have read and understood all of the information in it. All parts of this form must be completed before you sign. You will receive an exact copy of this statement after it is signed.",
      ],
    },
  ];

  return {
    title: MLDS_TITLE,
    subtitle: brokerLine,
    draft: mlds.draft,
    notice: mlds.draft ? [DRAFT_NOTICE] : [],
    sections,
    signatureLines: [
      ...data.borrowers.map((b) => ({ label: "Borrower", name: b.name })),
      { label: `Broker or licensee for the broker (DRE #${data.broker.representativeLicense})`, name: data.broker.representativeName, detail: data.broker.legalName },
    ],
    footer: `${brokerLine} · Template ${mlds.templateVersion}${mlds.draft ? " · DRAFT" : ""}`,
  };
}

/**
 * Flat field map for the e-sign template. Field labels in the Zoho Sign / BoldSign
 * template must match these keys (see .env.example: ZOHO_SIGN_MLDS_TEMPLATE_ID).
 */
export function mldsPrefillFields(mlds: Mlds): Record<string, string> {
  const { data, totals } = mlds;
  const l = data.loan;
  return {
    borrower_names: data.borrowers.map((b) => b.name).join("; "),
    property_address: data.property.address,
    property_apn: data.property.apn ?? "",
    broker_name: data.broker.legalName,
    broker_license: data.broker.dreLicense,
    broker_address: data.broker.licensedAddress,
    broker_representative: data.broker.representativeName,
    broker_representative_license: data.broker.representativeLicense,
    lender_name: l.lenderName ?? "To be determined",
    principal_amount: formatUsd(l.principalUsd),
    total_costs: formatUsd(totals.totalCostsUsd),
    broker_comp_borrower: formatUsd(totals.brokerFromBorrowerUsd),
    broker_comp_lender: formatUsd(totals.brokerFromLenderUsd),
    broker_comp_total: formatUsd(totals.totalBrokerCompensationUsd),
    lender_fees: formatUsd(totals.lenderFeesUsd),
    payoffs: formatUsd(totals.payoffsUsd),
    total_deductions: formatUsd(totals.totalDeductionsUsd),
    cash_to_borrower: formatUsd(totals.estimatedCashToBorrowerUsd),
    term_months: String(l.termMonths),
    interest_rate: `${l.ratePct.toFixed(3)}%`,
    rate_type: l.rateType,
    payment_amount: formatUsd(l.payment.amountUsd),
    payment_count: String(l.payment.count),
    payment_frequency: l.payment.frequency,
    balloon: l.balloon.present ? `${formatUsd(l.balloon.amountUsd ?? 0)} due ${l.balloon.dueOn}` : "No",
    prepayment_penalty: l.prepayment.present ? (l.prepayment.description ?? "Yes") : "No",
    credit_insurance_required: "No",
    broker_controlled_funds: "No",
    template_version: mlds.templateVersion,
    draft_notice: mlds.draft ? DRAFT_NOTICE : "",
    ...Object.fromEntries(costLines(data).slice(0, 5).map((c, i) => [["cost_appraisal", "cost_escrow", "cost_title", "cost_notary", "cost_recording"][i] as string, formatUsd(c.amountUsd)])),
  };
}
