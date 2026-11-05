import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import AboutPage from "@/app/(site)/about/page";
import ContactPage from "@/app/(site)/contact/page";
import StructurePage, { generateMetadata, generateStaticParams } from "@/app/(site)/structures/[slug]/page";
import StructuresPage from "@/app/(site)/structures/page";
import TeamPage from "@/app/(site)/team/page";
import TrackRecordPage from "@/app/(site)/track-record/page";
import { disclosures } from "@/lib/site";
import { teamPageSchemas, trackRecordSchemas } from "./schemas";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) => markup.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const jsonLd = (markup: string) =>
  [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const parsed = JSON.parse(m[1]!.replace(/\\u003c/g, "<")) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  }) as Record<string, unknown>[];

// Rules every trust page must follow (Global rule 4).
const FORBIDDEN: [RegExp, string][] = [
  [/\bautonomous\b/i, "autonomous"],
  [/\b(?:you(?:'|&apos;)?re|you are|is|are|been|get|getting)\s+(?:pre-?)?approved\b/i, "approval claim"],
  [/\bpre-?approved\b/i, "pre-approved"],
  [/\bqualified for\b/i, "qualified for"],
  [/\bfees?\s+(?:are\s+)?protected\b/i, "fees protected"],
  [/\bwill call you today\b/i, "same-day call"],
  [/\bguaranteed? (?:closing|approval|rate|terms?)\b/i, "guarantee"],
  [/\b(?:loan|it) is (?:usury[- ])?exempt\b/i, "usury exemption claim"],
  [/\b(?:lender|originator) of record is corin|corin (?:is|acts as) the lender\b/i, "Corin as lender"],
];

describe("trust pages render", () => {
  const pages: [string, () => ReactElement][] = [
    ["about", () => createElement(AboutPage)],
    ["team", () => createElement(TeamPage)],
    ["contact", () => createElement(ContactPage)],
    ["track-record", () => createElement(TrackRecordPage)],
    ["structures", () => createElement(StructuresPage)],
  ];

  it.each(pages)("%s has one h1, a license line and no forbidden claims", (_name, render) => {
    const markup = html(render());
    expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
    for (const [re, why] of FORBIDDEN) expect(text(markup), why).not.toMatch(re);
  });

  it("about states broker-not-lender and shows the license facts", () => {
    const t = text(html(createElement(AboutPage)));
    expect(t).toContain("Real estate broker, California Department of Real Estate");
    expect(t).toContain(disclosures.brokerNotLender);
    expect(t).toMatch(/Corporate broker license/);
    expect(t).toMatch(/not guaranteed/i);
    expect(t).toMatch(/disburses loan funds/);
    expect(t).toMatch(/Accept, hold, transfer or disburse/);
  });

  it("contact lists the mailbox routing table and an email fallback for scheduling", () => {
    const markup = html(createElement(ContactPage));
    for (const box of ["deals", "lenders", "partners", "vendors", "compliance"]) expect(markup).toContain(`${box}@corincommercial.com`);
    expect(markup).toContain("<table");
    expect(markup).toMatch(/<caption[^>]*>/);
    // Unconfigured scheduling and phone show an email path, never a "not set up" or "coming soon" placeholder.
    expect(text(markup)).toMatch(/with two or three times that work for you/);
    expect(text(markup)).not.toMatch(/not set up yet|coming soon/i);
    expect(markup).toContain('id="schedule"');
    expect(markup).not.toContain("<iframe");
    // The customer actions use the site-wide wording; partner registration is a quiet text link.
    expect(markup).toMatch(/class="pill pill-primary"[^>]*>Get loan options</);
    expect(markup).not.toMatch(/class="pill[^"]*"[^>]*>Register as a partner</);
    expect(jsonLd(markup).some((n) => n["@type"] === "ContactPage")).toBe(true);
  });

  it("track record ships empty with an honest empty state and a structures link", () => {
    const markup = html(createElement(TrackRecordPage));
    expect(text(markup)).toContain("No closed transactions published yet");
    expect(markup).toContain('href="/structures"');
    expect(markup).not.toMatch(/\$\d/);
    expect(jsonLd(markup).some((n) => n["@type"] === "ItemList")).toBe(false);
  });

  it("team shows the designated officer and no invented advisor", () => {
    const markup = html(createElement(TeamPage));
    expect(text(markup)).toContain("Designated officer");
    expect(text(markup)).toContain("Neeli Khanna");
    // Jsonld only lists people who are public: at most the designated officer, nobody invented.
    const people = jsonLd(markup).filter((n) => n["@type"] === "Person");
    expect(people.length).toBeLessThanOrEqual(1);
    for (const p of people) expect(p.name).toBe("Neeli Khanna");
  });

  it("structures index links every detail page", () => {
    const markup = html(createElement(StructuresPage));
    for (const s of DEAL_STRUCTURES) expect(markup).toContain(`href="/structures/${s.slug}"`);
    expect(text(markup)).toContain(disclosures.illustrative);
  });
});

describe("structure detail pages", () => {
  it("prerenders every slug", async () => {
    const params = generateStaticParams();
    expect(params.map((p) => p.slug)).toEqual(DEAL_STRUCTURES.map((s) => s.slug));
    expect(params.length).toBeGreaterThan(0);
  });

  it.each(DEAL_STRUCTURES.map((s) => [s.slug, s] as const))("%s renders labeled illustrative", async (slug, s) => {
    const markup = html(await StructurePage({ params: Promise.resolve({ slug }) }));
    const t = text(markup);
    expect(markup.match(/<h1[ >]/g)).toHaveLength(1);
    expect(t).toContain("Illustrative example");
    expect(t).toContain(disclosures.illustrative);
    expect(t).toContain(s.amount);
    expect(t).toContain("Real estate broker, California Department of Real Estate");
    expect(t).toContain(disclosures.timeline);
    expect(t).not.toMatch(/closed (a|this|the) /i);
    for (const [re, why] of FORBIDDEN) expect(t, why).not.toMatch(re);
    const crumbs = jsonLd(markup).find((n) => n["@type"] === "BreadcrumbList");
    expect(crumbs).toBeTruthy();
    const meta = await generateMetadata({ params: Promise.resolve({ slug }) });
    expect(meta.alternates?.canonical).toBe(`https://corincommercial.com/structures/${slug}`);
  });

  it("renders a stack table only for the 504 structures", async () => {
    const withStack = await Promise.all(
      DEAL_STRUCTURES.map(async (s) => html(await StructurePage({ params: Promise.resolve({ slug: s.slug }) })).includes("CDC debenture (SBA 504)")),
    );
    expect(withStack).toEqual(DEAL_STRUCTURES.map((s) => Boolean(s.stack)));
    expect(withStack.filter(Boolean)).toHaveLength(2);
  });

  it("returns not-found for an unknown slug", async () => {
    await expect(StructurePage({ params: Promise.resolve({ slug: "made-up" }) })).rejects.toThrow();
    // Metadata throws too, so an unknown slug is a 404 rather than a page with empty metadata.
    await expect(generateMetadata({ params: Promise.resolve({ slug: "made-up" }) })).rejects.toThrow();
  });
});

describe("schemas", () => {
  const member = {
    slug: "a",
    name: "A Person",
    title: "Advisor",
    role: "salesperson" as const,
    licenseId: "01234567",
    bio: "Real bio.",
    focus: [],
  };

  it("emit a Person with a license identifier only for public cards", () => {
    const nodes = teamPageSchemas({ path: "/team", name: "Team", description: "d" }, [
      { member, license: { kind: "verified", id: "01234567", lookupUrl: "x" }, placeholder: false },
    ]);
    const person = nodes.find((n) => n["@type"] === "Person")!;
    expect(person.identifier).toEqual({ "@type": "PropertyValue", propertyID: "California DRE license", value: "01234567" });
    expect(person.worksFor).toEqual({ "@id": "https://corincommercial.com/#organization" });
  });

  it("emit an ItemList only when there are closed records", () => {
    const page = { path: "/track-record", name: "T", description: "d" };
    expect(trackRecordSchemas(page, []).some((n) => n["@type"] === "ItemList")).toBe(false);
    const list = trackRecordSchemas(page, [
      { id: "1", closedYear: 2026, assetType: "Hotel", program: "SBA 504", loanAmountUsd: 5_000_000, location: "CA", summary: "s", clientPermission: true, verifiedOn: "2026-01-01" },
    ]);
    expect(list.some((n) => n["@type"] === "ItemList")).toBe(true);
  });
});

describe("navigation", () => {
  it("footer and header link to every trust page", () => {
    // The footer renders an async cached year, so check its link list from source.
    const src = readFileSync(path.resolve(import.meta.dirname, "../site/Footer.tsx"), "utf8");
    // The header's links live in components/site/nav.ts, shared with the mobile menu.
    const nav = readFileSync(path.resolve(import.meta.dirname, "../site/nav.ts"), "utf8");
    for (const href of ["/about", "/team", "/track-record", "/structures", "/contact"]) expect(src).toContain(`href: "${href}"`);
    for (const href of ["/about", "/contact"]) expect(nav).toContain(`href: "${href}"`);
  });
});

describe("source copy guard", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const files = [
    ...["about", "team", "contact", "track-record", "structures"].map((d) => `app/(site)/${d}/page.tsx`),
    "app/(site)/structures/[slug]/page.tsx",
    ...readdirSync(path.join(root, "components/trust")).filter((f) => f.endsWith(".tsx")).map((f) => `components/trust/${f}`),
  ];

  it.each(files)("%s has no forbidden claims or hard-coded hex colors", (file) => {
    const src = readFileSync(path.join(root, file), "utf8");
    for (const [re, why] of FORBIDDEN) expect(src, why).not.toMatch(re);
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});
