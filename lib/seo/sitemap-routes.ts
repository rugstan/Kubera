// Single list of indexable pages, used by `app/sitemap.ts` and `app/llms.txt`.
// Other workstreams add their pages by appending a source below (programs,
// trust pages, insights, ...). Titles and descriptions feed llms.txt.

import { trustRoutes } from "@/content/trust-pages";
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
    title: "Kubera Commercial home",
    description: "Advisor-led, AI-assisted commercial real estate loan brokerage with a 60-second loan sizer.",
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
  { path: "/privacy", title: "Privacy policy", changeFrequency: "yearly", priority: 0.3, section: "Legal" },
  { path: "/terms", title: "Terms of use", changeFrequency: "yearly", priority: 0.3, section: "Legal" },
  { path: "/licensing", title: "Licensing and disclosures", changeFrequency: "yearly", priority: 0.4, section: "Legal" },
  { path: "/accessibility", title: "Accessibility statement", changeFrequency: "yearly", priority: 0.3, section: "Legal" },
];

/**
 * Add content workstreams here, e.g. `programRoutes` from `content/programs`.
 * Each source is a plain array so the sitemap stays a static, build-time file.
 */
export const sitemapSources: SitemapRoute[][] = [coreRoutes, trustRoutes, legalRoutes];

/** Flattens the sources, normalizes trailing slashes and drops duplicate paths. */
export function allSitemapRoutes(sources: SitemapRoute[][] = sitemapSources): SitemapRoute[] {
  const seen = new Set<string>();
  const out: SitemapRoute[] = [];
  for (const route of sources.flat()) {
    const path = route.path === "/" ? "/" : route.path.replace(/\/+$/, "");
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ ...route, path });
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
