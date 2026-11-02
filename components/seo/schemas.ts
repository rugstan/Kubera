// schema.org JSON-LD builders. Only facts that exist in the codebase are emitted;
// optional properties are omitted (never empty strings) when env values are unset.

import { canonicalUrl } from "@/lib/seo/hosts";
import { site } from "@/lib/site";

export type JsonLdNode = Record<string, unknown>;

export const ORGANIZATION_ID = () => `${canonicalUrl("/")}#organization`;
export const SERVICE_ID = () => `${canonicalUrl("/")}#service`;
export const WEBSITE_ID = () => `${canonicalUrl("/")}#website`;

const SERVICE_TYPES = [
  "Commercial real estate loan brokerage",
  "HUD 232 and 223(f) senior housing financing",
  "SBA 504 and 7(a) hotel financing",
  "Hotel CMBS and PIP bridge financing",
  "Multifamily agency and HUD financing",
  "Private bridge, hard money and construction financing",
];

export const SITE_DESCRIPTION =
  "Kubera Commercial arranges senior living, hotel, multifamily, construction and hard money loans as a licensed California real estate broker. It is not a lender.";

function withoutEmpty<T extends JsonLdNode>(node: T): T {
  return Object.fromEntries(Object.entries(node).filter(([, v]) => v !== "" && v !== undefined && v !== null)) as T;
}

export function organizationSchema(): JsonLdNode {
  return withoutEmpty({
    "@type": "Organization",
    "@id": ORGANIZATION_ID(),
    name: site.name,
    legalName: site.legalName,
    url: canonicalUrl("/"),
    logo: canonicalUrl("/icon.svg"),
    description: SITE_DESCRIPTION,
    email: site.email,
    telephone: site.phone,
    identifier: site.dreCorporateLicense
      ? { "@type": "PropertyValue", propertyID: "California DRE corporate license", value: site.dreCorporateLicense }
      : "",
  });
}

/**
 * Builds a schema.org PostalAddress from the free-form licensed address
 * ("123 Main St, Suite 4, Irvine, CA 92618"). When the text does not end in a
 * "City, ST 12345" pattern the whole string becomes the street address.
 * (A two-letter state plus ZIP code is a US address, hence addressCountry.)
 */
export function postalAddressSchema(raw: string): JsonLdNode | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length && /^(usa?|united states( of america)?)$/i.test(parts[parts.length - 1]!)) parts.pop();
  const regionZip = parts.length >= 3 ? /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(parts[parts.length - 1]!) : null;
  if (!regionZip) {
    // Nothing beyond the configured text is guessed.
    return { "@type": "PostalAddress", streetAddress: text };
  }
  return {
    "@type": "PostalAddress",
    streetAddress: parts.slice(0, -2).join(", "),
    addressLocality: parts[parts.length - 2],
    addressRegion: regionZip[1]!.toUpperCase(),
    postalCode: regionZip[2],
    addressCountry: "US",
  };
}

/**
 * FinancialService is Organization > LocalBusiness > FinancialService, so only
 * Organization/LocalBusiness properties apply here: the Service-only
 * `provider` and `serviceType` are not valid on this type. Programs are listed
 * with `knowsAbout`, and `parentOrganization` links the Organization node.
 */
export function financialServiceSchema(licensedAddress: string = site.licensedAddress): JsonLdNode {
  return withoutEmpty({
    "@type": "FinancialService",
    "@id": SERVICE_ID(),
    name: `${site.name} loan brokerage`,
    url: canonicalUrl("/"),
    image: canonicalUrl("/opengraph-image"),
    description: SITE_DESCRIPTION,
    knowsAbout: SERVICE_TYPES,
    areaServed: { "@type": "State", name: "California" },
    address: postalAddressSchema(licensedAddress),
    email: site.email,
    telephone: site.phone,
    parentOrganization: { "@id": ORGANIZATION_ID() },
  });
}

export function websiteSchema(): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID(),
    name: site.name,
    url: canonicalUrl("/"),
    inLanguage: "en-US",
    publisher: { "@id": ORGANIZATION_ID() },
  };
}

/** Organization + FinancialService + WebSite as one linked `@graph`. */
export function siteGraph(): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationSchema(), financialServiceSchema(), websiteSchema()],
  };
}

export interface BreadcrumbItem {
  name: string;
  /** Path on the canonical site. */
  path: string;
}

export function breadcrumbSchema(items: BreadcrumbItem[]): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqSchema(items: FaqItem[]): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: { "@type": "Answer", text: q.answer },
    })),
  };
}

/** Serialize for a `<script type="application/ld+json">` body; `<` is escaped so content cannot close the tag. */
export function serializeJsonLd(data: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
