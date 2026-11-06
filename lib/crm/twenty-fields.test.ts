import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LENDER_KINDS, LICENSE_TYPES, OPERATOR_KINDS, SERVICES, VERTICALS } from "@/components/partners/schema";
import { ASSET_VERTICALS, OPTIMIZATION_FLAGS, PROGRAM_FITS, URGENCY_TIERS, decideWithRules } from "@/lib/ai/jev";
import { PROPERTY_TYPES } from "@/lib/property-types";
import { creditBands, intakeFromQuick, intakeSchema, type Intake, type PartnerRegistration } from "@/lib/validation";
import { TWENTY_FIELDS, companyFields, fieldSpec, fieldsManifest, opportunityFields, type TwentyObjectName } from "./twenty-fields";

const jevFor = (intake: Intake) => ({ ...decideWithRules(intake), engine: "rules" as const, latencyMs: 1 });

const optionValues = (object: TwentyObjectName, name: string) => fieldSpec(object, name)!.options!.map((o) => o.value);

// Fields that already exist in Corin's Twenty workspace (standard and custom), as listed from
// crm.corincommercial.com on 2026-11-06. A new field must not reuse one of these names.
const EXISTING: Record<TwentyObjectName, string[]> = {
  opportunity: ["dealType", "expectedRevenue", "nextStep", "probability", "amount", "attachments", "calendarEventTargets", "closeDate", "company", "messageThreadTargets", "name", "noteTargets", "owner", "pointOfContact", "stage", "taskTargets", "timelineActivities", "createdAt", "createdBy", "deletedAt", "id", "position", "searchVector", "updatedAt", "updatedBy"],
  company: ["accountOwner", "address", "annualRevenue", "attachments", "calendarEventTargets", "domainName", "linkedinLink", "messageThreadTargets", "name", "noteTargets", "opportunities", "people", "taskTargets", "timelineActivities", "createdAt", "createdBy", "deletedAt", "id", "position", "searchVector", "updatedAt", "updatedBy"],
};

describe("TWENTY_FIELDS", () => {
  it("matches ops/twenty/fields.json (run `npm run twenty:fields` after changing it)", () => {
    const file = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../ops/twenty/fields.json"), "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(fieldsManifest())));
  });

  it("uses unique camelCase names that do not collide with the workspace's fields", () => {
    for (const object of ["opportunity", "company"] as const) {
      const names = TWENTY_FIELDS.filter((f) => f.object === object).map((f) => f.name);
      expect(new Set(names).size, object).toBe(names.length);
      for (const n of names) {
        expect(n, `${object}.${n}`).toMatch(/^[a-z][a-zA-Z0-9]*$/);
        expect(EXISTING[object], `${object}.${n} already exists in Twenty`).not.toContain(n);
      }
    }
  });

  it("gives every select a label and unique values Twenty accepts as enum names", () => {
    for (const f of TWENTY_FIELDS.filter((f) => f.type === "SELECT" || f.type === "MULTI_SELECT")) {
      const values = f.options!.map((o) => o.value);
      expect(new Set(values).size, f.name).toBe(values.length);
      for (const o of f.options!) {
        // GraphQL enum names: a letter or underscore first. "740_PLUS" would be refused.
        expect(o.value, `${f.name}: ${o.value}`).toMatch(/^[A-Z_][A-Z0-9_]*$/);
        expect(o.label.trim(), `${f.name}: ${o.value}`).not.toBe("");
      }
    }
  });

  it("keeps commas out of every label, which Twenty 2.40 refuses", () => {
    for (const f of TWENTY_FIELDS) {
      expect(f.label, f.name).not.toContain(",");
      for (const o of f.options ?? []) expect(o.label, `${f.name}: ${o.value}`).not.toContain(",");
    }
    // The three labels the CRM was created with after that rule.
    expect(fieldSpec("opportunity", "franchiseTier")!.options!.find((o) => o.value === "PREMIUM_FLAG")!.label).toBe("Marriott / Hilton / IHG or Hyatt");
    expect(fieldSpec("opportunity", "monthlyTaxesInsuranceHoa")!.label).toBe("Monthly taxes / insurance / HOA");
    expect(fieldSpec("company", "maxLtcPct")!.label).toBe("Max LTC / construction %");
  });

  it("offers every value the forms and the qualifier can send", () => {
    const covers = (object: TwentyObjectName, name: string, values: readonly string[]) => expect(optionValues(object, name), name).toEqual(expect.arrayContaining([...values]));
    covers("opportunity", "propertyType", PROPERTY_TYPES);
    covers("opportunity", "transactionType", [...intakeSchema.shape.transaction.options, "OTHER"]);
    covers("opportunity", "leadSource", intakeSchema.shape.source.unwrap().options.map((s) => s.toUpperCase()));
    covers("opportunity", "primaryProgram", PROGRAM_FITS);
    covers("opportunity", "secondaryProgram", [...PROGRAM_FITS, "NONE"]);
    covers("opportunity", "leadTier", URGENCY_TIERS);
    covers("opportunity", "assetVertical", ASSET_VERTICALS);
    covers("opportunity", "sizingFlag", OPTIMIZATION_FLAGS);
    covers("opportunity", "creditBand", creditBands.map((b) => `CREDIT_${b}`));
    covers("company", "lenderType", LENDER_KINDS.map((o) => o.value));
    covers("company", "licenseType", LICENSE_TYPES.map((o) => o.value));
    covers("company", "operatorType", OPERATOR_KINDS.map((o) => o.value));
    covers("company", "vendorServices", SERVICES.map((o) => o.value));
    covers("company", "lendingVerticals", VERTICALS.map((o) => o.value));
  });
});

