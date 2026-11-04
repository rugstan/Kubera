import { describe, expect, it } from "vitest";
import { leadSchema } from "@/lib/validation";
import {
  ASSETS,
  ASSET_GROUPS,
  EMPTY_VALUES,
  PROJECT_PICKS,
  STEP_FIELDS,
  assetGroupsFor,
  assetStepHeading,
  assetsFor,
  buildQualifyPayload,
  familyFromParams,
  familyTransaction,
  offersHardMoney,
  prefillFromParams,
  qualifierSchema,
  transactionAfterAssetChoice,
  transactionAfterFamilyChange,
  transactionOptions,
  valueLabel,
  type QualifierValues,
} from "./schema";

const META = { textVersion: "qualifier-contact-2026-10-31", page: "/express" };

const valid: QualifierValues = {
  ...EMPTY_VALUES,
  assetType: "ASSISTED_LIVING",
  transaction: "REFINANCE",
  loanAmount: 3_000_000,
  noi: 400_000,
  unitCount: 60,
  occupancyPct: 88,
  timelineDays: "90",
  ownerOperator: "yes",
  firstName: "Pat",
  lastName: "Lee",
  email: "pat.lee@example.com",
};

const issuesFor = (v: QualifierValues) => {
  const r = qualifierSchema(v).safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("express form defaults", () => {
  it("pre-fills nothing realistic", () => {
    expect(EMPTY_VALUES.loanAmount).toBeNull();
    expect(EMPTY_VALUES.noi).toBeNull();
    expect(EMPTY_VALUES.unitCount).toBeNull();
    expect(EMPTY_VALUES.occupancyPct).toBeNull();
    expect(EMPTY_VALUES.adr).toBeNull();
    expect(EMPTY_VALUES.transaction).toBe("");
    expect(EMPTY_VALUES.timelineDays).toBe("");
    expect(EMPTY_VALUES.ownerOperator).toBe("");
    expect(EMPTY_VALUES.assetType).toBe("");
  });

  it("every field belongs to exactly one step", () => {
    const all = STEP_FIELDS.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(EMPTY_VALUES).sort()).toEqual([...all].sort());
  });

  it("only carries over values the visitor entered on the sizer link", () => {
    const params = new URLSearchParams({ asset: "MULTIFAMILY", loan: "5000000", noi: "abc" });
    expect(prefillFromParams((k) => params.get(k))).toEqual({ assetType: "MULTIFAMILY", loanAmount: 5_000_000, noi: null });
    expect(prefillFromParams(() => null)).toEqual({ loanAmount: null, noi: null });
    const bad = new URLSearchParams({ asset: "NOT_AN_ASSET" });
    expect(prefillFromParams((k) => bad.get(k)).assetType).toBeUndefined();
  });

  it("carries the sizer's hard money and construction transaction only when the asset offers it", () => {
    const hm = new URLSearchParams({ asset: "RESIDENTIAL_2_4", transaction: "HARD_MONEY", loan: "400000" });
    expect(prefillFromParams((k) => hm.get(k))).toMatchObject({ assetType: "RESIDENTIAL_2_4", transaction: "HARD_MONEY" });
    const build = new URLSearchParams({ asset: "MULTIFAMILY", transaction: "CONSTRUCTION" });
    expect(prefillFromParams((k) => build.get(k)).transaction).toBe("CONSTRUCTION");
    const senior = new URLSearchParams({ asset: "SNF", transaction: "HARD_MONEY" });
    expect(prefillFromParams((k) => senior.get(k)).transaction).toBeUndefined();
    expect(transactionOptions("SNF").map((o) => o.value)).not.toContain("HARD_MONEY");
    expect(transactionOptions("MULTIFAMILY").map((o) => o.value)).toContain("HARD_MONEY");
  });
});

