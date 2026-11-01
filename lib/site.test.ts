import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLicenseConfigured, deploymentEnv, DRE_LICENSE_OF_RECORD, dreLookupUrl, LicenseConfigurationError } from "./site";

describe("deploymentEnv", () => {
  it.each([
    [{ VERCEL_ENV: "production" }, "production"],
    [{ VERCEL_ENV: "preview", NODE_ENV: "production" }, "preview"],
    [{ DEPLOY_ENV: "production", NODE_ENV: "production" }, "production"],
    [{ DEPLOY_ENV: "preview" }, "preview"],
    // A plain `next build` in CI is not a production deployment.
    [{ NODE_ENV: "production" }, "preview"],
    [{ NODE_ENV: "development" }, "development"],
    [{ NODE_ENV: "test" }, "development"],
    [{}, "development"],
    // Vercel's own value wins over DEPLOY_ENV.
    [{ VERCEL_ENV: "preview", DEPLOY_ENV: "production" }, "preview"],
  ] as const)("%j → %s", (env, expected) => {
    expect(deploymentEnv(env)).toBe(expected);
  });
});

describe("assertLicenseConfigured (build-time license guard)", () => {
  const prod = { VERCEL_ENV: "production", NODE_ENV: "production" };

  it("throws in a production deployment when the corporate license is set blank", () => {
    expect(() => assertLicenseConfigured({ ...prod, NEXT_PUBLIC_DRE_CORPORATE_LICENSE: "" })).toThrow(LicenseConfigurationError);
    expect(() => assertLicenseConfigured({ ...prod, NEXT_PUBLIC_DRE_CORPORATE_LICENSE: "" })).toThrow(/NEXT_PUBLIC_DRE_CORPORATE_LICENSE is empty/);
    expect(() => assertLicenseConfigured({ ...prod, NEXT_PUBLIC_DRE_CORPORATE_LICENSE: "   " })).toThrow(/is empty/);
  });

  it("throws on non-Vercel production hosts that declare DEPLOY_ENV=production", () => {
    expect(() => assertLicenseConfigured({ DEPLOY_ENV: "production", NODE_ENV: "production", NEXT_PUBLIC_DRE_CORPORATE_LICENSE: "" })).toThrow(LicenseConfigurationError);
  });

  it("falls back to the license of record when the environment does not set one", () => {
    expect(DRE_LICENSE_OF_RECORD).toMatch(/^\d{8}$/);
    expect(() => assertLicenseConfigured({ ...prod })).not.toThrow();
    expect(() => assertLicenseConfigured({ DEPLOY_ENV: "production", NODE_ENV: "production" })).not.toThrow();
  });

  it.each(["1234567", "123456789", "02ABC123", "00000000", "TBD"])("rejects malformed license %s in production", (value) => {
    expect(() => assertLicenseConfigured({ ...prod, NEXT_PUBLIC_DRE_CORPORATE_LICENSE: value })).toThrow(/eight-digit/);
  });

  it("rejects a malformed officer license in production but allows it to be omitted", () => {
    expect(() => assertLicenseConfigured({ ...prod, NEXT_PUBLIC_DRE_CORPORATE_LICENSE: "02123456", NEXT_PUBLIC_DRE_OFFICER_LICENSE: "123" })).toThrow(
      /NEXT_PUBLIC_DRE_OFFICER_LICENSE/,
    );
    expect(() => assertLicenseConfigured({ ...prod, NEXT_PUBLIC_DRE_CORPORATE_LICENSE: "02123456" })).not.toThrow();
  });

  it("passes in production with valid licenses", () => {
    expect(() =>
      assertLicenseConfigured({ ...prod, NEXT_PUBLIC_DRE_CORPORATE_LICENSE: " 02123456 ", NEXT_PUBLIC_DRE_OFFICER_LICENSE: "01987654" }),
    ).not.toThrow();
  });

  it("allows preview, CI, and development builds without a license", () => {
    expect(() => assertLicenseConfigured({ VERCEL_ENV: "preview", NODE_ENV: "production" })).not.toThrow();
    expect(() => assertLicenseConfigured({ NODE_ENV: "production" })).not.toThrow();
    expect(() => assertLicenseConfigured({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertLicenseConfigured({})).not.toThrow();
  });
});

describe("lib/site module load", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("fails to load in a production deployment without the corporate license", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DRE_CORPORATE_LICENSE", "");
    await expect(import("./site")).rejects.toThrow(/NEXT_PUBLIC_DRE_CORPORATE_LICENSE is empty/);
  });

  it("loads in production with a license, and the license line never shows a placeholder", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DRE_CORPORATE_LICENSE", "02123456");
    vi.stubEnv("NEXT_PUBLIC_DRE_OFFICER_LICENSE", "01987654");
    const mod = await import("./site");
    const line = mod.licenseLine();
    expect(line).toContain("CA DRE Corp. License #02123456");
    expect(line).toContain("DRE #01987654");
    expect(line).not.toMatch(/pending configuration/i);
  });

  it("shows the license of record when the environment does not set one", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DRE_CORPORATE_LICENSE", undefined);
    const mod = await import("./site");
    expect(mod.site.dreCorporateLicense).toBe("01522444");
    expect(mod.licenseLine()).toContain("CA DRE Corp. License #01522444");
  });

  it("loads in preview with a blank license and marks the placeholder", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_DRE_CORPORATE_LICENSE", "");
    const mod = await import("./site");
    expect(mod.licenseLine()).toMatch(/pending configuration/);
  });
});

describe("licenseLine", () => {
  it("carries the 10 CCR §2847.3 advertising statement and the legal name", async () => {
    const { licenseLine } = await import("./site");
    const line = licenseLine();
    expect(line).toContain("Kubera Commercial, Inc.");
    expect(line).toContain("Real estate broker, California Department of Real Estate");
  });
});

describe("dreLookupUrl", () => {
  it("links to the DRE public license lookup", () => {
    expect(dreLookupUrl("02123456")).toBe("https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=02123456");
  });
});
