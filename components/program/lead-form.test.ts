import { describe, expect, it } from "vitest";
import { financingSlugs, getFinancingPage } from "@/content/programs";
import { CONSENT_TEXTS, CURRENT_CONSENT } from "@/lib/consent/texts";
import { PROPERTY_TYPES } from "@/lib/property-types";
import { intakeFromQuick, intakeSchema, parseQualifySubmission, quickLeadSchema } from "@/lib/validation";
import { EMPTY_LEAD, LEAD_FIELDS, LEAD_TRANSACTIONS, buildLeadPayload, leadFormSchema, leadPreset, propertyTypeOptions, type LeadFormValues } from "./lead-form";

const META = { textVersion: CURRENT_CONSENT.qualifier, page: "/financing/office-loans" };

const valid: LeadFormValues = {
  ...EMPTY_LEAD,
  firstName: "Pat",
  lastName: "Lee",
  email: "pat@example.com",
  assetType: "OFFICE",
  transaction: "PURCHASE",
  loanAmount: 4_000_000,
  timelineDays: "90",
};

const issuesFor = (v: LeadFormValues) => {
  const r = leadFormSchema(v).safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("financing-page request form", () => {
  it("asks for contact details, the property, the transaction, an amount, timing, notes and consent", () => {
    expect([...LEAD_FIELDS].sort()).toEqual(["assetType", "company", "consent", "email", "firstName", "lastName", "loanAmount", "notes", "phone", "timelineDays", "transaction"]);
    expect(LEAD_TRANSACTIONS.map((t) => t.value)).toEqual(["PURCHASE", "REFINANCE", "CONSTRUCTION", "OTHER"]);
    expect(issuesFor(valid)).toEqual({});
  });

  it("requires name, email, property, transaction, amount and timing; phone and company stay optional", () => {
    expect(Object.keys(issuesFor({ ...EMPTY_LEAD })).sort()).toEqual(["assetType", "email", "firstName", "lastName", "loanAmount", "timelineDays", "transaction"]);
    expect(issuesFor({ ...valid, phone: "", company: "" })).toEqual({});
    expect(issuesFor({ ...valid, loanAmount: 100_000 })).toEqual({ loanAmount: "Minimum $250,000." });
    expect(issuesFor({ ...valid, email: "nope" })).toHaveProperty("email");
  });

  it("asks for a phone number only once the contact permission box is ticked", () => {
    expect(issuesFor({ ...valid, consent: true })).toHaveProperty("phone");
    expect(issuesFor({ ...valid, consent: true, phone: "415-555-0100" })).toEqual({});
    expect(issuesFor({ ...valid, phone: "123" })).toHaveProperty("phone");
  });

  it("offers every property type, the page's own group first", () => {
    const all = propertyTypeOptions().map((o) => o.value);
    expect([...all].sort()).toEqual([...PROPERTY_TYPES].sort());
    expect(propertyTypeOptions("commercial")[0]).toMatchObject({ value: "OFFICE", group: "Commercial property" });
    expect(propertyTypeOptions("hotels")[0]?.group).toBe("Hospitality");
    expect(propertyTypeOptions().find((o) => o.value === "COMMERCIAL")?.label).toBe("Other commercial property");
  });

  it("presets the property type from the page, and leaves it to the visitor on capital-type pages", () => {
    expect(leadPreset("office-loans", "commercial")).toEqual({ assetType: "OFFICE", transaction: "" });
    expect(leadPreset("mobile-home-park-loans", "commercial").assetType).toBe("MANUFACTURED_HOUSING");
    expect(leadPreset("mixed-use-loans", "commercial").assetType).toBe("MIXED_USE");
    expect(leadPreset("cmbs-loans", "commercial").assetType).toBe("");
    expect(leadPreset("acquisition-loans", "commercial")).toEqual({ assetType: "", transaction: "PURCHASE" });
    expect(leadPreset("rcfe", "senior-living").assetType).toBe("RCFE");
    expect(leadPreset("hotel-cmbs", "hotels").assetType).toBe("HOTEL_FLAGGED");
    expect(leadPreset("construction-loans", "construction")).toEqual({ assetType: "", transaction: "CONSTRUCTION" });
    // Every page's preset is a valid choice or blank.
    for (const slug of financingSlugs) {
      const preset = leadPreset(slug, getFinancingPage(slug)!.entry.family);
      expect(preset.assetType === "" || (PROPERTY_TYPES as readonly string[]).includes(preset.assetType), slug).toBe(true);
    }
  });

  it("builds a quick /api/qualify body the server accepts, with the qualifier's consent version", () => {
    const payload = buildLeadPayload({ ...valid, firstName: " Pat ", notes: "  Near the 405. ", consent: true, phone: "415-555-0100" }, "office-loans", META);
    expect(payload).toEqual({
      kind: "quick",
      quick: { assetType: "OFFICE", transaction: "PURCHASE", loanAmount: 4_000_000, timelineDays: 90, notes: "Near the 405.", slug: "office-loans" },
      contact: { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "415-555-0100", company: "", consent: true },
      consentMeta: META,
    });
    expect(CONSENT_TEXTS[META.textVersion].form).toBe("qualifier");
    expect(quickLeadSchema.safeParse(payload).success).toBe(true);
    const parsed = parseQualifySubmission(payload);
    expect(parsed.success && parsed.data.kind).toBe("quick");
    expect(() => buildLeadPayload(EMPTY_LEAD, "office-loans", META)).toThrow();
  });

  it("turns into an intake the qualifier pipeline and the crm-retry cron accept", () => {
    const parsed = quickLeadSchema.parse(buildLeadPayload({ ...valid, transaction: "CONSTRUCTION", assetType: "HOTEL_TO_SENIOR_CONVERSION" }, "hotel-to-senior-living-conversion", META));
    const intake = intakeFromQuick(parsed.quick, { slug: "hotel-to-senior-living-conversion", path: "/financing/hotel-to-senior-living-conversion", name: "Hotel to senior living conversion" });
    expect(intake).toMatchObject({ transaction: "CONVERSION", noi: 0, source: "financing_page", origin: { transaction: "CONSTRUCTION" } });
    expect(intakeSchema.parse(intake)).toEqual(intake);
  });
});
