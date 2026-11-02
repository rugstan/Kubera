import { describe, expect, it } from "vitest";
import {
  BROKER_ELEMENT_LABELS,
  BROKER_OF_RECORD_FILE_MISSING,
  SB1146_EFFECTIVE_DATE,
  USURY_NEUTRAL_STATEMENT,
  borrowerDocumentGate,
  containsExemptionClaim,
  effectiveRatePct,
  evaluateDealCompliance,
  evaluateModification,
  evaluateUsury,
  missingBrokerElements,
  mldsRequirement,
  stageAdvanceGate,
  usuryCapPct,
  type FlagCode,
} from "./gates";
import { corinRoles, type BrokerOfRecordElements, type CorinRole, type MldsFacts, type ModificationFacts, type UsuryFacts } from "./schemas";

const codes = (flags: { code: FlagCode }[]) => flags.map((f) => f.code);

const rp = { realPropertyLien: true, apn: "123-456-789", lienPosition: 1, propertyState: "CA" };
const ucc = { realPropertyLien: false, equityPledgeOrUccOnly: true };
const businessAssets = { realPropertyLien: false };

const completeElements: BrokerOfRecordElements = {
  arrangingLicensee: { name: "Neeli Khanna", dreLicense: "02123456", activeAtTransaction: true },
  actsFor: "borrower",
  engagementAgreementRef: "vault://engagements/acme-2026-11.pdf",
  compensation: { amountUsd: 85_000, payer: "borrower", expected: true, closingStatementLine: "801" },
  negotiationLog: [
    { at: "2026-10-01T17:00:00Z", kind: "lender_submission", ref: "pkg-v1", summary: "Submitted package to three lenders" },
    { at: "2026-10-08T17:00:00Z", kind: "term_sheet", ref: "ts-v2", summary: "Negotiated rate and IO period" },
  ],
  businessPurposeCertified: true,
  officerApproval: { name: "Neeli Khanna", dreLicense: "02123456", approvedAt: "2026-10-20T17:00:00Z" },
};

const privateLender = { name: "Pacific Bridge Partners LLC", category: "PRIVATE_NON_EXEMPT" as const };
const bank = { name: "First Coast Bank, N.A.", category: "NATIONAL_BANK" as const, evidenceRef: "OCC charter 12345" };

const usury = (over: Partial<UsuryFacts> = {}): UsuryFacts => ({
  lender: privateLender,
  noteRatePct: 12.5,
  fedDiscountRatePct: 4.5,
  collateral: rp,
  elements: completeElements,
  transactionDate: "2026-11-15",
  ...over,
});

// ---------------------------------------------------------------------------

describe("gate A: MLDS trigger matrix", () => {
  const matrix: { role: CorinRole; realProperty: boolean; required: boolean; cfl: boolean }[] = corinRoles.flatMap((role) =>
    [true, false].map((realProperty) => ({
      role,
      realProperty,
      required: realProperty && role !== "unpaid_referral",
      cfl: !realProperty && role !== "unpaid_referral",
    })),
  );

  it.each(matrix)("role=$role realProperty=$realProperty → required=$required cfl=$cfl", ({ role, realProperty, required, cfl }) => {
    const r = mldsRequirement({ corinRole: role, collateral: realProperty ? rp : businessAssets });
    expect(r.required).toBe(required);
    expect(r.form).toBe(required ? "RE882" : null);
    expect(codes(r.flags).includes("cfl_license_review")).toBe(cfl);
    expect(r.heldForCounsel).toBe(false);
  });

  it("requires an MLDS at any loan size and from any lender (no carve-out inputs exist)", () => {
    expect(mldsRequirement({ corinRole: "broker", collateral: rp, program: "HUD_232" }).required).toBe(true);
    expect(mldsRequirement({ corinRole: "broker", collateral: rp, program: "SBA_504" }).required).toBe(true);
  });

  it("treats a paid referral where the lender negotiates as MLDS-required", () => {
    const r = mldsRequirement({ corinRole: "paid_referral", collateral: rp });
    expect(r.required).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/Paid referral/);
  });

  it("flags business-asset-only SBA 7(a) for CFL license review with no MLDS", () => {
    const r = mldsRequirement({ corinRole: "broker", collateral: businessAssets, program: "SBA_7A" });
    expect(r.required).toBe(false);
    expect(r.flags).toEqual([expect.objectContaining({ code: "cfl_license_review", reason: expect.stringContaining("SBA 7(a)") })]);
  });

  it("treats equity-pledge / UCC-only collateral as no real-property lien", () => {
    const r = mldsRequirement({ corinRole: "broker", collateral: ucc });
    expect(r.required).toBe(false);
    expect(codes(r.flags)).toContain("cfl_license_review");
  });

  it("rejects contradictory collateral", () => {
    expect(() => mldsRequirement({ corinRole: "broker", collateral: { realPropertyLien: true, equityPledgeOrUccOnly: true } })).toThrow(/both/);
  });

  it("rejects Corin as lender: the role enum has no lender value", () => {
    expect(() => mldsRequirement({ corinRole: "lender" as CorinRole, collateral: rp })).toThrow();
  });

  it.each<[keyof MldsFacts, string]>([
    ["namesCorinAsBeneficiary", "beneficiary"],
    ["namesCorinAsOriginator", "originator"],
    ["tableFundedInCorinName", "Table-funded"],
    ["nonTraditionalResidential1to4", "RE 885"],
  ])("holds for counsel when %s", (key, text) => {
    const r = mldsRequirement({ corinRole: "broker", collateral: rp, [key]: true });
    expect(r.heldForCounsel).toBe(true);
    expect(r.required).toBe(true);
    expect(r.flags.find((f) => f.code === "held_for_counsel")?.reason).toContain(text);
  });
});

