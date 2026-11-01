import { describe, expect, it } from "vitest";
import { evaluateUsury } from "@/lib/compliance/gates";
import { brokerOfRecordRow } from "@/lib/disclosures/broker-of-record";
import { fromRow, loanBrokerOfRecordFromRow, toRow } from "./rows";
import { fullElements } from "./test-fixtures";

describe("row mapping", () => {
  it("converts top-level keys only and coerces numeric columns", () => {
    const row = toRow({ loanAmountCents: 5, sba159Category: "packaging", lockedTerms: { noteRatePct: 6 }, manifestSha256: "x", skip: undefined });
    expect(row).toEqual({ loan_amount_cents: 5, sba159_category: "packaging", locked_terms: { noteRatePct: 6 }, manifest_sha256: "x" });
    expect(fromRow<Record<string, unknown>>({ loan_amount_cents: "500", locked_terms: { note_rate: 1 }, as_of: "2026-01-01" }, ["loanAmountCents"])).toEqual({ loanAmountCents: 500, lockedTerms: { note_rate: 1 }, asOf: "2026-01-01" });
  });

  it("reads a WS-W loan broker-of-record row back into the same gate-H result", () => {
    const input = {
      recordKind: "loan" as const,
      dealId: "00000000-0000-4000-8000-000000000001",
      lender: { name: "Fidelis Private Fund", category: "PRIVATE_NON_EXEMPT" as const },
      collateral: { realPropertyLien: true, equityPledgeOrUccOnly: false, apn: "001-002-003", lienPosition: 1 },
      noteRatePct: 12.5,
      fedDiscountRatePct: 4.5,
      elements: { ...fullElements, officerApproval: { name: "Neeli Khanna", dreLicense: "01234567", approvedAt: "2026-10-30T17:00:00.000Z" } },
      transactionDate: "2026-11-01",
    };
    const row = { id: "11111111-1111-4111-8111-111111111111", ...brokerOfRecordRow(input) };
    const loan = loanBrokerOfRecordFromRow(row);
    expect(loan).toMatchObject({ lender: input.lender, noteRatePct: 12.5, collateral: input.collateral, transactionDate: "2026-11-01" });
    const direct = evaluateUsury({ ...input, tableFundedInKuberaName: false });
    const roundTrip = evaluateUsury({ lender: loan.lender, noteRatePct: loan.noteRatePct, fedDiscountRatePct: loan.fedDiscountRatePct, collateral: loan.collateral, elements: loan.elements, tableFundedInKuberaName: loan.tableFundedInKuberaName, transactionDate: loan.transactionDate });
    expect(roundTrip.status).toBe(direct.status);
    expect(roundTrip.status).toBe("cleared");
    expect(roundTrip.missing).toEqual([]);
  });

  it("round-trips the lender's charges, the effective rate and the names on the loan documents", () => {
    const input = {
      recordKind: "loan" as const,
      dealId: "00000000-0000-4000-8000-000000000001",
      lender: { name: "Pacific Bridge Partners LLC", category: "PRIVATE_NON_EXEMPT" as const },
      collateral: { realPropertyLien: true, equityPledgeOrUccOnly: false },
      noteRatePct: 9.5,
      fedDiscountRatePct: 4.5,
      lenderCharges: { lenderPointsPct: 1, exitFeePct: 0.5, minimumInterestMonths: 3, termMonths: 6 },
      elements: fullElements,
      transactionDate: "2026-11-01",
      tableFunded: true,
      trueFundingSource: "Pacific Bridge Fund I",
      deedBeneficiaryName: "Pacific Bridge Partners LLC",
      originatorName: "Pacific Bridge Partners LLC",
    };
    const row = { id: "11111111-1111-4111-8111-111111111111", ...brokerOfRecordRow(input) };
    expect(row).toMatchObject({ lender_points_pct: 1, lender_exit_fee_pct: 0.5, minimum_interest_months: 3, charges_term_months: 6, effective_rate_pct: 12.5, gate_status: "blocked" });
    const loan = loanBrokerOfRecordFromRow({ ...row, lender_points_pct: "1.0000", effective_rate_pct: "12.5000" });
    expect(loan).toMatchObject({ lenderCharges: { lenderPointsPct: 1, exitFeePct: 0.5, minimumInterestMonths: 3, termMonths: 6 }, effectiveRatePct: 12.5, tableFunded: true, trueFundingSource: "Pacific Bridge Fund I", deedBeneficiaryName: "Pacific Bridge Partners LLC" });
    expect(loan.elements.compensation).toEqual(fullElements.compensation);
  });
});
