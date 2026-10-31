import { describe, expect, it } from "vitest";
import { assertBoxTransition, boxFromRegistration, CreditBoxError, editPatch, parseCreditBoxTerms, parseStates, programsForRegistration, reviewPatch } from "./credit-box";
import { NOW, creditBox } from "./test-fixtures";
import type { PartnerRow } from "./credit-box";

const registration = (profile: Record<string, unknown>, over: Partial<PartnerRow> = {}): PartnerRow => ({
  id: "partner-1",
  partnerType: "LENDER",
  organization: "Pacific Senior Capital",
  email: "lending@pacific.example",
  status: "PENDING_REVIEW",
  createdAt: "2026-10-30T12:00:00.000Z",
  profile,
  ...over,
});

describe("parseStates", () => {
  it("keeps valid two-letter codes, sorted and unique", () => {
    expect(parseStates("CA, az & nv; CA, XX")).toEqual(["AZ", "CA", "NV"]);
    expect(parseStates(["tx", "ok"])).toEqual(["OK", "TX"]);
  });
  it("treats blank and nationwide as everywhere", () => {
    expect(parseStates("")).toEqual([]);
    expect(parseStates("Nationwide")).toEqual([]);
    expect(parseStates(null)).toEqual([]);
  });
});

describe("programsForRegistration", () => {
  it("maps lender types and appetite to deal-desk programs", () => {
    expect(programsForRegistration("HUD_LENDER", ["SENIOR_LIVING"])).toEqual(["HUD_232"]);
    expect(programsForRegistration("HUD_LENDER", [])).toEqual(["HUD_232", "HUD_MULTIFAMILY"]);
    expect(programsForRegistration("DEBT_FUND", ["HOSPITALITY", "CONSTRUCTION"])).toEqual(["PIP_BRIDGE", "PRIVATE_BRIDGE", "CONSTRUCTION"]);
    expect(programsForRegistration("DEBT_FUND", ["MULTIFAMILY"])).toEqual(["PRIVATE_BRIDGE"]);
    expect(programsForRegistration("SBA_CDC", [])).toEqual(["SBA_504"]);
    expect(programsForRegistration("PRIVATE", [])).toEqual(["PRIVATE_BRIDGE", "HARD_MONEY"]);
    expect(programsForRegistration("UNKNOWN", [])).toEqual([]);
  });
});

describe("boxFromRegistration", () => {
  it("turns a /partners lender registration into typed appetite", () => {
    const box = boxFromRegistration(
      registration({
        lenderKind: "HUD_LENDER",
        minLoan: 2_000_000,
        maxLoan: 40_000_000,
        verticals: ["SENIOR_LIVING", "BOGUS"],
        states: "CA, AZ",
        maxLtv: 80,
        maxLtc: 0,
        minDscr: 1.45,
        minDebtYield: 0,
        flagRequirements: "",
        brokerFeeProtectionPct: 0.5,
      }),
    );
    expect(box).toMatchObject({
      label: "Pacific Senior Capital · HUD MAP / LEAN lender (registration)",
      programs: ["HUD_232"],
      assetClasses: ["SENIOR_LIVING"],
      states: ["AZ", "CA"],
      minLoanCents: 200_000_000,
      maxLoanCents: 4_000_000_000,
      maxLtvPct: 80,
      maxLtcPct: null,
      minDscr: 1.45,
      minDebtYieldPct: null,
      brokerCompensationPct: 0.5,
      lienPositions: ["first"],
      franchiseRequirements: null,
    });
    expect(box.notes).toMatch(/Lender-stated; verify before approving/);
  });

  it("drops implausible values instead of trusting them", () => {
    const box = boxFromRegistration(registration({ lenderKind: "PRIVATE", minLoan: 5_000_000, maxLoan: 1_000_000, maxLtv: 400, minDscr: 9 }, { organization: null }));
    expect(box.maxLoanCents).toBeNull();
    expect(box.maxLtvPct).toBeNull();
    expect(box.minDscr).toBeNull();
    expect(box.label).toMatch(/^lending@pacific.example/);
  });

  it("refuses non-lender registrations", () => {
    expect(() => boxFromRegistration(registration({}, { partnerType: "VENDOR" }))).toThrow(CreditBoxError);
  });
});

describe("parseCreditBoxTerms", () => {
  it("validates ranges and de-duplicates lists", () => {
    const t = parseCreditBoxTerms({ label: "Box", programs: ["HUD_232", "HUD_232"], states: ["ca"], lienPositions: ["first", "first"] });
    expect(t.programs).toEqual(["HUD_232"]);
    expect(t.states).toEqual(["CA"]);
    expect(t.lienPositions).toEqual(["first"]);
    expect(() => parseCreditBoxTerms({ label: "Box", minLoanCents: 10, maxLoanCents: 5 })).toThrow(/below the minimum/);
    expect(() => parseCreditBoxTerms({ label: "Box", programs: ["NOPE"] })).toThrow(CreditBoxError);
    expect(() => parseCreditBoxTerms({ label: "", programs: [] })).toThrow(CreditBoxError);
  });
});

describe("review", () => {
  it("approves only a box linked to a lender, with programs, and stamps the review", () => {
    const pending = creditBox({ status: "pending_review", reviewedAt: null, reviewedBy: null, verifiedAt: null });
    const patch = reviewPatch(pending, { to: "approved", actor: "broker:ana" }, NOW);
    expect(patch).toMatchObject({ status: "approved", reviewedBy: "broker:ana", verifiedAt: NOW.toISOString(), verifiedBy: "broker:ana" });
    expect(() => reviewPatch({ ...pending, lenderId: null }, { to: "approved", actor: "a" }, NOW)).toThrow(/Link the box/);
    expect(() => reviewPatch({ ...pending, programs: [] }, { to: "approved", actor: "a" }, NOW)).toThrow(/at least one program/);
    expect(() => reviewPatch(pending, { to: "rejected", actor: "a" }, NOW)).toThrow(/why/);
    expect(reviewPatch(pending, { to: "rejected", actor: "a", note: "Not lending in CA" }, NOW)).toMatchObject({ status: "rejected", reviewNote: "Not lending in CA" });
  });

  it("enforces the status machine", () => {
    expect(() => assertBoxTransition("approved", "rejected")).toThrow(/cannot become rejected/);
    expect(() => assertBoxTransition("retired", "approved")).toThrow();
    expect(() => assertBoxTransition("retired", "pending_review")).not.toThrow();
  });

  it("sends an edited approved box back to review", () => {
    const box = creditBox();
    const same = parseCreditBoxTerms({ ...box });
    expect(editPatch(box, same)).toEqual({});
    expect(editPatch(box, { ...same, maxLtvPct: 85 })).toMatchObject({ maxLtvPct: 85, status: "pending_review" });
    expect(editPatch({ ...box, status: "pending_review" }, { ...same, maxLtvPct: 85 })).not.toHaveProperty("status");
  });
});
