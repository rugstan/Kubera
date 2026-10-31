import { describe, expect, it, vi } from "vitest";
import {
  createContractorLicenseLookup,
  CslbPublicLookup,
  evaluateLicense,
  isCheckStale,
  LicenseLookupError,
  normalizeLicenseNumber,
  parseCslbLicensePage,
  UnavailableLicenseLookup,
} from "./cslb";
import { goodLicense, NOW } from "./test-fixtures";

// A representative license detail page. The real CSLB markup differs in detail;
// the parser is label based (see cslb.ts).
const PAGE = `
<html><body>
<h1>Contractor's License Detail</h1>
<table>
  <tr><td>Business Information</td><td>PACIFIC BUILDERS INC<br/>100 MAIN ST<br/>LONG BEACH, CA 90802<br/>Business Phone Number: (562) 555-0100</td></tr>
  <tr><td>Entity</td><td>Corporation</td></tr>
  <tr><td>Issue Date</td><td>03/01/2010</td></tr>
  <tr><td>Expire Date</td><td>03/31/2027</td></tr>
  <tr><td>License Status</td><td>This license is current and active.</td></tr>
  <tr><td>Classifications</td><td>B - General Building Contractor<br/>C10 - Electrical</td></tr>
  <tr><td>Contractor's Bond</td><td>This license filed a Contractor's Bond with ACME SURETY. Bond Number: 100200. Effective Date: 01/01/2024</td></tr>
  <tr><td>Workers' Compensation</td><td>This license has workers compensation insurance with STATE FUND. Policy Number: 7788.</td></tr>
  <tr><td>Disciplinary Action</td><td>No disciplinary action on record.</td></tr>
</table>
</body></html>`;

describe("normalizeLicenseNumber", () => {
  it.each([
    ["1234567", "1234567"],
    [" 1234567 ", "1234567"],
    ["CSLB #1234567", "1234567"],
    ["License 987654", "987654"],
  ])("accepts %s", (raw, expected) => expect(normalizeLicenseNumber(raw)).toBe(expected));

  it.each(["", "abc", "123456789", "12-34x"])("rejects %s", (raw) => expect(normalizeLicenseNumber(raw)).toBeNull());
});

describe("parseCslbLicensePage", () => {
  it("reads status, dates, classifications, bond and workers' compensation", () => {
    expect(parseCslbLicensePage(PAGE, "1234567")).toEqual({
      licenseNumber: "1234567",
      businessName: "PACIFIC BUILDERS INC",
      status: "ACTIVE",
      issueDate: "2010-03-01",
      expirationDate: "2027-03-31",
      classifications: ["B", "C10"],
      bondOnFile: true,
      bondExpiresOn: null,
      workersCompStatus: "active",
      disciplinaryAction: false,
    });
  });

  it("reads an expired license with a cancelled bond and no workers' compensation", () => {
    const html = PAGE.replace("This license is current and active.", "This license is expired.")
      .replace("Effective Date: 01/01/2024", "Effective Date: 01/01/2024 Cancellation Date: 06/30/2025")
      .replace("This license has workers compensation insurance with STATE FUND. Policy Number: 7788.", "This license has no workers compensation insurance on file.")
      .replace("No disciplinary action on record.", "Legal Action Case Number 55 on 02/02/2025");
    const license = parseCslbLicensePage(html, "1234567");
    expect(license).toMatchObject({ status: "EXPIRED", bondExpiresOn: "2025-06-30", workersCompStatus: "none", disciplinaryAction: true });
  });

  it("returns null when CSLB has no record", () => {
    expect(parseCslbLicensePage("<html><body><p>License number 99 was not found.</p></body></html>", "99")).toBeNull();
  });

  it("throws when the page has no license content (blocked or changed layout)", () => {
    expect(() => parseCslbLicensePage("<html><body>Access denied</body></html>", "1")).toThrow(LicenseLookupError);
  });

  it("decodes HTML entities in names", () => {
    const html = PAGE.replace("PACIFIC BUILDERS INC", "SMITH &amp; SONS BUILDERS");
    expect(parseCslbLicensePage(html, "1")?.businessName).toBe("SMITH & SONS BUILDERS");
  });
});

