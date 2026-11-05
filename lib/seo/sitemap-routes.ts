// Single list of indexable pages, used by `app/sitemap.ts` and `app/llms.txt`.
// Other workstreams add their pages by appending a source below (programs,
// trust pages, insights, ...). Titles and descriptions feed llms.txt.

import { calculatorRoutes } from "@/content/calculators";
import { glossaryRoutes } from "@/content/glossary";
import { insightRoutes } from "@/content/insights";
import { marketRoutes } from "@/content/markets/california";
import { newsletterRoutes } from "@/content/newsletter";
import { programRoutes } from "@/content/programs";
import { ratesRoutes } from "@/content/rates";
import { trustRoutes } from "@/content/trust-pages";
import { contentUpdated } from "./content-dates";
import { canonicalUrl } from "./hosts";

export type SitemapSection = "Tools" | "Programs" | "Company" | "Legal" | "Resources";

export interface SitemapRoute {
  path: string;
  title: string;
  description?: string;
  changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
  /** ISO date; omit when unknown rather than guessing. */
  lastModified?: string;
  /** Section heading used by llms.txt. */
  section?: SitemapSection;
}

export const coreRoutes: SitemapRoute[] = [
  {
    path: "/",
    title: "Corin Commercial home",
    description: "Licensed California commercial real estate loan broker for senior living, hotels, multifamily, construction and hard money.",
    changeFrequency: "weekly",
    priority: 1,
    section: "Tools",
  },
  {
    path: "/express",
    title: "60-second deal qualifier",
    description: "Answer a few questions about your deal; a licensed advisor reviews the programs that may fit.",
    changeFrequency: "monthly",
    priority: 0.8,
    section: "Tools",
  },
  {
    path: "/partners",
    title: "Partner portal",
    description: "Register as a wholesale lender, referral broker, operator or third-party vendor.",
    changeFrequency: "monthly",
    priority: 0.6,
    section: "Company",
  },
];

// Legal pages are built by the compliance workstream under `app/(site)/(legal)/`.
export const legalRoutes: SitemapRoute[] = [
  { path: "/privacy", title: "Privacy policy", description: "What personal information Corin Commercial collects, how it is used and shared, and how to use California privacy rights.", changeFrequency: "yearly", priority: 0.3, section: "Legal" },
  { path: "/terms", title: "Terms of use", description: "The terms for using the website, loan sizer, deal qualifier, document vault and partner portal.", changeFrequency: "yearly", priority: 0.3, section: "Legal" },
  { path: "/licensing", title: "Licensing and disclosures", description: "California DRE broker licenses, how Corin is paid, and the Mortgage Loan Disclosure Statement on loans secured by real property.", changeFrequency: "yearly", priority: 0.4, section: "Legal" },
  { path: "/accessibility", title: "Accessibility statement", description: "WCAG 2.2 AA commitment, what is tested, known limitations and how to report a problem.", changeFrequency: "yearly", priority: 0.3, section: "Legal" },
];

/**
 * Add content workstreams here, e.g. `programRoutes` from `content/programs`.
 * Each source is a plain array so the sitemap stays a static, build-time file.
 */
export const sitemapSources: SitemapRoute[][] = [
  coreRoutes,
  programRoutes,
  trustRoutes,
  // Growth pages (WS-P): insights, rates, calculators, glossary, California metro guides, newsletter signup.
  insightRoutes,
  ratesRoutes,
  calculatorRoutes,
  glossaryRoutes,
  marketRoutes,
  newsletterRoutes,
  legalRoutes,
];

/**
 * Flattens the sources, normalizes trailing slashes and drops duplicate paths.
 * A route without its own `lastModified` takes its section's content date
 * (lib/seo/content-dates.ts); the insights index takes its newest article's.
 */
export function allSitemapRoutes(sources: SitemapRoute[][] = sitemapSources): SitemapRoute[] {
  const seen = new Set<string>();
  const out: SitemapRoute[] = [];
  for (const route of sources.flat()) {
    const path = route.path === "/" ? "/" : route.path.replace(/\/+$/, "");
    if (seen.has(path)) continue;
    seen.add(path);
    const lastModified = route.lastModified ?? contentUpdated(path);
    out.push({ ...route, path, ...(lastModified ? { lastModified } : {}) });
  }
  return out;
}

export function toSitemap(routes: SitemapRoute[] = allSitemapRoutes()) {
  return routes.map((r) => ({
    url: canonicalUrl(r.path),
    ...(r.lastModified ? { lastModified: r.lastModified } : {}),
    ...(r.changeFrequency ? { changeFrequency: r.changeFrequency } : {}),
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
  }));
}