describe("gate A: hard blocks", () => {
  const required = mldsRequirement({ corinRole: "broker", collateral: rp });
  const notRequired = mldsRequirement({ corinRole: "broker", collateral: businessAssets });
  const held = mldsRequirement({ corinRole: "broker", collateral: rp, namesCorinAsOriginator: true });

  it.each(["required", "generated", "sent", null] as const)("blocks commitments and loan documents while the MLDS is %s", (status) => {
    for (const kind of ["commitment", "loan_document"] as const) {
      const d = borrowerDocumentGate(kind, { requirement: required, status });
      expect(d.allowed).toBe(false);
      expect(d.reasons.join(" ")).toMatch(/signed MLDS/);
    }
  });

  it("allows borrower documents once the MLDS is signed", () => {
    expect(borrowerDocumentGate("commitment", { requirement: required, status: "signed" }).allowed).toBe(true);
  });

  it("does not block when no MLDS is required", () => {
    expect(borrowerDocumentGate("loan_document", { requirement: notRequired, status: null }).allowed).toBe(true);
  });

  it("blocks everything for deals held for counsel, even if signed", () => {
    expect(borrowerDocumentGate("commitment", { requirement: held, status: "signed" })).toEqual({ allowed: false, reasons: ["Deal is held for counsel review."] });
    expect(borrowerDocumentGate("commitment", { requirement: required, status: "held_for_counsel" }).allowed).toBe(false);
  });

  it("blocks the move to closing without a signed MLDS", () => {
    const now = new Date("2026-11-20T18:00:00Z");
    const unsigned = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: rp }, status: "sent" }, now });
    expect(stageAdvanceGate("closing", unsigned).allowed).toBe(false);
    expect(stageAdvanceGate("CLOSED_WON", unsigned).allowed).toBe(false);
    expect(stageAdvanceGate("term_sheet", unsigned).allowed).toBe(true);
    const signed = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: rp }, status: "signed" }, usury: usury(), now });
    expect(stageAdvanceGate("closing", signed).allowed).toBe(true);
    expect(signed.gates.borrowerCommitment.allowed).toBe(true);
  });
});

