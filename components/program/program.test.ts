import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { financingPath, financingSlugs, getFinancingPage, hubs, programs } from "@/content/programs";
import { pageMetadata } from "@/lib/seo/metadata";
import { serializeJsonLd } from "@/components/seo/schemas";
import { HubPage, ProgramPage } from "./ProgramPage";
import { hubJsonLd, loanOrCreditSchema, programBreadcrumbs, programJsonLd } from "./schema";

function render(slug: string): string {
  const page = getFinancingPage(slug);
  if (!page) throw new Error(`no page ${slug}`);
  return renderToStaticMarkup(
    page.kind === "hub" ? createElement(HubPage, { entry: page.entry }) : createElement(ProgramPage, { entry: page.entry }),
  );
}

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    const parsed = JSON.parse(m[1]!.replace(/\\u003c/g, "<"));
    out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  return out;
}

describe("every financing slug renders", () => {
  for (const slug of financingSlugs) {
    it(slug, () => {
      const html = render(slug);
      const page = getFinancingPage(slug)!;
      expect(html).toContain("<h1");
      expect(html).toContain(page.entry.name);
      expect(html).toContain(page.entry.definition.slice(0, 60).replace(/&/g, "&amp;"));
      // Internal links and calls to action. Both actions carry the page's family, so a
      // construction or hard money visitor lands on their own qualifier step and sizer tab.
      const family = page.entry.family;
      expect(html).toContain(`href="/?sizer=${family}#sizer"`);
      expect(html).toContain(`href="/express?family=${family}"`);
      expect(html).not.toContain('href="/express"');
      expect(html).toContain('href="/financing"');
      // The closing call to action is a light card, never a dark band.
      expect(html).not.toContain("bento-pro");
      // Per-row review flags are internal: the table states one caveat instead.
      expect(html).not.toContain("Re-check before relying on it");
      for (const related of page.entry.related) expect(html, `${slug} -> ${related}`).toContain(`href="${financingPath(related)}"`);
      // Legal copy.
      expect(html).toContain("Real estate broker, California Department of Real Estate");
      expect(html).toContain("not a lender");
      // FAQ is visible as well as in JSON-LD.
      for (const q of page.entry.faq) expect(html).toContain(q.question.replace(/&/g, "&amp;").replace(/'/g, "&#x27;"));
    });
  }
});

describe("program pages", () => {
  it("renders the facts table with sources and as-of dates", () => {
    const html = render("hud-223f-multifamily");
    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain("as of 2026-10-31");
    expect(html).toContain("HUD Mortgagee Letter 2025-03");
  });

  it("hard-money doubles as the hub and lists its family", () => {
    const html = render("hard-money");
    expect(html).toContain(`href="${financingPath("fix-and-flip")}"`);
    expect(html).toContain(`href="${financingPath("private-bridge")}"`);
  });

  it("a hub lists every program in its family", () => {
    const html = render("senior-living");
    for (const slug of ["hud-232", "rcfe", "skilled-nursing", "memory-care"]) {
      expect(html).toContain(`href="${financingPath(slug)}"`);
    }
  });
});

describe("JSON-LD", () => {
  it("program pages emit LoanOrCredit, FAQPage and BreadcrumbList", () => {
    for (const p of programs) {
      const types = jsonLdBlocks(render(p.slug)).map((b) => b["@type"]);
      expect(types, p.slug).toEqual(["LoanOrCredit", "FAQPage", "BreadcrumbList"]);
    }
  });

  it("hub pages emit CollectionPage, FAQPage and BreadcrumbList", () => {
    for (const h of hubs) {
      const types = jsonLdBlocks(render(h.slug)).map((b) => b["@type"]);
      expect(types, h.slug).toEqual(["CollectionPage", "FAQPage", "BreadcrumbList"]);
    }
  });

  it("names Corin as broker, never provider, and uses absolute URLs", () => {
    for (const p of programs) {
      const node = loanOrCreditSchema(p) as Record<string, unknown>;
      expect(node["@context"]).toBe("https://schema.org");
      expect(node.broker).toBeDefined();
      expect(node.provider).toBeUndefined();
      expect(node.url).toBe(`https://corincommercial.com${financingPath(p.slug)}`);
      expect(node.name).toBe(p.name);
      expect(String(node.loanType).length).toBeGreaterThan(0);
      // No empty-string values.
      for (const v of Object.values(node)) expect(v).not.toBe("");
    }
  });

  it("includes a loan term only when the program has one", () => {
    const hud = loanOrCreditSchema(getFinancingPage("hud-232")!.entry as (typeof programs)[number]) as Record<string, unknown>;
    expect((hud.loanTerm as Record<string, unknown>).value).toBe(35);
    const cpace = loanOrCreditSchema(getFinancingPage("c-pace")!.entry as (typeof programs)[number]) as Record<string, unknown>;
    expect(cpace.loanTerm).toBeUndefined();
  });

  it("FAQ schema mirrors the visible FAQ", () => {
    const p = programs.find((x) => x.slug === "sba-504-hotel")!;
    const faq = programJsonLd(p)[1] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(p.faq.map((q) => q.question));
    expect(faq.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(p.faq.map((q) => q.answer));
  });

  it("breadcrumbs run Home > Financing > hub > program, skipping the hub when the page is the hub", () => {
    const rcfe = programBreadcrumbs(programs.find((p) => p.slug === "rcfe")!);
    expect(rcfe.map((b) => b.path)).toEqual(["/", "/financing", "/financing/senior-living", "/financing/rcfe"]);
    const hard = programBreadcrumbs(programs.find((p) => p.slug === "hard-money")!);
    expect(hard.map((b) => b.path)).toEqual(["/", "/financing", "/financing/hard-money"]);
  });

  it("hub ItemList lists the family programs in order", () => {
    const hub = hubs.find((h) => h.slug === "hotels")!;
    const collection = hubJsonLd(hub)[0] as { mainEntity: { itemListElement: { position: number; name: string }[] } };
    const names = collection.mainEntity.itemListElement.map((i) => i.name);
    expect(names).toContain("SBA 504 hotel loans");
    expect(collection.mainEntity.itemListElement.map((i) => i.position)).toEqual(names.map((_, i) => i + 1));
  });

  it("escapes markup in serialized JSON-LD", () => {
    expect(serializeJsonLd({ "@context": "https://schema.org", name: "</script><b>" })).not.toContain("</script>");
  });
});

describe("page metadata", () => {
  it("gives each page a self-referencing canonical", () => {
    for (const slug of financingSlugs) {
      const e = getFinancingPage(slug)!.entry;
      const md = pageMetadata({ title: e.title, description: e.description, path: financingPath(slug) });
      expect(md.alternates?.canonical).toBe(`https://corincommercial.com/financing/${slug}`);
      expect(md.openGraph?.url).toBe(`https://corincommercial.com/financing/${slug}`);
    }
  });
});
