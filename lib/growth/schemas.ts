// schema.org builders for the growth pages (insights, rates, calculators,
// glossary, California markets). They return plain JSON-LD nodes that
// `components/seo/JsonLd.tsx` serializes. Only facts that exist on the page are
// emitted: optional properties are left out rather than set to empty strings.

import { ORGANIZATION_ID, SITE_DESCRIPTION, type JsonLdNode } from "@/components/seo/schemas";
import { canonicalUrl } from "@/lib/seo/hosts";
import { site } from "@/lib/site";

const CONTEXT = "https://schema.org";

function compact<T extends JsonLdNode>(node: T): T {
  return Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))) as T;
}

export type PersonInput = { name: string; jobTitle?: string; /** Path on the canonical site, e.g. `/team`. */ path?: string };

export function personSchema(p: PersonInput): JsonLdNode {
  return compact({
    "@type": "Person",
    name: p.name,
    jobTitle: p.jobTitle,
    url: p.path ? canonicalUrl(p.path) : undefined,
    worksFor: { "@id": ORGANIZATION_ID() },
  });
}

export type ArticleInput = {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified: string;
  author: PersonInput;
  section?: string;
  wordCount?: number;
  keywords?: readonly string[];
};

export function articleSchema(a: ArticleInput): JsonLdNode {
  const url = canonicalUrl(a.path);
  return {
    "@context": CONTEXT,
    ...compact({
      "@type": "Article",
      "@id": `${url}#article`,
      headline: a.headline,
      description: a.description,
      url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      image: [canonicalUrl("/opengraph-image")],
      datePublished: a.datePublished,
      dateModified: a.dateModified,
      author: personSchema(a.author),
      publisher: { "@id": ORGANIZATION_ID() },
      articleSection: a.section,
      wordCount: a.wordCount,
      keywords: a.keywords ? [...a.keywords].join(", ") : undefined,
      inLanguage: "en-US",
    }),
  };
}

export type DatasetVariable = { name: string; description: string; unitText: string; url?: string };

export type DatasetInput = {
  name: string;
  description: string;
  path: string;
  /** ISO date the figures were last updated. */
  dateModified: string;
  /** ISO interval, e.g. `2026-10-01/2026-10-30`. */
  temporalCoverage?: string;
  variables: readonly DatasetVariable[];
  /** Where the underlying series come from. */
  creator: { name: string; url: string };
  /** Free-text attribution shown on the page. */
  citation: string;
};

export function datasetSchema(d: DatasetInput): JsonLdNode {
  const url = canonicalUrl(d.path);
  return {
    "@context": CONTEXT,
    ...compact({
      "@type": "Dataset",
      "@id": `${url}#dataset`,
      name: d.name,
      description: d.description,
      url,
      dateModified: d.dateModified,
      temporalCoverage: d.temporalCoverage,
      creator: { "@type": "Organization", name: d.creator.name, url: d.creator.url },
      publisher: { "@id": ORGANIZATION_ID() },
      isBasedOn: d.variables.map((v) => v.url).filter((u): u is string => Boolean(u)),
      citation: d.citation,
      variableMeasured: d.variables.map((v) => compact({ "@type": "PropertyValue", name: v.name, description: v.description, unitText: v.unitText, url: v.url })),
      inLanguage: "en-US",
    }),
  };
}

export type DefinedTermInput = { name: string; description: string; /** Anchor id on the glossary page. */ anchor: string };

export function definedTermSetSchema(input: { name: string; description: string; path: string; terms: readonly DefinedTermInput[] }): JsonLdNode {
  const url = canonicalUrl(input.path);
  return {
    "@context": CONTEXT,
    "@type": "DefinedTermSet",
    "@id": `${url}#termset`,
    name: input.name,
    description: input.description,
    url,
    inLanguage: "en-US",
    hasDefinedTerm: input.terms.map((t) => ({
      "@type": "DefinedTerm",
      "@id": `${url}#${t.anchor}`,
      name: t.name,
      description: t.description,
      url: `${url}#${t.anchor}`,
      inDefinedTermSet: { "@id": `${url}#termset` },
    })),
  };
}

export function webApplicationSchema(input: { name: string; description: string; path: string }): JsonLdNode {
  const url = canonicalUrl(input.path);
  return {
    "@context": CONTEXT,
    "@type": "WebApplication",
    "@id": `${url}#app`,
    name: input.name,
    description: input.description,
    url,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    publisher: { "@id": ORGANIZATION_ID() },
    inLanguage: "en-US",
  };
}

export function marketServiceSchema(input: { name: string; description: string; path: string; areaServed: readonly string[] }): JsonLdNode {
  const url = canonicalUrl(input.path);
  return {
    "@context": CONTEXT,
    "@type": "Service",
    "@id": `${url}#service`,
    name: input.name,
    serviceType: "Commercial real estate loan brokerage",
    description: input.description,
    url,
    provider: { "@id": ORGANIZATION_ID() },
    areaServed: input.areaServed.map((name) => ({ "@type": "AdministrativeArea", name })),
  };
}

export function collectionSchema(input: { name: string; description: string; path: string; items: readonly { name: string; path: string }[] }): JsonLdNode {
  const url = canonicalUrl(input.path);
  return {
    "@context": CONTEXT,
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    name: input.name,
    description: input.description,
    url,
    isPartOf: { "@type": "WebSite", name: site.name, url: canonicalUrl("/") },
    publisher: { "@id": ORGANIZATION_ID() },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: input.items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, url: canonicalUrl(item.path) })),
    },
  };
}

export { SITE_DESCRIPTION };
