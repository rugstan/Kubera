// schema.org builders for the trust pages. They reference the Organization and
// WebSite nodes the site layout already emits (by @id) instead of redefining
// them, and they emit only facts that exist: no ratings, no reviews, no
// invented credentials.

import { ORGANIZATION_ID, WEBSITE_ID, breadcrumbSchema, type JsonLdNode } from "@/components/seo/schemas";
import type { TeamCard } from "@/content/team";
import type { TrackRecordEntry } from "@/content/track-record";
import { canonicalUrl } from "@/lib/seo/hosts";

interface PageInput {
  path: string;
  name: string;
  description: string;
}

function webPage(type: "AboutPage" | "ContactPage" | "CollectionPage" | "WebPage", { path, name, description }: PageInput): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${canonicalUrl(path)}#webpage`,
    url: canonicalUrl(path),
    name,
    description,
    inLanguage: "en-US",
    isPartOf: { "@id": WEBSITE_ID() },
    about: { "@id": ORGANIZATION_ID() },
  };
}

export const aboutPageSchema = (input: PageInput) => webPage("AboutPage", input);
export const contactPageSchema = (input: PageInput) => webPage("ContactPage", input);
export const webPageSchema = (input: PageInput) => webPage("WebPage", input);

export function personSchema({ member, license }: TeamCard): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${canonicalUrl("/team")}#${member.slug}`,
    name: member.name,
    jobTitle: member.title,
    worksFor: { "@id": ORGANIZATION_ID() },
    ...(member.email ? { email: member.email } : {}),
    ...(license.kind === "verified"
      ? { identifier: { "@type": "PropertyValue", propertyID: "California DRE license", value: license.id } }
      : {}),
  };
}

/** A list of the team page's people; empty when no card is public. */
export function teamPageSchemas(page: PageInput, cards: TeamCard[]): JsonLdNode[] {
  return [
    webPage("CollectionPage", page),
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Our advisors", path: "/team" },
    ]),
    ...cards.map(personSchema),
  ];
}

/** Closed transactions as an ItemList. Only called with publishable entries. */
export function trackRecordSchemas(page: PageInput, entries: readonly TrackRecordEntry[]): JsonLdNode[] {
  const nodes: JsonLdNode[] = [
    webPage("CollectionPage", page),
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Track record", path: "/track-record" },
    ]),
  ];
  if (entries.length > 0) {
    nodes.push({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: entries.map((e, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `${e.assetType}, ${e.program}, ${e.closedYear}`,
        description: e.summary,
      })),
    });
  }
  return nodes;
}