describe("gate A: timer flags in the deal evaluation", () => {
  const facts: MldsFacts = { corinRole: "broker", collateral: rp };
  const applicationCompletedAt = new Date("2026-11-25T18:00:00Z");

  it("adds mlds_warning on business day 2 and mlds_overdue after the deadline", () => {
    const warn = evaluateDealCompliance({ mlds: { facts, status: "generated" }, timer: { applicationCompletedAt }, now: new Date("2026-12-01T17:00:00Z") });
    expect(codes(warn.flags)).toContain("mlds_warning");
    const overdue = evaluateDealCompliance({ mlds: { facts, status: "generated" }, timer: { applicationCompletedAt }, now: new Date("2026-12-04T17:00:00Z") });
    expect(codes(overdue.flags)).toContain("mlds_overdue");
    expect(overdue.timer?.status).toBe("overdue");
  });

  it("adds mlds_late when it was delivered after the deadline", () => {
    const late = evaluateDealCompliance({
      mlds: { facts, status: "signed" },
      timer: { applicationCompletedAt, deliveredAt: new Date("2026-12-05T17:00:00Z") },
      now: new Date("2026-12-10T17:00:00Z"),
    });
    expect(codes(late.flags)).toContain("mlds_late");
  });

  it("skips the timer when no MLDS is required", () => {
    const r = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: businessAssets }, status: null }, timer: { applicationCompletedAt }, now: new Date("2026-12-10T17:00:00Z") });
    expect(r.timer).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("gate H: art. XV cap", () => {
  it("is the greater of 10% or 5% + the FRBSF discount rate", () => {
    expect(usuryCapPct(4.5)).toBe(10);
    expect(usuryCapPct(5)).toBe(10);
    expect(usuryCapPct(6.25)).toBe(11.25);
    expect(usuryCapPct(0)).toBe(10);
  });
});

describe("gate H: broker-of-record elements", () => {
  it("finds nothing missing on a complete file", () => {
    expect(missingBrokerElements(completeElements, { requireOfficerApproval: true, collateral: rp })).toEqual([]);
  });

  it.each([
    ["APN", { realPropertyLien: true, lienPosition: 1 }],
    ["blank APN", { realPropertyLien: true, apn: "  ", lienPosition: 1 }],
    ["lien position", { realPropertyLien: true, apn: "123-456-789" }],
    ["APN and lien position", { realPropertyLien: true }],
  ])("reports missing collateral identification without the %s", (_label, collateral) => {
    expect(missingBrokerElements(completeElements, { requireOfficerApproval: true, collateral })).toEqual(["collateral_identification"]);
  });

  it("does not ask for an APN when no real-property lien secures the loan", () => {
    expect(missingBrokerElements(completeElements, { requireOfficerApproval: true, collateral: ucc })).toEqual([]);
    expect(missingBrokerElements(completeElements, { requireOfficerApproval: true, collateral: businessAssets })).toEqual([]);
  });

  it.each<[string, BrokerOfRecordElements, string]>([
    ["arranging licensee", { ...completeElements, arrangingLicensee: undefined }, "arranging_licensee"],
    ["inactive license", { ...completeElements, arrangingLicensee: { name: "X", dreLicense: "01234567", activeAtTransaction: false } }, "licensee_active"],
    ["party acted for", { ...completeElements, actsFor: undefined }, "acts_for"],
    ["engagement agreement", { ...completeElements, engagementAgreementRef: undefined }, "engagement_agreement"],
    ["compensation", { ...completeElements, compensation: undefined }, "compensation"],
    ["zero compensation", { ...completeElements, compensation: { amountUsd: 0, payer: "lender", expected: false } }, "compensation"],
    ["negotiation (communications only)", { ...completeElements, negotiationLog: [{ at: "2026-10-01T17:00:00Z", kind: "communication", ref: "mail-1" }] }, "negotiation_log"],
    ["business-purpose certification", { ...completeElements, businessPurposeCertified: false }, "business_purpose_certification"],
    ["officer approval", { ...completeElements, officerApproval: undefined }, "officer_approval"],
  ])("reports missing %s", (_label, elements, code) => {
    expect(missingBrokerElements(elements, { requireOfficerApproval: true, collateral: rp })).toEqual([code]);
  });

  it("validates DRE license format", () => {
    expect(() => missingBrokerElements({ ...completeElements, arrangingLicensee: { name: "X", dreLicense: "123", activeAtTransaction: true } }, { requireOfficerApproval: false, collateral: rp })).toThrow(/8 digits/);
  });

  it("has a label for every element", () => {
    expect(Object.keys(BROKER_ELEMENT_LABELS)).toHaveLength(9);
    expect(BROKER_ELEMENT_LABELS.collateral_identification).toBe("Collateral APN and lien position");
  });
});

