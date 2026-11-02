import type { SitemapRoute } from "@/lib/seo/sitemap-routes";
import { constructionPrograms } from "./construction";
import { hardMoneyPrograms } from "./hard-money";
import { hotelPrograms } from "./hotels";
import { hubs } from "./hubs";
import { multifamilyPrograms } from "./multifamily";
import { seniorLivingPrograms } from "./senior-living";
import type { FinancingPage, HubEntry, ProgramEntry, ProgramFamily } from "./types";

export * from "./types";

export const FINANCING_BASE = "/financing";

export const programs: ProgramEntry[] = [
  ...seniorLivingPrograms,
  ...hotelPrograms,
  ...multifamilyPrograms,
  ...constructionPrograms,
  ...hardMoneyPrograms,
];

export { hubs };

const pages = new Map<string, FinancingPage>();
for (const entry of programs) pages.set(entry.slug, { kind: "program", entry });
for (const entry of hubs) pages.set(entry.slug, { kind: "hub", entry });

/** Every slug served under /financing, programs first. Used by `generateStaticParams` and the sitemap. */
export const financingSlugs: string[] = [...pages.keys()];

export function financingPath(slug: string): string {
  return `${FINANCING_BASE}/${slug}`;
}

export function getFinancingPage(slug: string): FinancingPage | undefined {
  return pages.get(slug);
}

export function programsInFamily(family: ProgramFamily): ProgramEntry[] {
  return programs.filter((p) => p.family === family);
}

/** The page that acts as a family's hub: a hub entry, or a program flagged `isHub`. */
export function hubForFamily(family: ProgramFamily): { slug: string; name: string; summary: string } {
  const hub: HubEntry | undefined = hubs.find((h) => h.family === family);
  if (hub) return hub;
  const program = programs.find((p) => p.family === family && p.isHub);
  if (!program) throw new Error(`No hub page for family ${family}`);
  return program;
}

/** Name and one-line summary for any page, for cards and link lists. */
export function pageCard(slug: string): { slug: string; name: string; summary: string; href: string } | undefined {
  const page = pages.get(slug);
  if (!page) return undefined;
  return { slug, name: page.entry.name, summary: page.entry.summary, href: financingPath(slug) };
}

/**
 * Sitemap entries for the financing pages. `lib/seo/sitemap-routes.ts` appends
 * this list, which also feeds `llms.txt`.
 */
export const programRoutes: SitemapRoute[] = [
  {
    path: FINANCING_BASE,
    title: "Financing programs",
    description: "Every loan program Kubera Commercial arranges, grouped by senior living, hotels, multifamily, construction and hard money.",
    changeFrequency: "monthly",
    priority: 0.8,
    section: "Programs",
  },
  ...hubs.map(
    (h): SitemapRoute => ({
      path: financingPath(h.slug),
      title: h.name,
      description: h.summary,
      changeFrequency: "monthly",
      priority: 0.8,
      section: "Programs",
    }),
  ),
  ...programs.map(
    (p): SitemapRoute => ({
      path: financingPath(p.slug),
      title: p.name,
      description: p.summary,
      changeFrequency: "monthly",
      priority: p.isHub ? 0.8 : 0.7,
      section: "Programs",
    }),
  ),
];
