import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccessibilityPage from "@/app/(site)/(legal)/accessibility/page";
import LicensingPage from "@/app/(site)/(legal)/licensing/page";
import PrivacyPage from "@/app/(site)/(legal)/privacy/page";
import TermsPage from "@/app/(site)/(legal)/terms/page";
import { DraftNotice } from "./DraftNotice";
import { categoriesSentence, categoryById, COLLECTION_POINTS, LEGAL_PAGES, legalApproved, PI_CATEGORIES, PURPOSES, serviceProviders, type CollectionPoint } from "./legal";
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
  const pages = { privacy: PrivacyPage, terms: TermsPage, licensing: LicensingPage, accessibility: AccessibilityPage };
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
    expect(t).toContain("privacy@corincommercial.com");
    expect(t).toContain("We do not sell personal information");
    expect(t).toContain("Global Privacy Control");
    expect(t).toContain("Do Not Track");
    expect(t).toMatch(/10 business days/);
    expect(t).toMatch(/45 calendar days/);
    for (const c of PI_CATEGORIES) expect(t).toContain(c.retention);
  });

  it("privacy policy keeps the automated-tools disclosures and hosts the request form", () => {
    const t = text(rendered.privacy);
    expect(rendered.privacy).toContain('id="automated-tools"');
    expect(rendered.privacy).toContain('id="request"');
    expect(rendered.privacy).toContain('href="#request"');
    // The request form and its notice at collection sit on the policy page itself.
    expect(rendered.privacy).toContain('data-notice-at-collection="privacy_request"');
    expect(t).toContain("Advisor-only handling");
    expect(t).toContain("No automated tool makes a credit decision. Lenders make all credit decisions.");
    expect(t).toContain("we remove Social Security numbers, dates of birth, and bank, card, and account numbers, or we do not send it");
    expect(t).toContain("Make a request online");
    // The retired Ask feature stays disclosed through its retention window, and its provider stays listed.
    expect(t).toContain("former Ask feature");
    expect(t).toContain("Anthropic: Automated document reading, call summaries, email sorting, and drafting tools used by our advisors");
  });

  it("scopes the automated-sending statement to what the code does", () => {
    const t = text(rendered.privacy);
    // Speed-to-lead texts, confirmations and checklist reminders go out automatically from
    // pre-approved templates (lib/agents/outreach), so an unscoped "nothing is sent" is false.
    expect(t).not.toMatch(/Nothing is sent to you, a lender, or anyone else without an advisor/);
    expect(t).not.toMatch(/nothing goes to (?:a lender or to you|you or a lender) without/i);
    expect(t).toContain("use fixed templates a licensed broker approved in advance");
    expect(t).toMatch(/Nothing goes to a lender without an advisor[’']s approval\./);
    // Call summaries (lib/agents/crm/call-notes.ts) and consent-only artificial-voice calls are listed.
    expect(t).toContain("summarize call recordings and call notes for an advisor");
    expect(t).toContain("only if you have given separate consent to those calls");
    expect(PURPOSES.some((p) => /summaries of calls/.test(p))).toBe(true);
  });

  it("the About page makes no unscoped promise that nothing reaches the borrower without review", async () => {
    const { default: AboutPage } = await import("@/app/(site)/about/page");
    const t = text(html(createElement(AboutPage)));
    expect(t).not.toMatch(/nothing goes to a lender or to you without/i);
    expect(t).toContain("Automatic confirmations and reminders use templates a broker approved in advance");
  });

  it("no legal page mentions AI or a separate AI-use page", () => {
    for (const markup of Object.values(rendered)) {
      expect(text(markup)).not.toMatch(/\bAI\b|Corin AI|AI-assisted/);
      expect(markup).not.toContain("/privacy/ai");
    }
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
    expect(t).toMatch(/deals@corincommercial\.com/);
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
    expect((m.twitter as { images?: { url: string }[] }).images?.[0]).toMatchObject({ url: "/opengraph-image" });
    expect((m.openGraph as { title?: string }).title).toBe("Terms of use · Corin Commercial");
  });
});

describe("service providers", () => {
  const names = (env: Record<string, string | undefined>) => serviceProviders(env).map((p) => p.name);

  it("names only the core providers when no optional integration is switched on", () => {
    expect(names({})).toEqual(["Contabo", "Twenty", "Anthropic", "Zoho", "Telnyx", "Cloudflare", "Sentry"]);
  });

  it("names Cloudflare for email and Zoho for signatures only", () => {
    const roles = Object.fromEntries(serviceProviders({}).map((p) => [p.name, p.role]));
    expect(roles.Cloudflare).toMatch(/bot protection/i);
    expect(roles.Cloudflare).toMatch(/business email/i);
    expect(roles.Cloudflare).toMatch(/transactional email/i);
    expect(roles.Zoho).toBe("Electronic signatures");
  });

  it("adds Vercel only on a Vercel-hosted deployment", () => {
    expect(names({ VERCEL: "1" })).toContain("Vercel");
    expect(names({ VERCEL: "" })).not.toContain("Vercel");
  });

  it("adds Supabase only when the database is on Supabase's hosted platform, not self-hosted", () => {
    expect(names({ SUPABASE_URL: "https://abcdefghijkl.supabase.co" })).toContain("Supabase");
    expect(names({ SUPABASE_URL: "https://db.corincommercial.com" })).not.toContain("Supabase");
    expect(names({ SUPABASE_URL: "http://127.0.0.1:8000" })).not.toContain("Supabase");
    expect(names({ SUPABASE_URL: "not a url" })).not.toContain("Supabase");
  });

  it("adds Resend only when RESEND_API_KEY is set", () => {
    expect(names({ RESEND_API_KEY: "re_k" })).toContain("Resend");
    expect(names({ RESEND_API_KEY: " " })).not.toContain("Resend");
  });

  it("adds NVIDIA when document extraction or NVIDIA-hosted models are configured", () => {
    expect(names({ NVIDIA_NEMO_RETRIEVER_URL: "https://nim.example" })).toContain("NVIDIA");
    expect(names({ NVIDIA_API_KEY: "k" })).toContain("NVIDIA");
    expect(names({ NVIDIA_API_KEY: "  " })).not.toContain("NVIDIA");
  });

  it("adds Voyage when it receives search queries, and not when embeddings are off", () => {
    expect(names({ VOYAGE_API_KEY: "k" })).toContain("Voyage (MongoDB)");
    expect(names({ VOYAGE_API_KEY: "k", EMBEDDINGS_PROVIDER: "off" })).not.toContain("Voyage (MongoDB)");
  });

  it("never lists a provider twice and keeps the public copy free of AI wording", () => {
    const all = serviceProviders({ NVIDIA_API_KEY: "k", NVIDIA_NEMO_RETRIEVER_URL: "u", VOYAGE_API_KEY: "k", VERCEL: "1", SUPABASE_URL: "https://x.supabase.co", RESEND_API_KEY: "k" });
    expect(new Set(all.map((p) => p.name)).size).toBe(all.length);
    for (const p of all) expect(`${p.name} ${p.role}`).not.toMatch(/\bAI\b/);
  });
});
