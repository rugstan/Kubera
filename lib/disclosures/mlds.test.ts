import { afterEach, describe, expect, it, vi } from "vitest";
import { containsExemptionClaim } from "@/lib/compliance/gates";
import { renderDisclosureHtml } from "./html";
import { DRAFT_NOTICE, MLDS_TITLE, buildMlds, kuberaBrokerBlock, mldsDocument, mldsInputSchema, mldsPrefillFields, mldsTemplateApproved, type MldsInput } from "./mlds";
import { sampleMldsInput } from "./test-fixtures";

const withLoan = (loan: Partial<MldsInput["loan"]>): MldsInput => ({ ...sampleMldsInput, loan: { ...sampleMldsInput.loan, ...loan } });

afterEach(() => vi.unstubAllEnvs());

describe("MLDS data model", () => {
  it("computes RE 882 totals including lender-paid broker compensation", () => {
    const { totals } = buildMlds(sampleMldsInput, { approved: true });
    expect(totals).toEqual({
      totalCostsUsd: 33_100,
      costsPaidToBrokerUsd: 450,
      brokerFromBorrowerUsd: 86_500,
      brokerFromLenderUsd: 42_500,
      totalBrokerCompensationUsd: 129_450,
      lenderFeesUsd: 85_000,
      payoffsUsd: 6_100_000,
      totalDeductionsUsd: 6_304_600,
      estimatedCashToBorrowerUsd: 2_195_400,
    });
  });

  it("reports cash the borrower must bring when deductions exceed principal", () => {
    const m = buildMlds({ ...sampleMldsInput, payoffs: [{ label: "Payoff", amountUsd: 8_600_000 }] }, { approved: true });
    expect(m.totals.estimatedCashToBorrowerUsd).toBeLessThan(0);
    const row = mldsDocument(m).sections[1]?.rows?.at(-1);
    expect(row?.label).toBe("C. Estimated cash the borrower must pay");
  });

  it("fixes credit insurance and broker-controlled funds to 'no'", () => {
    const m = buildMlds(sampleMldsInput, { approved: true });
    expect(m.data.creditInsuranceRequired).toBe(false);
    expect(m.data.brokerControlledFunds).toBe(false);
    expect(() => mldsInputSchema.parse({ ...sampleMldsInput, brokerControlledFunds: true })).toThrow();
    expect(() => mldsInputSchema.parse({ ...sampleMldsInput, creditInsuranceRequired: true })).toThrow();
  });

  it("requires all five estimated cost categories", () => {
    const { recording: _omit, ...costs } = sampleMldsInput.costs;
    expect(() => mldsInputSchema.parse({ ...sampleMldsInput, costs })).toThrow();
  });

  it("requires Kubera's 8-digit license, the signer's license and the licensed address", () => {
    expect(() => mldsInputSchema.parse({ ...sampleMldsInput, broker: { ...sampleMldsInput.broker, dreLicense: "" } })).toThrow(/8-digit DRE/);
    expect(() => mldsInputSchema.parse({ ...sampleMldsInput, broker: { ...sampleMldsInput.broker, representativeLicense: "12" } })).toThrow();
    expect(() => mldsInputSchema.parse({ ...sampleMldsInput, broker: { ...sampleMldsInput.broker, licensedAddress: "" } })).toThrow();
  });

  it("needs the balloon amount and date, adjustable-rate terms, and a prepayment description", () => {
    expect(() => buildMlds(withLoan({ balloon: { present: true } }))).toThrow(/balloon/);
    expect(() => buildMlds(withLoan({ rateType: "adjustable" }))).toThrow(/index, margin/);
    expect(() => buildMlds(withLoan({ prepayment: { present: true } }))).toThrow(/prepayment/i);
  });

  it("never lets Kubera appear as lender or lienholder", () => {
    expect(() => buildMlds(withLoan({ lenderName: "Kubera Commercial Lending" }))).toThrow(/never the lender/);
    expect(() =>
      buildMlds({ ...sampleMldsInput, expectedLiens: [{ lienholder: "Kubera Commercial, Inc.", nature: "Deed of trust", priority: 1, amountUsd: 1 }] }),
    ).toThrow(/beneficiary/);
  });

  it("is a draft unless MLDS_TEMPLATE_APPROVED=true", () => {
    expect(mldsTemplateApproved()).toBe(false);
    expect(buildMlds(sampleMldsInput).draft).toBe(true);
    vi.stubEnv("MLDS_TEMPLATE_APPROVED", "true");
    expect(buildMlds(sampleMldsInput).draft).toBe(false);
  });
});

