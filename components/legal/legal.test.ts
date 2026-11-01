import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccessibilityPage from "@/app/(site)/(legal)/accessibility/page";
import LicensingPage from "@/app/(site)/(legal)/licensing/page";
import PrivacyAiPage from "@/app/(site)/(legal)/privacy/ai/page";
import PrivacyPage from "@/app/(site)/(legal)/privacy/page";
import TermsPage from "@/app/(site)/(legal)/terms/page";
import { DraftNotice } from "./DraftNotice";
import { categoriesSentence, categoryById, COLLECTION_POINTS, LEGAL_PAGES, legalApproved, PI_CATEGORIES, type CollectionPoint } from "./legal";
import { canonicalUrl } from "@/lib/seo/hosts";
import { legalMetadata } from "./metadata";
import { NoticeAtCollection } from "./NoticeAtCollection";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("legalApproved", () => {
  it("is true only for the exact string 'true'", () => {
    expect(legalApproved({ NEXT_PUBLIC_LEGAL_APPROVED: "true" })).toBe(true);
    for (const v of [undefined, "", "TRUE", "1", "yes", "false"]) expect(legalApproved({ NEXT_PUBLIC_LEGAL_APPROVED: v })).toBe(false);
  });
});

describe("DraftNotice", () => {
  it("shows the counsel-review banner until approved", () => {
    expect(text(html(createElement(DraftNotice, { approved: false })))).toContain("DRAFT — pending counsel review");
    expect(html(createElement(DraftNotice, { approved: true }))).toBe("");
  });
});

describe("personal information categories", () => {
  it("has unique ids and a retention period for every category", () => {
    const ids = PI_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of PI_CATEGORIES) {
      expect(c.retention.length).toBeGreaterThan(10);
      expect(c.examples.length).toBeGreaterThan(10);
    }
  });

  it("marks uploaded financial documents as sensitive", () => {
    expect(categoryById("financial_documents").sensitive).toBe(true);
  });

  it("covers every category a collection point names", () => {
    for (const point of Object.keys(COLLECTION_POINTS) as CollectionPoint[]) {
      for (const id of COLLECTION_POINTS[point].categories) expect(() => categoryById(id)).not.toThrow();
    }
  });

  it("builds a readable category sentence", () => {
    expect(categoriesSentence("upload")).toBe("financial documents, loan request and property details, and device and usage data");
  });
});

describe("NoticeAtCollection", () => {
  it.each(["qualifier", "partner", "upload", "privacy_request", "newsletter"] as const)("renders the %s notice with the required elements", (point) => {
    const markup = html(createElement(NoticeAtCollection, { point }));
    const t = text(markup);
    expect(markup).toContain(`data-notice-at-collection="${point}"`);
    expect(t).toContain("Notice at collection.");
    expect(t).toContain(categoriesSentence(point));
    expect(t).toContain(COLLECTION_POINTS[point].purpose);
    expect(t).toContain("We do not sell your personal information");
    expect(markup).toContain('href="/privacy#notice-at-collection"');
    expect(markup).toContain('href="/privacy#retention"');
  });

  it("states the privacy request retention period instead of the general one", () => {
    const t = text(html(createElement(NoticeAtCollection, { point: "privacy_request" })));
    expect(t).toContain("We collect identifiers and contact and customer records to verify your identity");
    expect(t).toContain("we use it only for that purpose");
    expect(t).toContain("which for privacy requests is 24 months after we close the request");
    expect(t).not.toContain("three years");
    expect(text(html(createElement(NoticeAtCollection, { point: "qualifier" })))).toContain("generally three years after our last contact");
  });

  it("flags sensitive information only on the upload notice", () => {
    expect(text(html(createElement(NoticeAtCollection, { point: "upload" })))).toContain("sensitive personal information");
    expect(text(html(createElement(NoticeAtCollection, { point: "qualifier" })))).not.toContain("sensitive personal information");
  });
});

