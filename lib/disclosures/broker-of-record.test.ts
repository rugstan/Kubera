import { describe, expect, it } from "vitest";
import { brokerOfRecordRow, evaluateBrokerOfRecord, type BrokerOfRecordInput } from "./broker-of-record";

const elements = {
  arrangingLicensee: { name: "Neeli Khanna", dreLicense: "02123456", activeAtTransaction: true },
  actsFor: "borrower" as const,
  engagementAgreementRef: "vault://engagements/1.pdf",
  compensation: { amountUsd: 85_000, payer: "borrower" as const, expected: true },
  negotiationLog: [{ at: "2026-10-08T17:00:00Z", kind: "term_sheet" as const, ref: "ts-v2", summary: "" }],
  businessPurposeCertified: true,
  officerApproval: { name: "Neeli Khanna", dreLicense: "02123456", approvedAt: "2026-10-20T17:00:00Z" },
};

const loan: BrokerOfRecordInput = {
  recordKind: "loan",
  leadId: "11111111-1111-4111-8111-111111111111",
  lender: { name: "Pacific Bridge Partners LLC", category: "PRIVATE_NON_EXEMPT" },
  collateral: { realPropertyLien: true, apn: "006-123-045", lienPosition: 1 },
  noteRatePct: 12,
  fedDiscountRatePct: 4.5,
  elements,
  transactionDate: "2026-11-15",
};

describe("broker-of-record file", () => {
  it("evaluates a loan through gate H", () => {
    const e = evaluateBrokerOfRecord(loan);
    expect(e.kind).toBe("loan");
    expect(e.result.status).toBe("cleared");
  });

  it("evaluates a modification against the parent loan's lender and collateral", () => {
    const e = evaluateBrokerOfRecord({
      ...loan,
      recordKind: "extension",
      parentId: "22222222-2222-4222-8222-222222222222",
      effectiveDate: "2026-06-01",
      arrangedBy: "lender_or_servicer_only",
    });
    expect(e.kind).toBe("modification");
    expect(e.result.status).toBe("no_exemption_representation");
  });

  it("maps to a broker_of_record row with gate results", () => {
    const row = brokerOfRecordRow({ ...loan, elements: { ...elements, officerApproval: undefined } });
    expect(row).toMatchObject({
      record_kind: "loan",
      arranged_by: "kubera",
      parent_id: null,
      lender_category: "PRIVATE_NON_EXEMPT",
      collateral_real_property_lien: true,
      arranging_licensee_dre: "02123456",
      compensation_amount_usd: 85_000,
      gate_status: "blocked",
      gate_blocking: true,
    });
    expect(row.flags).toEqual(expect.arrayContaining(["broker_of_record_incomplete", "officer_approval_required"]));
  });

  it("requires a parent loan for modifications", () => {
    expect(() => evaluateBrokerOfRecord({ ...loan, recordKind: "modification", effectiveDate: "2026-06-01", arrangedBy: "kubera" } as unknown as BrokerOfRecordInput)).toThrow();
  });
});