describe("gate H: usury evaluation", () => {
  it("does not gate an exempt lender with evidence", () => {
    const r = evaluateUsury(usury({ lender: bank, noteRatePct: 14, elements: {} }));
    expect(r.status).toBe("lender_exempt");
    expect(r.blocking).toBe(false);
    // Elements are still recorded on every loan.
    expect(codes(r.flags)).toContain("broker_of_record_incomplete");
  });

  it("treats an exempt category without evidence as non-exempt", () => {
    const r = evaluateUsury(usury({ lender: { name: "Some Bank", category: "STATE_BANK" }, noteRatePct: 12, elements: {} }));
    expect(r.lenderExempt).toBe(false);
    expect(codes(r.flags)).toContain("lender_category_unverified");
    expect(r.status).toBe("blocked");
  });

  it("does not gate a non-exempt lender at or below the cap", () => {
    const r = evaluateUsury(usury({ noteRatePct: 10, elements: {} }));
    expect(r.status).toBe("within_cap");
    expect(r.blocking).toBe(false);
    expect(r.aboveCap).toBe(false);
  });

  it("blocks a non-exempt lender above the cap until every element is recorded", () => {
    const r = evaluateUsury(usury({ elements: { ...completeElements, engagementAgreementRef: undefined } }));
    expect(r.status).toBe("blocked");
    expect(r.blocking).toBe(true);
    expect(r.missing).toEqual(["engagement_agreement"]);
  });

  it("blocks until the designated officer approves", () => {
    const r = evaluateUsury(usury({ elements: { ...completeElements, officerApproval: undefined } }));
    expect(r.status).toBe("blocked");
    expect(codes(r.flags)).toContain("officer_approval_required");
  });

  it("clears (without claiming an exemption) when the file is complete", () => {
    const r = evaluateUsury(usury());
    expect(r.status).toBe("cleared");
    expect(r.blocking).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not a determination/);
    expect(containsExemptionClaim(r.reasons.join(" "))).toBe(false);
  });

  it("blocks a non-exempt, above-cap loan until the collateral APN and lien position are recorded", () => {
    const noApn = evaluateUsury({
      lender: { name: "Pacific Bridge Partners LLC", category: "PRIVATE_NON_EXEMPT" },
      noteRatePct: 12,
      fedDiscountRatePct: 4.5,
      collateral: { realPropertyLien: true },
      elements: completeElements,
      transactionDate: "2026-11-15",
    });
    expect(noApn).toMatchObject({ status: "blocked", blocking: true, missing: ["collateral_identification"] });
    expect(noApn.flags.find((f) => f.code === "broker_of_record_incomplete")?.reason).toContain("Collateral APN and lien position");
    expect(evaluateUsury(usury({ noteRatePct: 12, collateral: { realPropertyLien: true, lienPosition: 1 } })).status).toBe("blocked");
    expect(evaluateUsury(usury({ noteRatePct: 12, collateral: { realPropertyLien: true, apn: "123-456-789" } })).status).toBe("blocked");

    const recorded = evaluateUsury(usury({ noteRatePct: 12, collateral: { realPropertyLien: true, apn: "123-456-789", lienPosition: 2 } }));
    expect(recorded).toMatchObject({ status: "cleared", blocking: false, missing: [] });
  });

  it("blocks closing on a cleared-looking file with no APN", () => {
    const r = evaluateDealCompliance({
      mlds: { facts: { corinRole: "broker", collateral: rp }, status: "signed" },
      usury: usury({ collateral: { realPropertyLien: true, lienPosition: 1 } }),
      now: new Date("2026-11-20T18:00:00Z"),
    });
    expect(r.gates.closing.allowed).toBe(false);
    expect(r.gates.closing.reasons).toContain("Missing: Collateral APN and lien position");
  });

  it("records the missing APN on a within-cap loan without blocking it", () => {
    const r = evaluateUsury(usury({ noteRatePct: 9, collateral: { realPropertyLien: true } }));
    expect(r).toMatchObject({ status: "within_cap", blocking: false, missing: ["collateral_identification"] });
    expect(codes(r.flags)).toContain("broker_of_record_incomplete");
  });

  it("uses the higher cap when the discount rate is high", () => {
    expect(evaluateUsury(usury({ fedDiscountRatePct: 6, noteRatePct: 10.75, elements: {} })).status).toBe("within_cap");
    expect(evaluateUsury(usury({ fedDiscountRatePct: 6, noteRatePct: 11.25, elements: {} })).status).toBe("blocked");
  });

  it("flags usury_exemption_unavailable for equity-pledge / UCC-only collateral", () => {
    const within = evaluateUsury(usury({ collateral: ucc, noteRatePct: 9 }));
    expect(codes(within.flags)).toContain("usury_exemption_unavailable");
    expect(within.blocking).toBe(false);
    const above = evaluateUsury(usury({ collateral: ucc }));
    expect(above.status).toBe("held_for_counsel");
    expect(above.blocking).toBe(true);
    expect(codes(above.flags)).toEqual(expect.arrayContaining(["usury_exemption_unavailable", "held_for_counsel"]));
  });

  it("holds table-funded deals naming Corin for counsel regardless of rate or lender", () => {
    for (const lender of [bank, privateLender]) {
      const r = evaluateUsury(usury({ lender, noteRatePct: 7, tableFundedInCorinName: true }));
      expect(r.status).toBe("held_for_counsel");
      expect(r.blocking).toBe(true);
    }
  });
});