describe("MLDS document", () => {
  it("mirrors the RE 882 sections under the RE 882 header", () => {
    const doc = mldsDocument(buildMlds(sampleMldsInput, { approved: true }));
    expect(doc.title).toBe(MLDS_TITLE);
    expect(doc.title).toContain("RE 882");
    expect(doc.subtitle).toContain("Real estate broker, California Department of Real Estate");
    expect(doc.subtitle).toContain("DRE License #02234567");
    expect(doc.sections.map((s) => s.title)).toEqual([
      "Parties and property",
      "I. Summary of loan terms",
      "II. General information about the loan",
      "Liens",
      "III. Estimated maximum costs and expenses paid by the borrower",
      "Broker compensation (all sources)",
      "Notices",
    ]);
    const text = JSON.stringify(doc);
    for (const s of ["Appraisal fee", "Escrow fee", "Title insurance policy", "Notary fees", "Recording fees", "Compensation paid to broker by the lender", "$42,500.00", "will not be made wholly or in part from broker-controlled funds", "are not required", "are estimates", "not the lender", "NOTICE TO BORROWER: If you do not have the funds to pay the balloon"]) {
      expect(text).toContain(s);
    }
    expect(doc.signatureLines.map((s) => s.label)).toEqual(["Borrower", "Borrower", "Broker or licensee for the broker (DRE #02123456)"]);
    expect(doc.notice).toEqual([]);
  });

  it("carries the DRAFT notice while pending counsel", () => {
    const doc = mldsDocument(buildMlds(sampleMldsInput, { approved: false }));
    expect(doc.draft).toBe(true);
    expect(doc.notice).toEqual([DRAFT_NOTICE]);
    expect(doc.footer).toContain("DRAFT");
  });

  it("makes no usury-exemption claim and no guarantee", () => {
    const text = JSON.stringify(mldsDocument(buildMlds(sampleMldsInput)));
    expect(containsExemptionClaim(text)).toBe(false);
    expect(text).not.toMatch(/guarantee|approved for|qualified for/i);
  });

  it("renders escaped HTML", () => {
    const html = renderDisclosureHtml(mldsDocument(buildMlds({ ...sampleMldsInput, property: { address: "1 <script>alert(1)</script> Way, CA" } })));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("DRAFT — pending counsel review");
    expect(html).toContain('<html lang="en">');
  });

  it("prefills template fields with the same figures", () => {
    const f = mldsPrefillFields(buildMlds(sampleMldsInput, { approved: true }));
    expect(f).toMatchObject({
      principal_amount: "$8,500,000.00",
      broker_comp_lender: "$42,500.00",
      broker_comp_total: "$129,450.00",
      cost_appraisal: "$7,500.00",
      cost_recording: "$600.00",
      broker_controlled_funds: "No",
      credit_insurance_required: "No",
      broker_license: "02234567",
      draft_notice: "",
    });
  });
});

describe("Kubera broker block", () => {
  it("refuses to build without the licensed address", () => {
    vi.stubEnv("DRE_LICENSED_ADDRESS", "");
    expect(() => kuberaBrokerBlock({ name: "Neeli Khanna", dreLicense: "02123456" })).toThrow();
  });
});
