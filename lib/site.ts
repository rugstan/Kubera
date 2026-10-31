// Company identity and regulatory disclosures. License numbers come from the
// environment so they are never hard-coded or guessed; California requires the
// DRE license number on first-point-of-contact materials, websites included
// (Bus. & Prof. Code § 10140.6, 10 CCR § 2773).

export const site = {
  name: "Kubera Commercial",
  legalName: "Kubera Commercial, Inc.",
  primaryDomain: "kuberacommercial.com",
  expressDomain: "kubera.loans",
  designatedOfficer: "Neeli Khanna",
  dreCorporateLicense: process.env.NEXT_PUBLIC_DRE_CORPORATE_LICENSE ?? "",
  dreOfficerLicense: process.env.NEXT_PUBLIC_DRE_OFFICER_LICENSE ?? "",
  nmls: process.env.NEXT_PUBLIC_NMLS_ID ?? "",
  phone: process.env.NEXT_PUBLIC_CONTACT_PHONE ?? "",
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "deals@kuberacommercial.com",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://kuberacommercial.com",
} as const;

export function licenseLine(): string {
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
    "All rates, terms, and sizing are indicative estimates for discussion only, are not a commitment to lend, and are subject to lender underwriting, appraisal, credit approval, and program guidelines in effect at application. Kubera Commercial arranges loans as a licensed California real estate broker and is not the lender.",
  ai: "Kubera AI responses are generated automatically for educational purposes and may contain errors. They are not legal, tax, or investment advice. A licensed Kubera Commercial advisor reviews every engagement.",
  illustrative:
    "Structures shown are illustrative examples of how these programs are typically arranged. They are not client testimonials or guarantees of results; actual terms vary by borrower, asset, and market.",
} as const;