describe("gate H: modifications (SB 1146)", () => {
  const loan = { lender: privateLender, fedDiscountRatePct: 4.5, collateral: rp };
  const mod = (over: Partial<ModificationFacts> = {}): ModificationFacts => ({
    kind: "extension",
    effectiveDate: "2026-06-01",
    arrangedBy: "corin",
    agreementRecitesBrokerArrangement: true,
    noteRatePct: 12,
    elements: completeElements,
    ...over,
  });

  it("holds pre-2025 modifications for counsel", () => {
    const r = evaluateModification(mod({ effectiveDate: "2024-12-31" }), loan);
    expect(r.status).toBe("held_for_counsel");
    expect(r.blocking).toBe(true);
    expect(evaluateModification(mod({ effectiveDate: SB1146_EFFECTIVE_DATE }), loan).status).toBe("documented");
  });

  it("flags lender/servicer-only modifications: no exemption representation + written notice", () => {
    const r = evaluateModification(mod({ arrangedBy: "lender_or_servicer_only", elements: undefined }), loan);
    expect(r.status).toBe("no_exemption_representation");
    expect(r.brokerArrangementDocumented).toBe(false);
    expect(r.lenderNoticeRequired).toBe(true);
    expect(codes(r.flags)).toEqual(["no_exemption_representation", "lender_written_notice_required"]);
    const noticed = evaluateModification(mod({ arrangedBy: "lender_or_servicer_only", lenderNoticeSentAt: "2026-06-02T17:00:00Z" }), loan);
    expect(noticed.lenderNoticeRequired).toBe(false);
    expect(codes(noticed.flags)).toEqual(["no_exemption_representation"]);
  });

  it("requires its own elements when Corin arranges it", () => {
    const r = evaluateModification(mod({ elements: { ...completeElements, compensation: undefined, engagementAgreementRef: undefined } }), loan);
    expect(r.status).toBe("incomplete");
    expect(r.missing).toEqual(["engagement_agreement", "compensation"]);
    expect(r.blocking).toBe(true);
  });

  it("keeps an above-cap Corin-arranged modification blocked until the loan's APN and lien position are recorded", () => {
    const noApn = evaluateModification(mod({ noteRatePct: 12 }), { ...loan, collateral: { realPropertyLien: true, lienPosition: 1 } });
    expect(noApn).toMatchObject({ status: "incomplete", blocking: true, missing: ["collateral_identification"] });
    const recorded = evaluateModification(mod({ noteRatePct: 12 }), loan);
    expect(recorded).toMatchObject({ status: "documented", blocking: false, missing: [] });
  });

  it("requires the agreement to recite the broker arrangement", () => {
    const r = evaluateModification(mod({ agreementRecitesBrokerArrangement: false }), loan);
    expect(r.missing).toEqual(["agreement_recital"]);
  });

  it("requires officer approval only when the modified rate exceeds the cap for a non-exempt lender", () => {
    const noOfficer = { ...completeElements, officerApproval: undefined };
    expect(evaluateModification(mod({ elements: noOfficer, noteRatePct: 12 }), loan).missing).toEqual(["officer_approval"]);
    expect(evaluateModification(mod({ elements: noOfficer, noteRatePct: 9 }), loan).missing).toEqual([]);
    expect(evaluateModification(mod({ elements: noOfficer, noteRatePct: 12 }), { ...loan, lender: bank }).missing).toEqual([]);
  });

  it("does not block incomplete files when the rate is within the cap", () => {
    const r = evaluateModification(mod({ noteRatePct: 9, elements: { negotiationLog: [] } }), loan);
    expect(r.status).toBe("incomplete");
    expect(r.blocking).toBe(false);
  });

  it("accepts another licensed broker's arrangement when that broker is identified", () => {
    expect(evaluateModification(mod({ arrangedBy: "other_licensed_broker", elements: undefined }), loan).missing).toEqual(["other_broker_identity"]);
    const r = evaluateModification(mod({ arrangedBy: "other_licensed_broker", otherBroker: { name: "Bay Capital Brokers", dreLicense: "01987654" }, elements: undefined }), loan);
    expect(r.status).toBe("documented");
    expect(r.brokerArrangementDocumented).toBe(true);
  });

  it("flags usury_exemption_unavailable for UCC-only collateral", () => {
    expect(codes(evaluateModification(mod(), { ...loan, collateral: ucc }).flags)).toContain("usury_exemption_unavailable");
  });

  it("holds an above-cap modification on UCC-only collateral from a non-exempt lender, whoever arranged it", () => {
    const uccLoan = { ...loan, collateral: ucc };
    for (const over of [
      { arrangedBy: "corin" as const },
      { arrangedBy: "other_licensed_broker" as const, otherBroker: { name: "Bay Capital Brokers", dreLicense: "01987654" }, elements: undefined },
      { arrangedBy: "lender_or_servicer_only" as const, elements: undefined },
    ]) {
      const r = evaluateModification(mod({ noteRatePct: 15, ...over }), uccLoan);
      expect(r.status).toBe("held_for_counsel");
      expect(r.blocking).toBe(true);
      expect(r.brokerArrangementDocumented).toBe(false);
      const held = r.flags.find((f) => f.code === "held_for_counsel");
      expect(held?.reason).toBe("Non-exempt lender: Note rate 15% exceeds the 10% cap with no real-property lien.");
      expect(held?.authority).toBe("Cal. Const. art. XV");
    }
  });

  it("does not hold a within-cap modification on UCC-only collateral", () => {
    const r = evaluateModification(mod({ noteRatePct: 9 }), { ...loan, collateral: ucc });
    expect(r.status).toBe("documented");
    expect(r.blocking).toBe(false);
    expect(codes(r.flags)).toEqual(["usury_exemption_unavailable"]);
    // An exempt lender above the cap is not held either.
    expect(evaluateModification(mod({ noteRatePct: 15 }), { ...loan, lender: bank, collateral: ucc }).status).toBe("documented");
  });

  it("blocks closing when a Corin-arranged extension takes a within-cap UCC-only loan above the cap", () => {
    const r = evaluateDealCompliance({
      mlds: { facts: { corinRole: "broker", collateral: ucc }, status: null },
      usury: usury({ collateral: ucc, noteRatePct: 9 }),
      modifications: [mod({ noteRatePct: 15 })],
      now: new Date("2026-11-20T18:00:00Z"),
    });
    expect(r.usury?.status).toBe("within_cap");
    expect(r.modifications[0]).toMatchObject({ status: "held_for_counsel", blocking: true });
    expect(r.heldForCounsel).toBe(true);
    expect(r.gates.closing.allowed).toBe(false);
  });
});

