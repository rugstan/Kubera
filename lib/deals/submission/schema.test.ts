import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSET_TYPE_DB_RE,
  fieldSourcesPatchSchema,
  fieldSourcesSchema,
  isFieldSourceKey,
  MAX_CENTS,
  POSTAL_CODE_DB_RE,
  PROFILE_FIELD_SCHEMAS,
  PROFILE_NUMBER_LIMITS,
  PROGRAM_DETAIL_FIELDS,
  PROGRAM_DETAIL_SCHEMAS,
  profileFieldKeys,
  programDetailsSchema,
  restrictedTextReason,
  SECTION_FIELDS,
  SECTION_SCHEMAS,
  SPONSOR_NUMBER_LIMITS,
  sponsorProfileFieldsSchema,
  sponsorSchema,
  submissionProfileFieldsSchema,
  submissionProfilePatchSchema,
  type NumberLimit,
} from "./schema";
import { allSubmissionFixtures, submissionFixture } from "./test-fixtures";
import { blankSponsorProfileFields, blankSubmissionProfileFields, programDetailKeys, type SponsorProfile, type SubmissionProfile, type SubmissionProfileFields } from "./types";

const SQL = readFileSync(path.resolve(import.meta.dirname, "../../../supabase/migrations/20261105160000_int_deal_submission.sql"), "utf8");
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function profileFields(p: SubmissionProfile): SubmissionProfileFields {
  const { id: _i, dealId: _d, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, recordVersion: _v, ...fields } = p;
  return fields;
}
function sponsorFields(s: SponsorProfile) {
  const { id: _i, dealId: _d, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, recordVersion: _v, ...fields } = s;
  return fields;
}
const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => (r.success ? [] : r.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`));

describe("full examples", () => {
  it.each(allSubmissionFixtures())("the %s fixture's profile and sponsor parse unchanged", (_pb, ctx) => {
    const fields = profileFields(ctx.profile!);
    const parsed = submissionProfileFieldsSchema.safeParse(fields);
    expect(issues(parsed)).toEqual([]);
    expect(parsed.data).toEqual(fields);
    const sponsor = sponsorProfileFieldsSchema.safeParse(sponsorFields(ctx.sponsor!));
    expect(issues(sponsor)).toEqual([]);
    expect(sponsor.data).toEqual(sponsorFields(ctx.sponsor!));
  });

  it("blank rows parse (the column defaults)", () => {
    expect(issues(submissionProfileFieldsSchema.safeParse(blankSubmissionProfileFields("bridge")))).toEqual([]);
    expect(issues(sponsorProfileFieldsSchema.safeParse(blankSponsorProfileFields()))).toEqual([]);
  });

  it("each core section accepts its slice of a complete profile", () => {
    const fields = profileFields(submissionFixture("bridge").profile!) as Record<string, unknown>;
    for (const [id, keys] of Object.entries(SECTION_FIELDS)) {
      const slice = Object.fromEntries(keys.map((k) => [k, fields[k]]));
      const r = SECTION_SCHEMAS[id as keyof typeof SECTION_SCHEMAS].safeParse(slice);
      expect(issues(r), id).toEqual([]);
      expect(r.data, id).toEqual(slice);
    }
  });

  it("the core sections cover every profile column exactly once", () => {
    const all = Object.values(SECTION_FIELDS).flat();
    expect([...all].sort()).toEqual([...profileFieldKeys].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("every program section of every fixture parses unchanged", () => {
    for (const [pb, ctx] of allSubmissionFixtures()) {
      const pd = ctx.profile!.programDetails;
      for (const key of programDetailKeys) {
        if (!pd[key]) continue;
        const r = PROGRAM_DETAIL_SCHEMAS[key].safeParse(pd[key]);
        expect(issues(r), `${pb}.${key}`).toEqual([]);
        expect(r.data, `${pb}.${key}`).toEqual(pd[key]);
      }
    }
  });
});

describe("out-of-range values", () => {
  it.each([
    ["loan_request", "requestedTermMonths", 0],
    ["loan_request", "requestedTermMonths", 481],
    ["loan_request", "requestedAmortMonths", 11],
    ["loan_request", "requestedIoMonths", -1],
    ["loan_request", "existingRatePct", 40.5],
    ["loan_request", "assumedRatePct", -0.1],
    ["loan_request", "existingDebtCents", -1],
    ["loan_request", "cashOutCents", 1.5],
    ["loan_request", "purpose", "flip"],
    ["loan_request", "closeDriver", "x".repeat(301)],
    ["loan_request", "targetCloseDate", "2027-13-01"],
    ["property", "occupancyPct", 100.5],
    ["property", "ownerOccupiedPct", -1],
    ["property", "yearBuilt", 1699],
    ["property", "yearRenovated", 2101],
    ["property", "sizeCount", 1_000_001],
    ["property", "rentableSf", 100_000_001],
    ["property", "landAcres", 1_000_001],
    ["property", "postalCode", "9461"],
    ["property", "postalCode", "94611-12"],
    ["property", "assetType", "CASTLE"],
    ["property", "sizeUnit", "rooms"],
    ["property", "floodZone", "x".repeat(21)],
    ["value", "asIsValueCents", -100],
    ["value", "asIsValueSource", "guess"],
    ["value", "stabilizedValueSource", "purchase_price"],
    ["financials", "revenueCents", -1],
    ["financials", "stabilizationMonths", 121],
    ["financials", "noiBasis", "t6"],
    ["plan_exit", "exitMonths", 0],
    ["plan_exit", "exitStrategy", "lottery"],
    ["plan_exit", "businessPlan", "x".repeat(4001)],
    ["plan_exit", "highlights", Array.from({ length: 13 }, (_, i) => `Highlight ${i}`)],
    ["plan_exit", "risks", [{ risk: "Lease-up", mitigant: "Reserve", extra: true }]],
    ["sources_uses", "sources", [{ kind: "senior_loan", amountCents: 0 }]],
    ["sources_uses", "uses", [{ kind: "other", amountCents: 100 }]],
    ["sources_uses", "uses", [{ kind: "draw_holdback", amountCents: 100 }]],
  ] as const)("%s rejects %s = %j", (sectionId, field, value) => {
    expect(SECTION_SCHEMAS[sectionId].safeParse({ [field]: value }).success).toBe(false);
  });

  it("rejects an interest-only period longer than the term", () => {
    expect(SECTION_SCHEMAS.loan_request.safeParse({ requestedTermMonths: 24, requestedIoMonths: 36 }).success).toBe(false);
    expect(SECTION_SCHEMAS.loan_request.safeParse({ requestedTermMonths: 24, requestedIoMonths: 24 }).success).toBe(true);
    expect(submissionProfileFieldsSchema.safeParse({ ...blankSubmissionProfileFields("bridge"), requestedTermMonths: 12, requestedIoMonths: 13 }).success).toBe(false);
  });

  it("rejects stated sponsor figures without the date they were stated", () => {
    expect(sponsorSchema.safeParse({ statedNetWorthCents: 100, statedAsOf: null }).success).toBe(false);
    expect(sponsorSchema.safeParse({ statedNetWorthCents: 100, statedAsOf: "2026-09-30" }).success).toBe(true);
    expect(sponsorProfileFieldsSchema.safeParse({ ...blankSponsorProfileFields(), statedLiquidityCents: 5 }).success).toBe(false);
  });

  it.each([
    ["yearsExperience", 81],
    ["similarProjectsCount", -1],
    ["statedLiquidityCents", -1],
    ["statedNetWorthCents", 100_000_000_000_001],
    ["creditBand", "800_PLUS"],
    ["emailFinancialsMode", "exact"],
    ["portfolioSizeNote", "x".repeat(301)],
  ] as const)("the sponsor section rejects %s = %j", (field, value) => {
    expect(sponsorSchema.safeParse({ [field]: value, statedAsOf: "2026-09-30" }).success).toBe(false);
  });

  it("needs an explanation for a credit event that occurred", () => {
    expect(sponsorSchema.safeParse({ creditEvents: { bankruptcy: { occurred: true } } }).success).toBe(false);
    expect(sponsorSchema.safeParse({ creditEvents: { bankruptcy: { occurred: true, explanation: "Chapter 11 of a 2010 partnership, discharged 2012" } } }).success).toBe(true);
    expect(sponsorSchema.safeParse({ creditEvents: { divorce: { occurred: false } } }).success).toBe(false);
  });
});

describe("program sections", () => {
  it.each(programDetailKeys)("%s rejects an unknown key", (key) => {
    expect(PROGRAM_DETAIL_SCHEMAS[key].safeParse({ notAField: 1 }).success).toBe(false);
    expect(programDetailsSchema.safeParse({ [key]: { notAField: 1 } }).success).toBe(false);
  });

  it("rejects unknown keys inside nested objects and unknown sections", () => {
    const budget = submissionFixture("construction").profile!.programDetails.construction!.budget!;
    expect(PROGRAM_DETAIL_SCHEMAS.construction.safeParse({ budget: { ...budget, drawScheduleCents: 1 } }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.hotel.safeParse({ pip: { required: true, scope: "rooms" } }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.tenancy.safeParse({ topTenants: [{ name: "A Co", sharePct: 10, leaseEnd: "2030-01-31", phone: "x" }] }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.rehab.safeParse({ reservesRequested: { interestCents: 1, holdbackCents: 2 } }).success).toBe(false);
    expect(programDetailsSchema.safeParse({ escrow: {} }).success).toBe(false);
  });

  it("rejects out-of-range program values", () => {
    expect(PROGRAM_DETAIL_SCHEMAS.construction.safeParse({ constructionMonths: 0 }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.construction.safeParse({ contractType: "handshake" }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.rental.safeParse({ monthlyRentCents: -1 }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.sba.safeParse({ naics: "31-1811" }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.hotel.safeParse({ ffeReservePct: 101 }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.tenancy.safeParse({ topTenants: Array.from({ length: 11 }, (_, i) => ({ name: `Tenant ${i}`, sharePct: 5, leaseEnd: "2030-01-31" })) }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.capitalStack.safeParse({ intercreditorStatus: "maybe" }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.hud.safeParse({ section: "202" }).success).toBe(false);
  });

  it("stores an unanswered key as absent: blank and null inputs are dropped", () => {
    expect(PROGRAM_DETAIL_SCHEMAS.rental.parse({ monthlyRentCents: "610,000", marketRentCents: "", leaseStatus: null, monthlyHoaCents: 0 })).toEqual({ monthlyRentCents: 610_000, monthlyHoaCents: 0 });
    expect(PROGRAM_DETAIL_SCHEMAS.sba.parse({ franchise: "no", affiliates: "on", changeOfOwnership: false })).toEqual({ franchise: false, affiliates: true, changeOfOwnership: false });
  });
});

describe("restricted text (redaction.ts patterns plus the database's own checks)", () => {
  const ssn = "Guarantor SSN 123-45-6789 is on file";
  it.each([
    ssn,
    "Spaced 123 45 6789",
    "Grouped 3-3-3: 123 456 789",
    "Full-width １２３-４５-６７８９",
    "En dash 123–45–6789 and slashes 123/45/6789",
    "Zero-width 1234\u200b56789",
    "Wire to 021000021 at First Bank",
    "Operating account # 4412 0098 7712",
    "acct no. 55-1234-889",
    "routing: 1210-0035-8",
    "Card 4111 1111 1111 1111 on file",
    "DOB: 04/12/1971",
    "Sponsor born on March 3, 1980",
    // redaction.ts patterns the email gate uses, applied to saved text too.
    "Borrower EIN 12-3456789",
    "The guarantor's ITIN is in the vault",
    "Date of birth on the PFS",
  ])("refuses %j", (text) => {
    expect(restrictedTextReason(text)).not.toBeNull();
    expect(SECTION_SCHEMAS.plan_exit.safeParse({ businessPlan: text }).success).toBe(false);
  });

  it.each([
    "NOI rises from $765,000 to about $1,020,000 within two years.",
    "Call 415-555-0100 to tour; closing 2027-01-15.",
    "DSCR 1.25x at a 6.5% rate; 42 units built 1972; APN 048A-7012-015-00.",
    "Tenants have occupied the building an average of nine years.",
    "Account executive at the senior lender approved subordinate debt in principle.",
    // The database check is anchored like the app's (F15): digits inside a longer group are not an SSN.
    "Embedded 1234-56-78901",
  ])("accepts %j", (text) => {
    expect(restrictedTextReason(text)).toBeNull();
    expect(SECTION_SCHEMAS.plan_exit.safeParse({ businessPlan: text }).success).toBe(true);
  });

  it("checks every free-text field: profile, list items, program sections and sponsor", () => {
    expect(SECTION_SCHEMAS.loan_request.safeParse({ cashOutUse: ssn }).success).toBe(false);
    expect(SECTION_SCHEMAS.plan_exit.safeParse({ highlights: [ssn] }).success).toBe(false);
    expect(SECTION_SCHEMAS.plan_exit.safeParse({ risks: [{ risk: "Lease-up", mitigant: ssn }] }).success).toBe(false);
    expect(SECTION_SCHEMAS.sources_uses.safeParse({ uses: [{ kind: "other", amountCents: 100, note: ssn }] }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.rehab.safeParse({ scopeSummary: ssn }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.tenancy.safeParse({ topTenants: [{ name: ssn, sharePct: 10, leaseEnd: "2030-01-31" }] }).success).toBe(false);
    expect(PROGRAM_DETAIL_SCHEMAS.hud.safeParse({ surveyHistoryNote: "Administrator DOB: 04/12/1971" }).success).toBe(false);
    expect(sponsorSchema.safeParse({ experienceSummary: ssn }).success).toBe(false);
    expect(sponsorSchema.safeParse({ notes: "Account number 123456789012" }).success).toBe(false);
    expect(sponsorSchema.safeParse({ creditEvents: { judgment: { occurred: true, explanation: ssn } } }).success).toBe(false);
  });
});

describe("form input", () => {
  it("treats blanks as null, strips number formatting and reads checkbox values", () => {
    const r = SECTION_SCHEMAS.loan_request.parse({ purpose: "", requestedTermMonths: "24", existingDebtCents: "1,250,000", existingRatePct: " 6.1254 ", closeDriver: "  Purchase contract  " });
    expect(r).toEqual({ purpose: null, requestedTermMonths: 24, existingDebtCents: 1_250_000, existingRatePct: 6.125, closeDriver: "Purchase contract" });
    expect(SECTION_SCHEMAS.property.parse({ rentControl: "yes", seismicZone: "", maskAddress: "" })).toEqual({ rentControl: true, seismicZone: null, maskAddress: false });
    expect(SECTION_SCHEMAS.property.safeParse({ sizeCount: "forty" }).success).toBe(false);
  });

  it("leaves absent keys out of a section patch", () => {
    expect(SECTION_SCHEMAS.value.parse({ asIsValueCents: 100 })).toEqual({ asIsValueCents: 100 });
  });
});

describe("field sources", () => {
  const at = "2026-11-18T19:30:00.000Z";
  it("accepts profile columns and program-section keys, and nothing else", () => {
    expect(isFieldSourceKey("asIsValueCents")).toBe(true);
    expect(isFieldSourceKey("programDetails.hotel.adrCents")).toBe(true);
    expect(isFieldSourceKey("programDetails.hotel.pip")).toBe(true);
    expect(isFieldSourceKey("playbook")).toBe(false);
    expect(isFieldSourceKey("programDetails.hotel.ssn")).toBe(false);
    expect(isFieldSourceKey("programDetails.escrow.balance")).toBe(false);
    expect(fieldSourcesSchema.safeParse({ asIsValueCents: { source: "entered", by: "broker:ana", at } }).success).toBe(true);
    expect(fieldSourcesSchema.safeParse({ ssn: { source: "entered", by: "broker:ana", at } }).success).toBe(false);
    expect(fieldSourcesSchema.safeParse({ asIsValueCents: { source: "guess", by: "x", at } }).success).toBe(false);
    expect(fieldSourcesSchema.safeParse({ asIsValueCents: { source: "record", record: "deals", ref: "x", at } }).success).toBe(false);
    expect(fieldSourcesPatchSchema.safeParse({ asIsValueCents: null }).success).toBe(true);
  });

  it("every fixture's field sources parse", () => {
    for (const [pb, ctx] of allSubmissionFixtures()) expect(issues(fieldSourcesSchema.safeParse(ctx.profile!.fieldSources)), pb).toEqual([]);
  });

  it("names every program-section key in PROGRAM_DETAIL_FIELDS", () => {
    for (const [pb, ctx] of allSubmissionFixtures()) {
      for (const [key, value] of Object.entries(ctx.profile!.programDetails)) {
        for (const field of Object.keys(value ?? {})) expect(PROGRAM_DETAIL_FIELDS[key as keyof typeof PROGRAM_DETAIL_FIELDS], `${pb}.${key}`).toContain(field);
      }
    }
  });
});

describe("the patch schema", () => {
  it("accepts a sparse patch, a program section and a field-source removal", () => {
    const r = submissionProfilePatchSchema.safeParse({ asIsValueCents: 1, programDetails: { hotel: { brand: "Independent" } }, fieldSources: { asIsValueCents: null } });
    expect(issues(r)).toEqual([]);
    expect(submissionProfilePatchSchema.safeParse({ notAColumn: 1 }).success).toBe(false);
  });
});

describe("twins of the migration's check constraints", () => {
  const expectCheck = (key: string, l: NumberLimit) => {
    const col = snake(key);
    if (l.min === -MAX_CENTS) expect(SQL, col).toMatch(new RegExp(`\\b${col} bigint,`));
    else if (l.max === MAX_CENTS) expect(SQL, col).toContain(`${col} is null or ${col} >= ${l.min})`);
    else expect(SQL, col).toContain(`${col} is null or ${col} between ${l.min} and ${l.max})`);
  };
  it.each(Object.entries(PROFILE_NUMBER_LIMITS))("profile %s", (key, l) => expectCheck(key, l));
  it.each(Object.entries(SPONSOR_NUMBER_LIMITS))("sponsor %s", (key, l) => expectCheck(key, l));

  it("integer limits sit on integer columns, decimal limits on numeric(…, 3) columns", () => {
    for (const [key, l] of [...Object.entries(PROFILE_NUMBER_LIMITS), ...Object.entries(SPONSOR_NUMBER_LIMITS)]) {
      const decl = new RegExp(`\\n  ${snake(key)} (integer|bigint|numeric\\(\\d+, 3\\))`).exec(SQL)?.[1];
      expect(decl, key).toBeDefined();
      expect(decl!.startsWith("numeric"), key).toBe(!l.int);
    }
  });

  it("every number column of both tables has a limit here", () => {
    const declared = (table: string) => {
      const body = SQL.slice(SQL.indexOf(`create table public.${table}`), SQL.indexOf(");", SQL.indexOf(`create table public.${table}`)));
      return [...body.matchAll(/\n {2}([a-z_0-9]+) (?:integer|bigint|numeric)/g)].map((m) => m[1]!).filter((c) => c !== "record_version");
    };
    expect(declared("deal_submission_profiles").sort()).toEqual(Object.keys(PROFILE_NUMBER_LIMITS).map(snake).sort());
    expect(declared("deal_sponsor_profiles").sort()).toEqual(Object.keys(SPONSOR_NUMBER_LIMITS).map(snake).sort());
  });

  it("the regex twins are the migration's patterns", () => {
    expect(SQL).toContain(`postal_code ~ '${POSTAL_CODE_DB_RE.source}'`);
    expect(SQL).toContain(`asset_type ~ '${ASSET_TYPE_DB_RE.source}'`);
  });

  // Every free-text column (and every string inside the jsonb sections) is under the database's restricted-text check.
  const PROFILE_TEXT = ["close_driver", "prepay_preference", "existing_lender", "cash_out_use", "property_name", "city", "county", "zoning", "flood_zone", "business_plan", "exit_detail"];
  const SPONSOR_TEXT = ["experience_summary", "portfolio_size_note", "management_company", "notes"];
  it("every free-text column is in the database's restricted-text check", () => {
    const check = (name: string) => SQL.slice(SQL.indexOf(`constraint ${name} check`), SQL.indexOf(")\n", SQL.indexOf(`constraint ${name} check`) + 200));
    const profile = check("deal_submission_profiles_no_restricted");
    for (const col of PROFILE_TEXT) expect(profile, col).toMatch(new RegExp(`\\b${col}\\b`));
    for (const col of ["highlights", "risks", "sources", "uses", "program_details"]) expect(profile, col).toContain(col);
    const sponsor = check("deal_sponsor_profiles_no_restricted");
    for (const col of [...SPONSOR_TEXT, "credit_events"]) expect(sponsor, col).toContain(col);
    expect(SQL).toContain("check (not public.submission_text_restricted(concat_ws(chr(31), email_subject, email_text, readiness_override_reason)))");
  });

  it("every free-text field refuses the restricted shapes in zod, however they are written", () => {
    const camel = (c: string) => c.replace(/_([a-z])/g, (_m, x: string) => x.toUpperCase());
    const bad = ["Ref 123-45-6789", "Tax id １２３-４５-６７８９", "id ١٢٣-٤٥-٦٧٨٩", "id 123–45–6789", "id 123/45/6789", "id 123 456 789", "acct 1234\u200b56789", "date-of-birth 01/02/1970", "birthday 1/2/1970", "S.S.N. on file", "D\u200bOB on file", "acct ending 0123 4567", "Wire to account: 0123 4567 8901"];
    for (const col of PROFILE_TEXT) {
      const schema = PROFILE_FIELD_SCHEMAS[camel(col) as keyof typeof PROFILE_FIELD_SCHEMAS];
      for (const t of bad) {
        const short = t.slice(0, col === "flood_zone" ? 20 : 300);
        if (short !== t) continue;
        expect(schema.safeParse(t).success, `${col}: ${t}`).toBe(false);
      }
    }
    for (const col of SPONSOR_TEXT) for (const t of bad) expect(sponsorSchema.safeParse({ [camel(col)]: t }).success, `${col}: ${t}`).toBe(false);
  });

  it("stores free text normalized (NFKC, ASCII digits, no zero-width characters) and keeps ordinary text", () => {
    expect(PROFILE_FIELD_SCHEMAS.businessPlan.parse("Ｒenovate ２ units\u200b now")).toBe("Renovate 2 units now");
    expect(PROFILE_FIELD_SCHEMAS.closeDriver.parse("Contract close of escrow")).toBe("Contract close of escrow");
  });

  it("accepts an APN in any county format but never an SSN shape", () => {
    for (const apn of ["123-456-789", "048A-7012-015-00", "006-0123-004-0000", "331-030-19-00-5", "5432 012 034"]) expect(PROFILE_FIELD_SCHEMAS.apn.safeParse(apn).success, apn).toBe(true);
    for (const apn of ["123-45-6789", "APN; DROP", "١٢٣"]) expect(PROFILE_FIELD_SCHEMAS.apn.safeParse(apn).success, apn).toBe(false);
  });
});
