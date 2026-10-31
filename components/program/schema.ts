// JSON-LD for the financing pages. Builders are pure so they can be tested; the
// page components render them through `components/seo/JsonLd.tsx`.

import { breadcrumbSchema, faqSchema, ORGANIZATION_ID, type BreadcrumbItem, type JsonLdNode } from "@/components/seo/schemas";
import { FINANCING_BASE, financingPath, hubForFamily, programsInFamily } from "@/content/programs";
import type { HubEntry, ProgramEntry } from "@/content/programs";
import { canonicalUrl } from "@/lib/seo/hosts";

/**
 * schema.org LoanOrCredit for one program. Kubera is a broker, so the page names
 * it as `broker`, never as `provider`, and carries no rate or amount claims.
 */
export function loanOrCreditSchema(entry: ProgramEntry): JsonLdNode {
  const url = canonicalUrl(financingPath(entry.slug));
  return {
    "@context": "https://schema.org",
    "@type": "LoanOrCredit",
    "@id": `${url}#loan`,
    name: entry.name,
    description: entry.description,
    url,
    loanType: entry.loanType,
    currency: "USD",
    broker: { "@id": ORGANIZATION_ID() },
    ...(entry.loanTermYears
      ? { loanTerm: { "@type": "QuantitativeValue", value: entry.loanTermYears, unitCode: "ANN", unitText: "year" } }
      : {}),
  };
}

export function programBreadcrumbs(entry: ProgramEntry): BreadcrumbItem[] {
  const hub = hubForFamily(entry.family);
  const items: BreadcrumbItem[] = [
    { name: "Home", path: "/" },
    { name: "Financing", path: FINANCING_BASE },
  ];
  if (hub.slug !== entry.slug) items.push({ name: hub.name, path: financingPath(hub.slug) });
  items.push({ name: entry.name, path: financingPath(entry.slug) });
  return items;
}

export function hubBreadcrumbs(entry: HubEntry): BreadcrumbItem[] {
  return [
    { name: "Home", path: "/" },
    { name: "Financing", path: FINANCING_BASE },
    { name: entry.name, path: financingPath(entry.slug) },
  ];
}

/** LoanOrCredit + FAQPage + BreadcrumbList for a program page. */
export function programJsonLd(entry: ProgramEntry): JsonLdNode[] {
  return [loanOrCreditSchema(entry), faqSchema(entry.faq), breadcrumbSchema(programBreadcrumbs(entry))];
}

/** CollectionPage (with an ItemList of the family's programs) + FAQPage + BreadcrumbList for a hub. */
export function hubJsonLd(entry: HubEntry): JsonLdNode[] {
  const url = canonicalUrl(financingPath(entry.slug));
  const members = programsInFamily(entry.family);
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${url}#collection`,
      name: entry.name,
      description: entry.description,
      url,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: members.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: p.name,
          url: canonicalUrl(financingPath(p.slug)),
        })),
      },
    },
    faqSchema(entry.faq),
    breadcrumbSchema(hubBreadcrumbs(entry)),
  ];
}
