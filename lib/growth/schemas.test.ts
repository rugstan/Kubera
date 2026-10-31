import { describe, expect, it } from "vitest";
import { insightAuthor, INSIGHTS, insightPath, wordCount } from "@/content/insights";
import { CALCULATORS, calculatorPath } from "@/content/calculators";
import { GLOSSARY } from "@/content/glossary";
import { articleSchema, collectionSchema, datasetSchema, definedTermSetSchema, marketServiceSchema, personSchema, webApplicationSchema } from "./schemas";

/** Every string value in a JSON-LD tree. */
function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => strings(n, out));
  else if (node && typeof node === "object") Object.values(node).forEach((n) => strings(n, out));
  return out;
}

function expectWellFormed(node: unknown) {
  const text = JSON.stringify(node);
  expect(text).not.toContain('""');
  expect(text).not.toContain("null");
  expect(text).not.toContain("undefined");
  for (const s of strings(node)) {
    if (/^https?:/.test(s)) expect(() => new URL(s)).not.toThrow();
  }
}

describe("Article schema", () => {
  const insight = INSIGHTS[0]!;
  const node = articleSchema({
    headline: insight.title,
    description: insight.description,
    path: insightPath(insight.slug),
    datePublished: insight.published,
    dateModified: insight.updated,
    author: insightAuthor(),
    section: insight.category,
    wordCount: wordCount(insight),
  }) as Record<string, any>;

  it("has the required Article properties and a Person author", () => {
    expect(node["@context"]).toBe("https://schema.org");
    expect(node["@type"]).toBe("Article");
    expect(node.headline).toBe(insight.title);
    expect(node.datePublished).toBe(insight.published);
    expect(node.dateModified).toBe(insight.updated);
    expect(node.author["@type"]).toBe("Person");
    expect(node.author.name).toBe(insightAuthor().name);
    expect(node.author.url).toMatch(/^https?:\/\/.+\/team$/);
    expect(node.publisher["@id"]).toMatch(/#organization$/);
    expect(node.image[0]).toMatch(/^https?:\/\//);
    expect(node.mainEntityOfPage["@id"]).toBe(node.url);
    expect(node.url).toMatch(new RegExp(`${insight.slug}$`));
  });

  it("is well formed with dates in ISO 8601", () => {
    expectWellFormed(node);
    expect(node.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("omits optional properties that are not given", () => {
    const bare = articleSchema({ headline: "H", description: "D", path: "/insights/x", datePublished: "2026-10-31", dateModified: "2026-10-31", author: { name: "A B" } }) as Record<string, any>;
    expect("articleSection" in bare).toBe(false);
    expect("wordCount" in bare).toBe(false);
    expect("keywords" in bare).toBe(false);
    expect("jobTitle" in bare.author).toBe(false);
    expect("url" in bare.author).toBe(false);
  });

  it("every article produces a valid node", () => {
    for (const i of INSIGHTS) {
      const n = articleSchema({ headline: i.title, description: i.description, path: insightPath(i.slug), datePublished: i.published, dateModified: i.updated, author: insightAuthor(), section: i.category, wordCount: wordCount(i) });
      expectWellFormed(n);
    }
  });
});

describe("Person schema", () => {
  it("links the person to the organization", () => {
    const p = personSchema({ name: "Pat Lee", jobTitle: "Broker" }) as Record<string, any>;
    expect(p["@type"]).toBe("Person");
    expect(p.worksFor["@id"]).toMatch(/#organization$/);
  });
});

describe("Dataset schema", () => {
  const node = datasetSchema({
    name: "Rates",
    description: "Daily series",
    path: "/rates",
    dateModified: "2026-10-30",
    temporalCoverage: "2026-10-30",
    creator: { name: "Federal Reserve Bank of St. Louis (FRED)", url: "https://fred.stlouisfed.org/" },
    citation: "Source: FRED",
    variables: [
      { name: "10-year Treasury", description: "DGS10", unitText: "percent", url: "https://fred.stlouisfed.org/series/DGS10" },
      { name: "SOFR", description: "30-day average", unitText: "percent" },
    ],
  }) as Record<string, any>;

  it("carries the fields search engines look for", () => {
    expect(node["@type"]).toBe("Dataset");
    expect(node.name).toBe("Rates");
    expect(node.description).toBe("Daily series");
    expect(node.dateModified).toBe("2026-10-30");
    expect(node.creator).toMatchObject({ "@type": "Organization", name: expect.stringContaining("FRED") });
    expect(node.citation).toContain("FRED");
    expect(node.variableMeasured).toHaveLength(2);
    expect(node.variableMeasured[0]).toMatchObject({ "@type": "PropertyValue", unitText: "percent", url: "https://fred.stlouisfed.org/series/DGS10" });
    expect("url" in node.variableMeasured[1]).toBe(false);
    expect(node.isBasedOn).toEqual(["https://fred.stlouisfed.org/series/DGS10"]);
    expectWellFormed(node);
  });
});

describe("DefinedTermSet schema", () => {
  it("emits one DefinedTerm per glossary entry with anchors that match the page ids", () => {
    const node = definedTermSetSchema({
      name: "Glossary",
      description: "Terms",
      path: "/glossary",
      terms: GLOSSARY.map((t) => ({ name: t.term, description: t.definition, anchor: t.slug })),
    }) as Record<string, any>;
    expect(node["@type"]).toBe("DefinedTermSet");
    expect(node.hasDefinedTerm).toHaveLength(GLOSSARY.length);
    expect(node.hasDefinedTerm[0]["@type"]).toBe("DefinedTerm");
    const ids = node.hasDefinedTerm.map((t: any) => t["@id"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of node.hasDefinedTerm) {
      expect(t.url).toBe(t["@id"]);
      expect(t.inDefinedTermSet["@id"]).toBe(node["@id"]);
    }
    expectWellFormed(node);
  });
});

describe("WebApplication, Service and CollectionPage schemas", () => {
  it("describes each calculator as a free finance web application", () => {
    for (const c of CALCULATORS) {
      const n = webApplicationSchema({ name: c.name, description: c.description, path: calculatorPath(c.slug) }) as Record<string, any>;
      expect(n["@type"]).toBe("WebApplication");
      expect(n.applicationCategory).toBe("FinanceApplication");
      expect(n.isAccessibleForFree).toBe(true);
      expectWellFormed(n);
    }
  });

  it("describes a metro page as a brokerage service in named areas", () => {
    const n = marketServiceSchema({ name: "Commercial real estate loan brokerage in Los Angeles", description: "d", path: "/california/los-angeles", areaServed: ["City of Los Angeles", "Los Angeles County"] }) as Record<string, any>;
    expect(n["@type"]).toBe("Service");
    expect(n.provider["@id"]).toMatch(/#organization$/);
    expect(n.areaServed).toEqual([
      { "@type": "AdministrativeArea", name: "City of Los Angeles" },
      { "@type": "AdministrativeArea", name: "Los Angeles County" },
    ]);
    expectWellFormed(n);
  });

  it("lists collection items in order", () => {
    const n = collectionSchema({ name: "Insights", description: "d", path: "/insights", items: [{ name: "A", path: "/insights/a" }, { name: "B", path: "/insights/b" }] }) as Record<string, any>;
    expect(n.mainEntity.itemListElement.map((i: any) => i.position)).toEqual([1, 2]);
    expect(n.mainEntity.itemListElement[0].url).toMatch(/\/insights\/a$/);
    expectWellFormed(n);
  });
});