const page = { slug: "office-loans", path: "/financing/office-loans", name: "Office building loans" };

describe("opportunityFields", () => {
  it("fills what the financing-page form asked, and nothing it did not", () => {
    const intake = intakeFromQuick({ assetType: "OFFICE", transaction: "OTHER", loanAmount: 4_000_000, timelineDays: 90, notes: "Tenant rollover in 2027", slug: page.slug }, page);
    const values = opportunityFields(intake, jevFor(intake), { leadId: "lead-1" });
    expect(values).toMatchObject({
      siteLeadId: "lead-1",
      leadSource: "FINANCING_PAGE",
      sourcePage: "/financing/office-loans",
      propertyType: "OFFICE",
      transactionType: "OTHER",
      closeTimelineDays: 90,
      borrowerNotes: "Tenant rollover in 2027",
      sizingFlag: "NEEDS_BROKER_REVIEW",
    });
    // The short form has no NOI, occupancy, unit count or borrower profile: placeholders stay out of the CRM.
    for (const name of ["noi", "occupancyPct", "unitCount", "ownerOperator", "nonRecourseOnly", "greenBuilding"]) expect(values, name).not.toHaveProperty(name);
  });

  it("fills the 60-second qualifier's numbers and match", () => {
    const intake = intakeSchema.parse({
      assetType: "ASSISTED_LIVING",
      transaction: "REFINANCE",
      loanAmount: 3_000_000,
      noi: 400_000,
      unitCount: 60,
      occupancyPct: 88,
      timelineDays: 90,
      creditBand: "740_PLUS",
      source: "express",
    });
    const jev = jevFor(intake);
    const values = opportunityFields(intake, jev, { leadId: "lead-2" });
    expect(values).toMatchObject({
      leadSource: "EXPRESS",
      sourcePage: "/express",
      propertyType: "ASSISTED_LIVING",
      transactionType: "REFINANCE",
      noi: { amountMicros: 400_000_000_000, currencyCode: "USD" },
      unitCount: 60,
      occupancyPct: 88,
      ownerOperator: true,
      creditBand: "CREDIT_740_PLUS",
      primaryProgram: jev.decision.primaryProgramFit,
      leadTier: jev.decision.leadUrgencyTier,
      assetVertical: "SENIOR_LIVING_CARE",
      callRightAway: jev.decision.requiresImmediateBrokerCall,
    });
    expect(values.secondaryProgram === undefined || optionValues("opportunity", "secondaryProgram").includes(values.secondaryProgram as string)).toBe(true);
  });

  it("marks an advisor-only lead and writes no automated match", () => {
    const intake = intakeSchema.parse({ assetType: "MULTIFAMILY", transaction: "PURCHASE", loanAmount: 5_000_000, noi: 300_000, source: "express" });
    const values = opportunityFields(intake, null, { advisorOnly: true });
    expect(values).toMatchObject({ advisorOnly: true, propertyType: "MULTIFAMILY" });
    for (const name of ["primaryProgram", "leadTier", "sizingFlag", "callRightAway"]) expect(values, name).not.toHaveProperty(name);
  });

  it("writes only fields listed in TWENTY_FIELDS", () => {
    const intake = intakeSchema.parse({
      assetType: "RESIDENTIAL_2_4",
      transaction: "HARD_MONEY",
      loanAmount: 400_000,
      noi: 0,
      source: "express",
      hardMoney: { strategy: "FIX_AND_FLIP", rehabBudget: 80_000, arv: 650_000, completedProjects: 3 },
    });
    const values = opportunityFields(intake, jevFor(intake));
    for (const name of Object.keys(values)) expect(fieldSpec("opportunity", name), name).toBeDefined();
    expect(values).toMatchObject({ hardMoneyStrategy: "FIX_AND_FLIP", rehabBudget: { amountMicros: 80_000_000_000, currencyCode: "USD" }, completedProjects: 3 });
  });
});

