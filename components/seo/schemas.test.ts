import { describe, expect, it } from "vitest";
import { breadcrumbSchema, faqSchema, serializeJsonLd, siteGraph, type JsonLdNode } from "./schemas";

function walk(value: unknown, visit: (v: unknown, key: string) => void, key = "") {
  visit(value, key);
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit, key));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, visit, k);
}

describe("site graph", () => {
  const graph = siteGraph() as { "@context": string; "@graph": JsonLdNode[] };
  const byType = (t: string) => graph["@graph"].find((n) => n["@type"] === t) as JsonLdNode;

  it("is a schema.org @graph with Organization, FinancialService and WebSite", () => {
    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@graph"].map((n) => n["@type"]).sort()).toEqual(["FinancialService", "Organization", "WebSite"]);
  });

  it("gives every node a unique absolute @id and url", () => {
    const ids = graph["@graph"].map((n) => n["@id"] as string);
    expect(new Set(ids).size).toBe(3);
    for (const n of graph["@graph"]) {
      expect(n["@id"]).toMatch(/^https?:\/\//);
      expect(n.url).toMatch(/^https?:\/\//);
      expect(n.name).toBeTruthy();
    }
  });

  it("links provider and publisher to the Organization", () => {
    const org = byType("Organization")["@id"];
    expect(byType("FinancialService").provider).toEqual({ "@id": org });
    expect(byType("WebSite").publisher).toEqual({ "@id": org });
  });

  it("has no empty values and absolute urls for image fields", () => {
    walk(graph, (v) => {
      expect(v).not.toBe("");
      expect(v).not.toBeUndefined();
      expect(v).not.toBeNull();
    });
    expect(byType("Organization").logo).toMatch(/^https?:\/\//);
    expect(byType("FinancialService").image).toMatch(/^https?:\/\//);
  });

  it("states broker-not-lender and does not claim lending", () => {
    const text = JSON.stringify(graph);
    expect(text).toContain("not a lender");
    expect(text).not.toMatch(/guarantee|pre-?approved|\bapproved\b/i);
  });
});

describe("breadcrumbSchema / faqSchema", () => {
  it("numbers breadcrumb positions and uses absolute urls", () => {
    const b = breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Financing", path: "/financing" },
    ]) as { itemListElement: { position: number; item: string }[] };
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    for (const i of b.itemListElement) expect(i.item).toMatch(/^https?:\/\//);
  });

  it("builds FAQPage questions with accepted answers", () => {
    const f = faqSchema([{ question: "Q?", answer: "A." }]) as { "@type": string; mainEntity: { acceptedAnswer: { text: string } }[] };
    expect(f["@type"]).toBe("FAQPage");
    expect(f.mainEntity[0]!.acceptedAnswer.text).toBe("A.");
  });
});

describe("serializeJsonLd", () => {
  it("escapes angle brackets so content cannot close the script tag", () => {
    const s = serializeJsonLd({ "@context": "https://schema.org", name: "</script><b>" });
    expect(s).not.toContain("<");
    expect(JSON.parse(s).name).toBe("</script><b>");
  });
});
