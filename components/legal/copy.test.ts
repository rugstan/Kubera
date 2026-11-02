import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_PAGES } from "./legal";

// Copy guard for the public site. Scans the marketing, express, partner, and
// legal sources for claims Global rule 4 forbids, and checks that every form
// that collects personal information renders the notice at collection.

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const list = (dir: string, except: string[] = []) =>
  readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx") && !except.includes(f))
    .map((f) => `${dir}/${f}`);
/** Every .ts and .tsx source under a directory, tests excluded. */
const walk = (dir: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });

const COPY_FILES = [
  ...list("components/home", ["Reveal.tsx"]),
  ...list("components/site"),
  ...list("components/express"),
  ...list("components/partners"),
  ...list("components/legal"),
  "app/(site)/page.tsx",
  "app/(site)/(legal)/privacy/page.tsx",
  "app/(site)/(legal)/terms/page.tsx",
  "app/(site)/(legal)/licensing/page.tsx",
  "app/(site)/(legal)/accessibility/page.tsx",
];

// Trust pages (/about, /team, /contact, /track-record, /structures) and their components.
const TRUST_FILES = [
  "app/(site)/about/page.tsx",
  "app/(site)/team/page.tsx",
  "app/(site)/contact/page.tsx",
  "app/(site)/track-record/page.tsx",
  "app/(site)/structures/page.tsx",
  ...list("app/(site)/structures/[slug]"),
  ...list("components/trust"),
];