describe("evaluateLicense", () => {
  it("passes a clean general building license", () => {
    expect(evaluateLicense(goodLicense(), NOW)).toEqual([]);
  });

  it("flags expired, inactive and soon-to-expire licenses", () => {
    expect(evaluateLicense(goodLicense({ status: "EXPIRED" }), NOW)).toContain("license_expired");
    expect(evaluateLicense(goodLicense({ status: "SUSPENDED" }), NOW)).toContain("license_not_active");
    expect(evaluateLicense(goodLicense({ expirationDate: "2026-12-15" }), NOW)).toEqual(["expires_within_90_days"]);
    expect(evaluateLicense(goodLicense({ expirationDate: "2026-10-01" }), NOW)).toEqual(["license_expired"]);
  });

  it("requires a general building or engineering classification", () => {
    expect(evaluateLicense(goodLicense({ classifications: ["C10"] }), NOW)).toEqual(["classification_mismatch"]);
    expect(evaluateLicense(goodLicense({ classifications: ["A"] }), NOW)).toEqual([]);
    expect(evaluateLicense(goodLicense({ classifications: ["C10"] }), NOW, { acceptedClassifications: ["C-10"] })).toEqual([]);
  });

  it("flags bond, workers' compensation and disciplinary problems", () => {
    expect(evaluateLicense(goodLicense({ bondOnFile: false }), NOW)).toEqual(["no_bond_on_file"]);
    expect(evaluateLicense(goodLicense({ bondExpiresOn: "2026-01-01" }), NOW)).toEqual(["bond_expired"]);
    expect(evaluateLicense(goodLicense({ workersCompStatus: "none" }), NOW)).toEqual(["no_workers_comp"]);
    expect(evaluateLicense(goodLicense({ workersCompStatus: "exempt" }), NOW)).toEqual([]);
    expect(evaluateLicense(goodLicense({ disciplinaryAction: true }), NOW)).toEqual(["disciplinary_action"]);
  });
});

describe("isCheckStale", () => {
  it("expires a check after 30 days", () => {
    expect(isCheckStale("2026-10-10T00:00:00Z", NOW)).toBe(false);
    expect(isCheckStale("2026-09-30T00:00:00Z", NOW)).toBe(true);
  });
});

describe("CslbPublicLookup", () => {
  it("requests the public detail page and parses it", async () => {
    const fetchImpl = vi.fn(async () => new Response(PAGE, { status: 200 }));
    const lookup = new CslbPublicLookup("https://cslb.test/", fetchImpl as unknown as typeof fetch);
    const license = await lookup.lookup("1234567");
    expect(license?.status).toBe("ACTIVE");
    const url = (fetchImpl.mock.calls[0] as unknown as [string])[0];
    expect(url).toBe("https://cslb.test/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=1234567");
  });

  it("maps 404 to not found and other failures to LicenseLookupError", async () => {
    expect(await new CslbPublicLookup("https://x", (async () => new Response("", { status: 404 })) as unknown as typeof fetch).lookup("1")).toBeNull();
    await expect(new CslbPublicLookup("https://x", (async () => new Response("", { status: 503 })) as unknown as typeof fetch).lookup("1")).rejects.toBeInstanceOf(LicenseLookupError);
    await expect(
      new CslbPublicLookup("https://x", (async () => {
        throw new TypeError("network");
      }) as unknown as typeof fetch).lookup("1"),
    ).rejects.toBeInstanceOf(LicenseLookupError);
  });

  it("rejects malformed license numbers without calling out", async () => {
    const fetchImpl = vi.fn();
    await expect(new CslbPublicLookup("https://x", fetchImpl as unknown as typeof fetch).lookup("../etc")).rejects.toBeInstanceOf(LicenseLookupError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createContractorLicenseLookup", () => {
  it("is unavailable unless explicitly enabled, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lookup = createContractorLicenseLookup({});
    expect(lookup).toBeInstanceOf(UnavailableLicenseLookup);
    expect(lookup.available).toBe(false);
    await expect(lookup.lookup("1")).rejects.toBeInstanceOf(LicenseLookupError);
    await expect(lookup.lookup("1")).rejects.toBeInstanceOf(LicenseLookupError);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    warn.mockRestore();
    expect(createContractorLicenseLookup({ CSLB_LOOKUP_ENABLED: "true" })).toBeInstanceOf(CslbPublicLookup);
  });
});