describe("whole-deal evaluation", () => {
  const now = new Date("2026-11-20T18:00:00Z");

  it("blocks closing on an uncleared usury gate even with a signed MLDS", () => {
    const r = evaluateDealCompliance({
      mlds: { facts: { corinRole: "broker", collateral: rp }, status: "signed" },
      usury: usury({ elements: { ...completeElements, officerApproval: undefined } }),
      now,
    });
    expect(r.gates.closing.allowed).toBe(false);
    expect(r.gates.closing.reasons.join(" ")).toMatch(/Designated-officer approval/);
    expect(r.gates.borrowerCommitment.allowed).toBe(true);
  });

  it("holds the whole deal when a modification predates SB 1146", () => {
    const r = evaluateDealCompliance({
      mlds: { facts: { corinRole: "broker", collateral: rp }, status: "signed" },
      usury: usury(),
      modifications: [{ kind: "modification", effectiveDate: "2024-06-01", arrangedBy: "corin", noteRatePct: 12 }],
      now,
    });
    expect(r.heldForCounsel).toBe(true);
    expect(r.gates.closing.allowed).toBe(false);
    expect(r.gates.borrowerLoanDocuments.allowed).toBe(false);
  });

  it("blocks closing with a signed MLDS but no broker-of-record file", () => {
    const r = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: rp }, status: "signed" }, now });
    expect(r.usury).toBeNull();
    expect(r.gates.closing.allowed).toBe(false);
    expect(r.gates.closing.reasons).toContain(BROKER_OF_RECORD_FILE_MISSING);
    expect(r.flags.map((f) => f.code)).toContain("broker_of_record_incomplete");
    // Business-asset-only loans record the file too.
    const assets = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: { realPropertyLien: false, equityPledgeOrUccOnly: true } }, status: null }, now });
    expect(assets.gates.closing.allowed).toBe(false);
  });

  it("blocks closing when modifications exist without the loan's usury facts", () => {
    const r = evaluateDealCompliance({
      mlds: { facts: { corinRole: "broker", collateral: rp }, status: "signed" },
      modifications: [{ kind: "extension", effectiveDate: "2026-01-01", arrangedBy: "corin", noteRatePct: 9 }],
      now,
    });
    expect(r.modifications).toEqual([]);
    expect(r.gates.closing.allowed).toBe(false);
    expect(r.gates.closing.reasons.join(" ")).toMatch(/modification\(s\) cannot be evaluated/);
  });

  it("allows closing for a clean, signed, cleared deal", () => {
    const r = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: rp }, status: "signed" }, usury: usury(), now });
    expect(r.gates.closing).toEqual({ allowed: true, reasons: [] });
    expect(r.heldForCounsel).toBe(false);
  });

  it("deduplicates flags", () => {
    const r = evaluateDealCompliance({
      mlds: { facts: { corinRole: "broker", collateral: rp, tableFundedInCorinName: true }, status: null },
      usury: usury({ tableFundedInCorinName: true }),
      now,
    });
    const keys = r.flags.map((f) => `${f.code}|${f.reason}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.heldForCounsel).toBe(true);
  });
});

describe("exemption-claim copy guard", () => {
  it.each(["This loan is usury exempt.", "Your loan will be exempt from California usury limits.", "We arrange usury-exempt loans.", "Don't worry, no usury limits apply."])(
    "catches %j",
    (text) => expect(containsExemptionClaim(text)).toBe(true),
  );

  it("accepts the neutral statement", () => {
    expect(containsExemptionClaim(USURY_NEUTRAL_STATEMENT)).toBe(false);
    expect(containsExemptionClaim("Exemptions exist for certain lenders; ask your attorney.")).toBe(false);
  });

  it("ignores negated statements but still catches a later claim", () => {
    expect(containsExemptionClaim("This is not a determination that the loan is exempt.")).toBe(false);
    expect(containsExemptionClaim("We cannot say whether the loan is exempt.")).toBe(false);
    expect(containsExemptionClaim("We cannot advise. Good news: the loan is exempt.")).toBe(true);
  });
});

describe("gate H: effective rate with lender-retained charges (VERIFY)", () => {
  const sixMonthPoint = { lenderPointsPct: 1, termMonths: 6 };

  it("annualizes points, exit fee and minimum interest beyond the term over the stated term", () => {
    expect(effectiveRatePct(9.5)).toBe(9.5);
    expect(effectiveRatePct(9.5, sixMonthPoint)).toBe(11.5);
    expect(effectiveRatePct(9.5, { lenderPointsPct: 1, exitFeePct: 0.5, termMonths: 6 })).toBe(12.5);
    // 6 months' minimum interest on a 3-month term adds 3 months of interest (2.375%) spread over 3 months.
    expect(effectiveRatePct(9.5, { minimumInterestMonths: 6, termMonths: 3 })).toBe(19);
    // Minimum interest inside the stated term adds nothing.
    expect(effectiveRatePct(9.5, { minimumInterestMonths: 3, termMonths: 12 })).toBe(9.5);
    // A recorded effective rate from the closing statement wins when higher.
    expect(effectiveRatePct(9.5, { effectiveRatePct: 10.75 })).toBe(10.75);
    expect(() => effectiveRatePct(9.5, { lenderPointsPct: 1 })).toThrow(/term in months/);
  });

  it("treats a 9.5% / 1-point / 6-month private loan as above the 10% cap: blocked until the officer approves", () => {
    const { officerApproval: _o, ...unapproved } = completeElements;
    const r = evaluateUsury(usury({ noteRatePct: 9.5, fedDiscountRatePct: 4.5, lenderCharges: sixMonthPoint, elements: unapproved }));
    expect(r).toMatchObject({ capPct: 10, noteRatePct: 9.5, effectiveRatePct: 11.5, aboveCap: true, status: "blocked", blocking: true, missing: ["officer_approval"] });
    expect(codes(r.flags)).toContain("officer_approval_required");
    // Both figures are shown.
    expect(r.reasons.join(" ")).toMatch(/Note rate 9\.5% \(effective 11\.5%/);
    // The same loan on the note rate alone was "within cap".
    expect(evaluateUsury(usury({ noteRatePct: 9.5, elements: unapproved })).status).toBe("within_cap");
    // Officer approval with every element recorded clears the block.
    expect(evaluateUsury(usury({ noteRatePct: 9.5, lenderCharges: sixMonthPoint })).status).toBe("cleared");
  });

  it("evaluates a modification's own lender charges against the cap", () => {
    const loan = { lender: privateLender, fedDiscountRatePct: 4.5, collateral: rp };
    const { officerApproval: _o, ...unapproved } = completeElements;
    const base: ModificationFacts = { kind: "extension", effectiveDate: "2026-06-01", arrangedBy: "corin", agreementRecitesBrokerArrangement: true, noteRatePct: 9.5, elements: unapproved };
    expect(evaluateModification(base, loan)).toMatchObject({ status: "documented", aboveCap: false });
    const withFee = evaluateModification({ ...base, lenderCharges: { exitFeePct: 1, termMonths: 6 } }, loan);
    expect(withFee).toMatchObject({ status: "incomplete", blocking: true, effectiveRatePct: 11.5, aboveCap: true, missing: ["officer_approval"] });
  });

  it("never accepts Corin as the lender of record", () => {
    expect(() => evaluateUsury(usury({ lender: { name: "Corin Commercial, Inc.", category: "PRIVATE_NON_EXEMPT" } }))).toThrow(/never the lender/);
    // The former name can still appear on documents until the rename is recorded everywhere.
    expect(() => evaluateUsury(usury({ lender: { name: "Kubera Commercial, Inc.", category: "PRIVATE_NON_EXEMPT" } }))).toThrow(/never the lender/);
    // A word that merely contains the name is not the firm.
    expect(() => evaluateUsury(usury({ lender: { name: "Scoring Capital Partners", category: "PRIVATE_NON_EXEMPT" } }))).not.toThrow(/never the lender/);
  });
});

describe("gate A: an open MLDS stays required", () => {
  it("keeps the signed-MLDS closing block when the collateral answer changes after the case opened", () => {
    const now = new Date("2026-11-20T18:00:00Z");
    for (const status of ["required", "generated", "sent"] as const) {
      const r = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: businessAssets }, status }, usury: usury(), now });
      expect(r.mlds.required).toBe(true);
      expect(r.gates.closing.reasons).toContain("No deal moves to closing without a signed MLDS (RE 882) on file.");
      expect(r.gates.borrowerCommitment.allowed).toBe(false);
    }
    const none = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: businessAssets }, status: null }, usury: usury(), now });
    expect(none.mlds.required).toBe(false);
  });

  it("holds deals whose documents name Corin as beneficiary or originator", () => {
    const now = new Date("2026-11-20T18:00:00Z");
    for (const flag of ["namesCorinAsBeneficiary", "namesCorinAsOriginator"] as const) {
      const r = evaluateDealCompliance({ mlds: { facts: { corinRole: "broker", collateral: rp, [flag]: true }, status: "signed" }, usury: usury(), now });
      expect(r.heldForCounsel).toBe(true);
      expect(r.gates.closing.reasons).toContain("Deal is held for counsel review.");
    }
  });
});