const contact = { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "", company: "", consent: false };

describe("companyFields", () => {
  it("fills a lender's credit box", () => {
    const reg = {
      partnerType: "LENDER",
      contact,
      organization: "Pacific Bank",
      website: "",
      lenderKind: "BANK",
      minLoan: 1_000_000,
      maxLoan: 25_000_000,
      verticals: ["MULTIFAMILY", "COMMERCIAL"],
      states: "CA, NV",
      maxLtv: 75,
      minDscr: 1.25,
      flagRequirements: "",
      brokerFeeProtectionPct: 1,
    } as PartnerRegistration;
    expect(companyFields(reg, "partner-1")).toEqual({
      sitePartnerId: "partner-1",
      partnerType: "LENDER",
      lenderType: "BANK",
      minLoan: { amountMicros: 1_000_000_000_000, currencyCode: "USD" },
      maxLoan: { amountMicros: 25_000_000_000_000, currencyCode: "USD" },
      lendingVerticals: ["MULTIFAMILY", "COMMERCIAL"],
      maxLtvPct: 75,
      minDscr: 1.25,
      brokerFeeProtectionPct: 1,
      marketsServed: "CA, NV",
    });
  });

  it.each([
    [{ partnerType: "REFERRAL", contact, organization: "", licenseType: "CA_DRE_BROKER", licenseNumber: "01234567", marketsServed: "LA", acceptsAgreement: true }, { partnerType: "REFERRAL", licenseType: "CA_DRE_BROKER", licenseNumbers: "01234567", marketsServed: "LA" }],
    [{ partnerType: "OPERATOR", contact, organization: "Sunrise Ops", operatorKind: "MEMORY_CARE", licenseNumbers: "", unitsUnderManagement: 240, flagsApproved: "", markets: "" }, { partnerType: "OPERATOR", operatorType: "MEMORY_CARE", unitsUnderManagement: 240 }],
    [{ partnerType: "VENDOR", contact, organization: "Rivera Appraisal", services: ["PHASE_I_ESA", "PCNA"], markets: "CA", typicalTurnaroundDays: 14 }, { partnerType: "VENDOR", vendorServices: ["PHASE_I_ESA", "PCNA"], marketsServed: "CA", typicalTurnaroundDays: 14 }],
  ])("fills a %s registration", (reg, expected) => {
    expect(companyFields(reg as PartnerRegistration)).toEqual(expected);
  });
});