describe("family deep links", () => {
  const params = (q: string) => {
    const p = new URLSearchParams(q);
    return (k: string) => p.get(k);
  };

  it("reads ?family= only for a known program family", () => {
    expect(familyFromParams(params("family=construction"))).toBe("construction");
    expect(familyFromParams(params("family=hard-money"))).toBe("hard-money");
    expect(familyFromParams(params("family=senior-living&asset=SNF"))).toBe("senior-living");
    expect(familyFromParams(params("family=crypto"))).toBeUndefined();
    expect(familyFromParams(params("family="))).toBeUndefined();
    expect(familyFromParams(params(""))).toBeUndefined();
  });

  it("shows the family's asset group first and keeps every group", () => {
    expect(assetGroupsFor("senior-living")[0]).toBe("Senior living and care");
    expect(assetGroupsFor("hotels")[0]).toBe("Hospitality");
    expect(assetGroupsFor("multifamily")[0]).toBe("Multifamily and CRE");
    for (const f of [undefined, "construction", "hard-money", "hotels"] as const) expect([...assetGroupsFor(f)].sort()).toEqual([...ASSET_GROUPS].sort());
    expect(assetGroupsFor()).toEqual(ASSET_GROUPS);
    expect(assetGroupsFor("construction")).toEqual(ASSET_GROUPS);
  });

  it("lists only hard-money-eligible assets on a hard money link", () => {
    const listed = ASSET_GROUPS.flatMap((g) => assetsFor(g, "hard-money")).map((a) => a.value);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((a) => offersHardMoney(a))).toBe(true);
    expect(listed).not.toContain("SNF");
    expect(listed).not.toContain("HOTEL_TO_SENIOR_CONVERSION");
    expect(assetsFor("Senior living and care", "hard-money")).toEqual([]);
    // Every other link lists every asset.
    expect(ASSET_GROUPS.flatMap((g) => assetsFor(g, "construction"))).toHaveLength(ASSETS.length);
    expect(ASSET_GROUPS.flatMap((g) => assetsFor(g))).toHaveLength(ASSETS.length);
  });

  it("asks a family-specific first question", () => {
    expect(assetStepHeading("construction")).toBe("What are you building or renovating?");
    expect(assetStepHeading("hard-money")).toBe("What property is the loan for?");
    expect(assetStepHeading("hotels")).toBe("What are you financing?");
    expect(assetStepHeading()).toBe("What are you financing?");
  });

  it("preselects construction or hard money only when the chosen asset offers it", () => {
    expect(familyTransaction("MULTIFAMILY", "construction")).toBe("CONSTRUCTION");
    expect(familyTransaction("ASSISTED_LIVING", "construction")).toBe("CONSTRUCTION");
    // A conversion asset offers "Conversion", not "Construction".
    expect(familyTransaction("HOTEL_TO_SENIOR_CONVERSION", "construction")).toBeUndefined();
    expect(familyTransaction("RESIDENTIAL_2_4", "hard-money")).toBe("HARD_MONEY");
    expect(familyTransaction("SNF", "hard-money")).toBeUndefined();
    expect(familyTransaction("MULTIFAMILY", "multifamily")).toBeUndefined();
    expect(familyTransaction("MULTIFAMILY")).toBeUndefined();
  });

  it("keeps the visitor's own transaction over the family's when the asset offers it", () => {
    expect(transactionAfterAssetChoice("MULTIFAMILY", "", "construction")).toBe("CONSTRUCTION");
    expect(transactionAfterAssetChoice("MULTIFAMILY", "PURCHASE", "construction")).toBe("PURCHASE");
    expect(transactionAfterAssetChoice("MULTIFAMILY", "", "hard-money")).toBe("HARD_MONEY");
    // A pick the new asset does not offer falls back to the family's, then to none.
    expect(transactionAfterAssetChoice("SNF", "HARD_MONEY", "construction")).toBe("CONSTRUCTION");
    expect(transactionAfterAssetChoice("SNF", "HARD_MONEY")).toBe("");
    expect(transactionAfterAssetChoice("HOTEL_TO_SENIOR_CONVERSION", "CONSTRUCTION")).toBe("");
  });

  it("drops the transaction a cancelled family pick preselected, and keeps any other", () => {
    // Construction pick, then Multifamily (Construction preselected), then the pick is undone.
    expect(transactionAfterFamilyChange("MULTIFAMILY", "CONSTRUCTION", "construction", undefined)).toBe("");
    expect(transactionAfterFamilyChange("MULTIFAMILY", "HARD_MONEY", "hard-money", undefined)).toBe("");
    // Switching picks drops the old family's transaction too.
    expect(transactionAfterFamilyChange("MULTIFAMILY", "CONSTRUCTION", "construction", "hard-money")).toBe("");
    // A transaction the pick did not set stays.
    expect(transactionAfterFamilyChange("MULTIFAMILY", "PURCHASE", "construction", undefined)).toBe("PURCHASE");
    expect(transactionAfterFamilyChange("", "", "construction", undefined)).toBe("");
    expect(transactionAfterFamilyChange("MULTIFAMILY", "CONSTRUCTION", undefined, "construction")).toBe("CONSTRUCTION");
    // After the undo, picking the property again leaves the transaction open.
    expect(transactionAfterAssetChoice("MULTIFAMILY", transactionAfterFamilyChange("MULTIFAMILY", "CONSTRUCTION", "construction", undefined))).toBe("");
  });

  it("offers construction and hard money picks that behave like their family links", () => {
    expect(PROJECT_PICKS.map((p) => p.family)).toEqual(["construction", "hard-money"]);
    for (const p of PROJECT_PICKS) {
      expect(p.label).not.toMatch(/guarantee|approv/i);
      expect(assetStepHeading(p.family)).not.toBe(assetStepHeading());
    }
  });

  it("lets the sizer's explicit asset and transaction win over the family", () => {
    const get = params("family=hard-money&asset=MULTIFAMILY&transaction=CONSTRUCTION&loan=5000000");
    expect(prefillFromParams(get)).toMatchObject({ assetType: "MULTIFAMILY", transaction: "CONSTRUCTION", loanAmount: 5_000_000 });
    expect(familyFromParams(get)).toBe("hard-money");
    // The family never adds fields to the prefill itself.
    expect(prefillFromParams(params("family=construction"))).toEqual({ loanAmount: null, noi: null });
  });
});

