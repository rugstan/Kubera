import { TEAM } from "@/content/team";
import type { SitemapRoute } from "@/lib/seo/sitemap-routes";
import { INSIGHTS, INSIGHTS_BY_SLUG } from "./articles";
import type { Insight } from "./types";

export * from "./types";
export { INSIGHTS };

export const INSIGHTS_BASE = "/insights";

export const INSIGHTS_INDEX = {
  title: "Insights",
  description: "Plain-English analysis of HUD, SBA, CMBS and bridge loans for senior living, hotels and multifamily, plus guides to construction and hard money financing.",
} as const;

export function insightPath(slug: string): string {
  return `${INSIGHTS_BASE}/${slug}`;
}

export function getInsight(slug: string): Insight | undefined {
  return INSIGHTS_BY_SLUG.get(slug);
}

/** Newest first; ties keep the order they are written in. */
export function insightsNewestFirst(): Insight[] {
  return [...INSIGHTS].sort((a, b) => b.published.localeCompare(a.published));
}

/** Every string a reader sees in the article body, used for word counts and copy checks. */
export function insightText(i: Insight): string {
  return [
    i.title,
    i.summary,
    ...i.keyTakeaways,
    ...i.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.bullets ?? [])]),
    ...i.faq.flatMap((q) => [q.question, q.answer]),
  ].join("\n");
}

export function wordCount(i: Insight): number {
  return insightText(i).split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(i: Insight): number {
  return Math.max(1, Math.round(wordCount(i) / 220));
}

/**
 * Byline for every article: the firm's designated officer. The name and title
 * come from content/team.ts, so a change there changes the byline everywhere.
 * The article's markup carries this as a schema.org Person.
 */
export function insightAuthor(): { name: string; jobTitle: string; path: string } {
  const officer = TEAM.find((m) => m.role === "broker");
  if (!officer) throw new Error("content/team.ts has no broker entry for the insights byline");
  return { name: officer.name, jobTitle: officer.title, path: "/team" };
}

/** Articles that share a category with `slug`, then the rest, up to `limit`. */
export function relatedInsights(slug: string, limit = 3): Insight[] {
  const current = getInsight(slug);
  const others = insightsNewestFirst().filter((i) => i.slug !== slug);
  const same = others.filter((i) => current && i.category === current.category);
  return [...same, ...others.filter((i) => !same.includes(i))].slice(0, limit);
}

export const insightRoutes: SitemapRoute[] = [
  {
    path: INSIGHTS_BASE,
    title: INSIGHTS_INDEX.title,
    description: INSIGHTS_INDEX.description,
    changeFrequency: "weekly",
    priority: 0.7,
    section: "Resources",
  },
  ...INSIGHTS.map(
    (i): SitemapRoute => ({
      path: insightPath(i.slug),
      title: i.title,
      description: i.description,
      changeFrequency: "monthly",
      priority: 0.6,
      lastModified: i.updated,
      section: "Resources",
    }),
  ),
];
