import { describe, expect, it } from "vitest";
import { partnerSchema } from "@/lib/validation";
import { EMPTY_PARTNER_VALUES, TYPES, TYPE_FIELDS, buildPartnerPayload, normalizeWebsite, partnerFormSchema, type PartnerFormValues, type PartnerType } from "./schema";

const META = { textVersion: "partner-contact-2026-11-01", page: "/partners" };

const base: PartnerFormValues = { ...EMPTY_PARTNER_VALUES, firstName: "Sam", lastName: "Rivera", email: "sam@example.com", organization: "Rivera Group" };

const lender: PartnerFormValues = { ...base, lenderKind: "BANK", minLoan: 1_000_000, maxLoan: 25_000_000, maxLtv: 75, brokerFeeProtectionPct: 1 };
const referral: PartnerFormValues = { ...base, licenseType: "CA_DRE_BROKER", licenseNumber: "01234567", acceptsAgreement: true };
const operator: PartnerFormValues = { ...base, operatorKind: "RCFE_ASSISTED_LIVING", unitsUnderManagement: 240 };
const vendor: PartnerFormValues = { ...base, services: ["PHASE_I_ESA"] };

const VALID: Record<PartnerType, PartnerFormValues> = { LENDER: lender, REFERRAL: referral, OPERATOR: operator, VENDOR: vendor };

const issues = (type: PartnerType, v: PartnerFormValues) => {
  const r = partnerFormSchema(type, v).safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("partner form defaults", () => {
  it("pre-fills no lender terms or choices", () => {
    expect(EMPTY_PARTNER_VALUES.minLoan).toBeNull();
    expect(EMPTY_PARTNER_VALUES.maxLoan).toBeNull();
    expect(EMPTY_PARTNER_VALUES.maxLtv).toBeNull();
    expect(EMPTY_PARTNER_VALUES.minDscr).toBeNull();
    expect(EMPTY_PARTNER_VALUES.brokerFeeProtectionPct).toBeNull();
    expect(EMPTY_PARTNER_VALUES.lenderKind).toBe("");
    expect(EMPTY_PARTNER_VALUES.licenseType).toBe("");
    expect(EMPTY_PARTNER_VALUES.operatorKind).toBe("");
    expect(EMPTY_PARTNER_VALUES.services).toEqual([]);
  });

  it("keeps the tab ids the deep links rely on", () => {
    expect(TYPES.map((t) => t.hash)).toEqual(["lender", "referral", "operator", "vendor"]);
  });
});

describe("partner validation", () => {
  it.each(Object.keys(VALID) as PartnerType[])("accepts a complete %s registration", (type) => {
    expect(issues(type, VALID[type])).toEqual({});
  });

  it("requires at least one service for vendors", () => {
    expect(issues("VENDOR", { ...vendor, services: [] }).services).toBe("Select at least one service you provide.");
  });

  it("requires the organization for every type but referral", () => {
    expect(issues("LENDER", { ...lender, organization: "" }).organization).toMatch(/organization/i);
    expect(issues("OPERATOR", { ...operator, organization: "" }).organization).toBeDefined();
    expect(issues("VENDOR", { ...vendor, organization: "" }).organization).toMatch(/company/i);
    expect(issues("REFERRAL", { ...referral, organization: "" }).organization).toBeUndefined();
  });

  it("flags every missing lender field instead of defaulting it", () => {
    const e = issues("LENDER", base);
    expect(Object.keys(e)).toEqual(expect.arrayContaining(["lenderKind", "minLoan", "maxLoan", "maxLtv", "brokerFeeProtectionPct"]));
  });

  it("checks max loan against min loan and percentages against their ranges", () => {
    expect(issues("LENDER", { ...lender, minLoan: 5_000_000, maxLoan: 1_000_000 }).maxLoan).toMatch(/at least the minimum/i);
    expect(issues("LENDER", { ...lender, maxLtv: 120 }).maxLtv).toMatch(/0 to 100/);
    expect(issues("LENDER", { ...lender, brokerFeeProtectionPct: 12 }).brokerFeeProtectionPct).toMatch(/0 to 10/);
    expect(issues("LENDER", { ...lender, minDscr: 9 }).minDscr).toBeDefined();
  });

  it("requires a license number except for unlicensed finders, and requires the agreement", () => {
    expect(issues("REFERRAL", { ...referral, licenseNumber: "" }).licenseNumber).toMatch(/license number/i);
    expect(issues("REFERRAL", { ...referral, licenseType: "UNLICENSED_REFERRAL", licenseNumber: "" }).licenseNumber).toBeUndefined();
    expect(issues("REFERRAL", { ...referral, acceptsAgreement: false }).acceptsAgreement).toMatch(/agree/i);
  });

  it("accepts a website without a scheme and rejects nonsense", () => {
    expect(issues("LENDER", { ...lender, website: "example.com" }).website).toBeUndefined();
    expect(issues("LENDER", { ...lender, website: "not a url" }).website).toMatch(/web address/i);
    expect(normalizeWebsite("example.com")).toBe("https://example.com");
    expect(normalizeWebsite(" http://x.org ")).toBe("http://x.org");
    expect(normalizeWebsite("")).toBe("");
  });

  it("requires a phone when contact permission is ticked", () => {
    expect(issues("VENDOR", { ...vendor, consent: true, phone: "" }).phone).toMatch(/phone number/i);
    expect(issues("VENDOR", { ...vendor, consent: true, phone: "415-555-0132" }).phone).toBeUndefined();
  });

  it("every type's fields exist on the form values", () => {
    for (const fields of Object.values(TYPE_FIELDS)) for (const f of fields) expect(f in EMPTY_PARTNER_VALUES).toBe(true);
  });
});

describe("partner payloads", () => {
  it.each(Object.keys(VALID) as PartnerType[])("builds a %s body the server's schema accepts", (type) => {
    const withExtras = { ...VALID[type], website: "example.com", minDscr: 1.25, typicalTurnaroundDays: 10, markets: "CA", consent: true, phone: "415-555-0132" };
    const { consentMeta, ...body } = buildPartnerPayload(type, withExtras, META);
    expect(consentMeta).toEqual(META);
    const parsed = partnerSchema.safeParse(body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("maps the shared markets field per type and normalises the website", () => {
    const v = { ...VALID.LENDER, markets: "CA, AZ", website: "example.com" };
    expect(buildPartnerPayload("LENDER", v, META)).toMatchObject({ website: "https://example.com" });
    expect(buildPartnerPayload("REFERRAL", { ...referral, markets: "Orange County" }, META)).toMatchObject({ marketsServed: "Orange County" });
    expect(buildPartnerPayload("OPERATOR", { ...operator, markets: "LA" }, META)).toMatchObject({ markets: "LA" });
  });

  it("omits optional numbers that were left blank", () => {
    const body = buildPartnerPayload("LENDER", lender, META);
    expect(body.minDscr).toBeUndefined();
    expect(body.minDebtYield).toBeUndefined();
    expect(buildPartnerPayload("VENDOR", vendor, META).typicalTurnaroundDays).toBeUndefined();
  });
});