describe("express validation", () => {
  it("accepts a complete submission", () => {
    expect(issuesFor(valid)).toEqual({});
  });

  it("reports each missing answer with a message that says what to do", () => {
    const issues = issuesFor({ ...EMPTY_VALUES, assetType: "ASSISTED_LIVING" });
    expect(issues.transaction).toMatch(/choose/i);
    expect(issues.loanAmount).toMatch(/enter the loan amount/i);
    expect(issues.noi).toMatch(/net operating income/i);
    expect(issues.unitCount).toMatch(/licensed beds/i);
    expect(issues.occupancyPct).toMatch(/occupancy/i);
    expect(issues.timelineDays).toMatch(/when you need to close/i);
    expect(issues.ownerOperator).toMatch(/owner-operator/i);
    expect(issues.firstName).toMatch(/first name/i);
    expect(issues.email).toMatch(/email/i);
  });

  it("enforces the server's loan floor and percent range before sending", () => {
    expect(issuesFor({ ...valid, loanAmount: 100_000 }).loanAmount).toBe("Minimum $250,000.");
    expect(issuesFor({ ...valid, occupancyPct: 140 }).occupancyPct).toMatch(/0 to 100/);
    expect(issuesFor({ ...valid, email: "not-an-email" }).email).toMatch(/valid email/i);
  });

  it("accepts a zero NOI (a property with no income yet)", () => {
    expect(issuesFor({ ...valid, noi: 0 }).noi).toBeUndefined();
  });

  it("requires hotel fields only for hotels", () => {
    expect(issuesFor({ ...valid, assetType: "HOTEL_FLAGGED", adr: null, franchiseTier: "" })).toMatchObject({ adr: expect.stringMatching(/daily rate/i), franchiseTier: expect.stringMatching(/franchise/i) });
    expect(issuesFor({ ...valid, assetType: "HOTEL_FLAGGED", adr: 145, franchiseTier: "PREMIUM_FLAG" })).toEqual({});
    expect(issuesFor({ ...valid, assetType: "MULTIFAMILY" }).adr).toBeUndefined();
  });

  it("treats the unit count as optional for commercial assets only", () => {
    expect(issuesFor({ ...valid, assetType: "COMMERCIAL", unitCount: null }).unitCount).toBeUndefined();
    expect(issuesFor({ ...valid, assetType: "MULTIFAMILY", unitCount: null }).unitCount).toMatch(/units/i);
  });

  it("requires a phone number once contact permission is ticked, and validates any phone given", () => {
    expect(issuesFor({ ...valid, consent: true, phone: "" }).phone).toMatch(/mobile number/i);
    expect(issuesFor({ ...valid, consent: true, phone: "415-555-0132" }).phone).toBeUndefined();
    expect(issuesFor({ ...valid, consent: false, phone: "" }).phone).toBeUndefined();
    expect(issuesFor({ ...valid, phone: "12345" }).phone).toMatch(/area code/i);
  });
});