const FORBIDDEN: [RegExp, string][] = [
  [/\bautonomous\b/i, "positioning is advisor-led"],
  [/\b(?:you(?:'|&apos;)?re|you are|is|are|been|get|getting)\s+(?:pre-?)?approved\b/i, "no approval claims"],
  [/\bpre-?approved\b/i, "no approval claims"],
  [/\bqualified for\b/i, "no 'qualified for' claims"],
  [/\bfees?\s+(?:are\s+)?protected\b/i, "no 'fees protected' claims"],
  [/\bfee protection\b/i, "no 'fees protected' claims"],
  [/\bwill call you today\b/i, "no same-day call promises"],
  [/\bguaranteed? (?:closing|approval|rate|terms?)\b/i, "no guarantees"],
  [/\b(?:loan|it) is (?:usury[- ])?exempt\b/i, "never state a specific loan is usury-exempt"],
];

// Everything a visitor can read or a crawler can fetch must stay free of AI
// wording and of the names of internal automation; the assistant and the
// scoring and routing tools are staff-side operations. This list is separate
// from COPY_FILES on purpose: those files are also held to the CTA and timeline
// rules. Every public page, every content file and every component directory a
// public page renders is scanned whole, so a new article, glossary entry or
// market page is covered without being listed. Identifiers such as AiUseNotice
// or AI_NOTICE_HREF are not copy, and no pattern matches them. Staff screens
// (app/(staff)) are intentionally not scanned.
const PUBLIC_COMPONENT_DIRS = [
  "home",
  "site",
  "express",
  "partners",
  "legal",
  "privacy",
  "insights",
  "calculators",
  "markets",
  "rates",
  "program",
  "ticker",
  "trust",
  "newsletter",
  "sizer",
  "seo",
  "forms",
];
const NO_AI_FILES = [
  ...COPY_FILES,
  ...TRUST_FILES,
  ...walk("app/(site)"),
  ...walk("app/express"),
  ...walk("content"),
  ...PUBLIC_COMPONENT_DIRS.flatMap((d) => walk(`components/${d}`)),
  "app/opengraph-image.tsx",
  "app/manifest.ts",
  "app/layout.tsx",
  "app/not-found.tsx",
  "app/llms.txt/route.ts",
  "lib/seo/llms.ts",
  "lib/seo/sitemap-routes.ts",
  "lib/site.ts",
];
const NO_AI: [RegExp, string][] = [
  [/\bAI\b/, "no 'AI' on public surfaces"],
  [/Kubera AI|AI-assisted|artificial intelligence|machine learning|chatbot|⌘K/i, "no assistant, chatbot or shortcut wording"],
  [/\bJev\b/, "no internal system names"],
  [/routing engine|rules engine|scoring (?:engine|model)|lead scor/i, "no internal automation wording"],
];

// A closing timeline like "10–21 days" must be conditional in the same file.
const TIMELINE = /\b\d+\s*[–-]\s*\d+\s+(?:days|business days)\b|~\s*60\s*(?:d|days)\b/i;

describe("copy guard", () => {
  it.each(COPY_FILES)("%s contains no forbidden claims", (file) => {
    const src = read(file);
    for (const [re, why] of FORBIDDEN) expect(src, `${file}: ${why} (${re})`).not.toMatch(re);
  });

  it.each(COPY_FILES)("%s states closing timelines conditionally", (file) => {
    const src = read(file);
    if (!TIMELINE.test(src)) return;
    expect(src, `${file} mentions a timeline without "not guaranteed"`).toMatch(/not guaranteed|disclosures\.timeline/);
  });

  it.each([...new Set(NO_AI_FILES)])("%s mentions no AI", (file) => {
    const src = read(file);
    for (const [re, why] of NO_AI) expect(src, `${file}: ${why} (${re})`).not.toMatch(re);
  });

  it("scans every public page, content file and the partner hero", () => {
    const files = new Set(NO_AI_FILES);
    for (const f of ["app/(site)/partners/page.tsx", "app/(site)/glossary/page.tsx", "content/glossary.ts", "content/insights/articles.ts", "content/markets/california.ts", "content/deal-structures.ts", "components/site/nav.ts"]) {
      expect(files.has(f), f).toBe(true);
    }
    // The guard itself catches the wording that slipped through before.
    const hit = (text: string) => NO_AI.some(([re]) => re.test(text));
    expect(hit("feeds Jev, our routing engine")).toBe(true);
    expect(hit("Kubera rent-control rules engine")).toBe(true);
    expect(hit("const AI_NOTICE_HREF = x; <AiUseNotice />")).toBe(false);
  });

  it("uses sentence case on primary CTAs", () => {
    const ctas = [...COPY_FILES.map(read).join("\n").matchAll(/className="pill[^"]*"[^>]*>\s*([^<{]+?)\s*</g)].map((m) => m[1]!.trim());
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      const words = cta.split(/\s+/).slice(1).filter((w) => /^[A-Za-z]/.test(w));
      // Proper nouns and acronyms are allowed; capitalized common words are not.
      const offenders = words.filter((w) => /^[A-Z][a-z]+$/.test(w) && !["Kubera", "HUD", "SBA"].includes(w));
      expect(offenders, `CTA "${cta}"`).toEqual([]);
    }
  });

  it("keeps the license placeholder behind the production guard", () => {
    // Only the corporate license is guaranteed by the build guard, so these may
    // show a placeholder for it; nothing else may render "pending configuration".
    const allowed = new Set(["lib/site.ts", "app/(site)/(legal)/licensing/page.tsx", "components/trust/LicenseId.tsx"]);
    for (const file of [...COPY_FILES, ...TRUST_FILES, "app/express/page.tsx", "lib/site.ts"]) {
      if (/pending configuration/i.test(read(file))) expect(allowed.has(file), file).toBe(true);
    }
    expect(read("lib/site.ts")).toMatch(/if \(typeof window === "undefined"\) assertLicenseConfigured\(\);/);
    // The officer license is optional in production, so it renders only when set.
    for (const file of TRUST_FILES) {
      const src = read(file);
      if (src.includes("<LicenseId id={site.dreOfficerLicense}")) expect(src, file).toMatch(/\{site\.dreOfficerLicense && \(/);
    }
  });
});

describe("notice at collection placement", () => {
  it.each([
    ["components/express/Qualifier.tsx", "qualifier"],
    ["components/express/DocumentUpload.tsx", "upload"],
    ["components/partners/PartnerPortal.tsx", "partner"],
    ["components/privacy/PrivacyRequestForm.tsx", "privacy_request"],
  ])("%s renders the %s notice", (file, point) => {
    const src = read(file);
    expect(src).toContain('from "@/components/legal/NoticeAtCollection"');
    expect(src).toContain(`<NoticeAtCollection point="${point}" />`);
  });

  it("places the qualifier notice on the contact step, which renders only on the last step", () => {
    const src = read("components/express/Qualifier.tsx");
    const contactStep = src.slice(src.indexOf("function ContactStep("));
    expect(contactStep).toContain('<NoticeAtCollection point="qualifier" />');
    expect(src).toContain("{step === 3 && <ContactStep");
    // The submit button belongs to the last step only.
    expect(src).toMatch(/step === 3 \? \(\s*<button[^>]*type="submit"/);
  });

  it("places the partner notice before the submit button", () => {
    const src = read("components/partners/PartnerPortal.tsx");
    expect(src.indexOf('<NoticeAtCollection point="partner" />')).toBeLessThan(src.indexOf('type="submit"'));
  });

  it("places the privacy request notice before the submit button", () => {
    const src = read("components/privacy/PrivacyRequestForm.tsx");
    expect(src.indexOf('<NoticeAtCollection point="privacy_request" />')).toBeGreaterThan(src.indexOf('id={fid("email")}'));
    expect(src.indexOf('<NoticeAtCollection point="privacy_request" />')).toBeLessThan(src.indexOf('type="submit"'));
  });

  it("places the upload notice before the file input", () => {
    const src = read("components/express/DocumentUpload.tsx");
    expect(src.indexOf('<NoticeAtCollection point="upload" />')).toBeLessThan(src.indexOf('type="file"'));
  });
});

describe("footer", () => {
  it("links every legal page", () => {
    const src = read("components/site/Footer.tsx");
    expect(src).toContain("LEGAL_PAGES");
    expect(LEGAL_PAGES.map((p) => p.href)).toEqual(
      expect.arrayContaining(["/privacy", "/privacy#notice-at-collection", "/terms", "/licensing", "/accessibility"]),
    );
  });
});
