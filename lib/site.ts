// Company identity and regulatory disclosures. California requires the DRE
// license number on first-point-of-contact materials, websites included
// (Bus. & Prof. Code § 10140.6, 10 CCR § 2773). The license of record below was
// supplied by the broker; the environment can override it (CI and e2e use
// obviously fake values) and an explicitly blank value still fails the
// production guard.

import { deploymentEnv } from "./deploy-env";

type Env = Record<string, string | undefined>;

/** Corin Commercial's California DRE license of record (public by law). */
export const DRE_LICENSE_OF_RECORD = "01522444";

function corporateLicense(env: Env): string {
  return (env.NEXT_PUBLIC_DRE_CORPORATE_LICENSE ?? DRE_LICENSE_OF_RECORD).trim();
}

export const site = {
  name: "Corin Commercial",
  legalName: "Corin Commercial, Inc.",
  primaryDomain: "corincommercial.com",
  expressDomain: "kubera.loans",
  designatedOfficer: "Neeli Khanna",
  dreCorporateLicense: corporateLicense({ NEXT_PUBLIC_DRE_CORPORATE_LICENSE: process.env.NEXT_PUBLIC_DRE_CORPORATE_LICENSE }),
  dreOfficerLicense: (process.env.NEXT_PUBLIC_DRE_OFFICER_LICENSE ?? "").trim(),
  nmls: (process.env.NEXT_PUBLIC_NMLS_ID ?? "").trim(),
  phone: (process.env.NEXT_PUBLIC_CONTACT_PHONE ?? "").trim(),
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "deals@corincommercial.com",
  privacyEmail: "privacy@corincommercial.com",
  /** Main office address on file with the DRE; shown on the licensing page and the MLDS. */
  licensedAddress: (process.env.NEXT_PUBLIC_DRE_LICENSED_ADDRESS ?? "").trim(),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://corincommercial.com",
} as const;

/** DRE license IDs are eight digits (leading zeros are significant). */
export const DRE_LICENSE_PATTERN = /^\d{8}$/;

// Where this build will be served (lib/deploy-env.ts, side-effect free).
export { deploymentEnv, type DeploymentEnv } from "./deploy-env";

export class LicenseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseConfigurationError";
  }
}

/**
 * Build-time license guard. A production deployment must carry the corporate
 * DRE license number so no loan advertising or first-point-of-contact page can
 * ship with a placeholder. Preview and development builds are allowed through.
 */
export function assertLicenseConfigured(env: Env = process.env): void {
  if (deploymentEnv(env) !== "production") return;
  const corp = corporateLicense(env);
  if (!corp) {
    throw new LicenseConfigurationError(
      "NEXT_PUBLIC_DRE_CORPORATE_LICENSE is empty. California requires the DRE license number on the website; set it before deploying to production.",
    );
  }
  if (!DRE_LICENSE_PATTERN.test(corp) || /^0+$/.test(corp)) {
    throw new LicenseConfigurationError("NEXT_PUBLIC_DRE_CORPORATE_LICENSE must be the eight-digit DRE license ID.");
  }
  const officer = (env.NEXT_PUBLIC_DRE_OFFICER_LICENSE ?? "").trim();
  if (officer && !DRE_LICENSE_PATTERN.test(officer)) {
    throw new LicenseConfigurationError("NEXT_PUBLIC_DRE_OFFICER_LICENSE must be the eight-digit DRE license ID.");
  }
}

// Runs once when the module is first loaded on the server, which happens while
// `next build` prerenders any page. Browsers never evaluate the guard.
if (typeof window === "undefined") assertLicenseConfigured();

/** Public DRE license lookup for a license ID. */
export function dreLookupUrl(licenseId: string): string {
  return `https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=${encodeURIComponent(licenseId)}`;
}

export function licenseLine(): string {
  // In production the guard above guarantees the license is set, so the
  // placeholder can only appear on preview and development builds.
  const corp = site.dreCorporateLicense
    ? `CA DRE Corp. License #${site.dreCorporateLicense}`
    : "CA DRE Corp. License # (pending configuration)";
  const officer = site.dreOfficerLicense
    ? `Designated Officer: ${site.designatedOfficer}, DRE #${site.dreOfficerLicense}`
    : `Designated Officer: ${site.designatedOfficer}`;
  // 10 CCR §2847.3 requires this statement in loan advertising.
  return [site.legalName, "Real estate broker, California Department of Real Estate", corp, officer, site.nmls && `NMLS #${site.nmls}`]
    .filter(Boolean)
    .join(" · ");
}

export const disclosures = {
  indicative:
    "All rates, terms, and sizing are indicative estimates for discussion only, are not a commitment to lend, and are subject to lender underwriting, appraisal, credit approval, and program guidelines in effect at application. Corin Commercial arranges loans as a licensed California real estate broker and is not the lender.",
  illustrative:
    "Structures shown are illustrative examples of how these programs are typically arranged. They are not client testimonials or guarantees of results; actual terms vary by borrower, asset, and market.",
  timeline:
    "Timelines are typical ranges after a complete file and are subject to lender approval, appraisal, title, and diligence. They are not guaranteed.",
  brokerNotLender:
    "Corin Commercial is a real estate broker, not a lender. Lenders make all credit decisions and fund loans as lender of record. Corin never holds, transfers, or disburses loan funds and does not service loans.",
  mlds:
    "On every loan Corin arranges that is secured by real property, you receive a Mortgage Loan Disclosure Statement (DRE form RE 882) no later than three business days after we receive your completed written loan application, and in every case before you become obligated on the loan.",
} as const;