describe("express payload", () => {
  it("builds a body the server's lead schema accepts", () => {
    const payload = buildQualifyPayload({ ...valid, value: 4_500_000, consent: true, phone: "415-555-0132" }, META);
    const parsed = leadSchema.safeParse({ intake: payload.intake, contact: payload.contact });
    expect(parsed.success).toBe(true);
    expect(payload.intake).toMatchObject({ assetType: "ASSISTED_LIVING", transaction: "REFINANCE", source: "express", timelineDays: 90, ownerOperator: true, value: 4_500_000 });
    expect(payload.contact).toMatchObject({ firstName: "Pat", consent: true, phone: "415-555-0132" });
    expect(payload.consentMeta).toEqual(META);
  });

  it("sends hotel fields only for hotels and omits blank optionals", () => {
    const hotel = buildQualifyPayload({ ...valid, assetType: "HOTEL_FLAGGED", adr: 145, franchiseTier: "PREMIUM_FLAG", pipBudget: 1_200_000 }, META);
    expect(hotel.intake).toMatchObject({ adr: 145, franchiseTier: "PREMIUM_FLAG", pipBudget: 1_200_000 });
    const senior = buildQualifyPayload({ ...valid, adr: 145, franchiseTier: "PREMIUM_FLAG", pipBudget: 5 }, META);
    expect(senior.intake.adr).toBeUndefined();
    expect(senior.intake.franchiseTier).toBeUndefined();
    expect(senior.intake.pipBudget).toBeUndefined();
    expect(senior.intake.value).toBeUndefined();
  });

  it("maps a no answer and the construction/conversion label to the right enum", () => {
    expect(buildQualifyPayload({ ...valid, ownerOperator: "no" }, META).intake.ownerOperator).toBe(false);
    expect(buildQualifyPayload({ ...valid, assetType: "HOTEL_TO_SENIOR_CONVERSION", transaction: "CONSTRUCTION" }, META).intake.transaction).toBe("CONVERSION");
    expect(buildQualifyPayload({ ...valid, assetType: "MULTIFAMILY", transaction: "CONVERSION" }, META).intake.transaction).toBe("CONSTRUCTION");
    expect(transactionOptions("HOTEL_TO_SENIOR_CONVERSION").map((o) => o.value)).toEqual(["PURCHASE", "REFINANCE", "CONVERSION"]);
  });

  it("refuses unvalidated values", () => {
    expect(() => buildQualifyPayload(EMPTY_VALUES, META)).toThrow();
  });

  it("sends hard money strategy, purpose, rehab and ARV as intake.hardMoney", () => {
    const hm = { ...valid, assetType: "RESIDENTIAL_2_4", transaction: "HARD_MONEY", unitCount: 3, value: 900_000 } as const;
    const payload = buildQualifyPayload({ ...hm, hmStrategy: "FIX_AND_FLIP", hmPurpose: "PURCHASE", rehabBudget: 150_000, arv: 1_400_000 }, META);
    expect(payload.intake.hardMoney).toMatchObject({ strategy: "FIX_AND_FLIP", purpose: "PURCHASE", rehabBudget: 150_000, arv: 1_400_000 });
    expect(leadSchema.safeParse({ intake: payload.intake, contact: payload.contact }).success).toBe(true);
    expect(buildQualifyPayload({ ...hm, hmStrategy: "RENTAL", hmPurpose: "REFINANCE" }, META).intake.hardMoney).toMatchObject({ strategy: "RENTAL", purpose: "REFINANCE", rehabBudget: 0, arv: undefined });
    // Nothing entered: the server sizes its defaults.
    expect(buildQualifyPayload(hm, META).intake.hardMoney).toBeUndefined();
    // Hard money fields left over from an earlier pick are not sent for another transaction.
    expect(buildQualifyPayload({ ...valid, arv: 1_400_000, hmStrategy: "BRIDGE" }, META).intake.hardMoney).toBeUndefined();
    expect(STEP_FIELDS[1]).toEqual(expect.arrayContaining(["hmStrategy", "hmPurpose", "rehabBudget", "arv"]));
  });

  it("labels the value field for the transaction", () => {
    expect(valueLabel("HARD_MONEY")).toBe("Purchase price or as-is value");
    expect(valueLabel("PURCHASE")).toBe("Purchase price");
    expect(valueLabel("REFINANCE")).toBe("Estimated value");
    expect(valueLabel("CONSTRUCTION")).toBe("Acquisition or land cost");
  });

  it("sends zero units for a commercial asset with none entered", () => {
    expect(buildQualifyPayload({ ...valid, assetType: "COMMERCIAL", unitCount: null }, META).intake.unitCount).toBe(0);
  });
});