describe("legal pages", () => {
  const pages = { privacy: PrivacyPage, "privacy/ai": PrivacyAiPage, terms: TermsPage, licensing: LicensingPage, accessibility: AccessibilityPage };
  const rendered = Object.fromEntries(Object.entries(pages).map(([k, P]) => [k, html(createElement(P))])) as Record<keyof typeof pages, string>;

  it("every page shows the draft banner while NEXT_PUBLIC_LEGAL_APPROVED is unset", () => {
    for (const markup of Object.values(rendered)) expect(text(markup)).toContain("DRAFT — pending counsel review");
  });

  it("every footer legal link resolves to a rendered page and anchor", () => {
    for (const { href } of LEGAL_PAGES) {
      const [path, anchor] = href.split("#");
      const markup = rendered[path!.slice(1) as keyof typeof pages];
      expect(markup, href).toBeDefined();
      if (anchor) expect(markup).toContain(`id="${anchor}"`);
    }
  });

  it("privacy policy covers CalOPPA and CCPA essentials", () => {
    const t = text(rendered.privacy);
    for (const id of ["notice-at-collection", "retention", "rights", "requests", "signals", "sharing", "changes", "contact"]) expect(rendered.privacy).toContain(`id="${id}"`);
    expect(t).toContain("privacy@kuberacommercial.com");
    expect(t).toContain("We do not sell personal information");
    expect(t).toContain("Global Privacy Control");
    expect(t).toContain("Do Not Track");
    expect(t).toMatch(/10 business days/);
    expect(t).toMatch(/45 calendar days/);
    for (const c of PI_CATEGORIES) expect(t).toContain(c.retention);
  });

  it("licensing page states broker-not-lender, the MLDS, and compensation", () => {
    const t = text(rendered.licensing);
    expect(t).toContain("We are not a lender");
    expect(t).toContain("lender of record");
    expect(t).toContain("RE 882");
    expect(t).toContain("three business days");
    expect(t).toContain("including anything the lender pays us");
    expect(t).toContain("Real estate broker, California Department of Real Estate");
    expect(t).toMatch(/no role in construction draws/);
  });

  it("never states that a specific loan is usury-exempt", () => {
    for (const markup of Object.values(rendered)) {
      expect(text(markup)).not.toMatch(/(?:your|this) loan is (?:usury[- ])?exempt/i);
      expect(text(markup)).not.toMatch(/\bis exempt from (?:California )?usury\b/i);
    }
  });

  it("terms make clear nothing is an approval and timelines are not guaranteed", () => {
    const t = text(rendered.terms);
    expect(t).toContain("Nothing on the sites is an offer to lend, a loan approval, a commitment, or a rate lock");
    expect(t).toContain("They are not guaranteed.");
  });

  it("accessibility statement names the standard and a feedback channel", () => {
    const t = text(rendered.accessibility);
    expect(t).toContain("WCAG");
    expect(t).toContain("2.2");
    expect(t).toMatch(/deals@kuberacommercial\.com/);
  });
});

describe("legalMetadata", () => {
  it("sets one canonical and a per-route Open Graph URL", () => {
    const m = legalMetadata("/privacy", "Privacy policy", "desc");
    expect(m.alternates?.canonical).toBe(canonicalUrl("/privacy"));
    expect(m.openGraph?.url).toBe(canonicalUrl("/privacy"));
  });

  it("attaches the share image, a large Twitter card and the branded title", () => {
    const m = legalMetadata("/terms", "Terms of use", "desc");
    const images = (m.openGraph as { images?: { url: string; width: number; height: number }[] }).images;
    expect(images).toHaveLength(1);
    expect(images?.[0]).toMatchObject({ url: "/opengraph-image", width: 1200, height: 630 });
    expect((m.twitter as { card?: string }).card).toBe("summary_large_image");
    expect((m.twitter as { images?: string[] }).images).toEqual(["/opengraph-image"]);
    expect((m.openGraph as { title?: string }).title).toBe("Terms of use · Kubera Commercial");
  });
});
