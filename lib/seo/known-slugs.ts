// Slug allowlists for the dynamic public routes, checked in `proxy.ts`.
//
// With cacheComponents a request for a `[slug]` that `generateStaticParams`
// did not list streams the static shell before `notFound()` runs, so the first
// hit would answer 200 (a soft 404) and every random slug would add an ISR
// cache entry. Answering 404 here, before rendering, fixes both. The lists are
// the same ones that feed `generateStaticParams` and the sitemap.

import { CALCULATORS } from "@/content/calculators";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import { INSIGHTS } from "@/content/insights/articles";
import { MARKETS } from "@/content/markets/california";
import { financingSlugs } from "@/content/programs";

const SLUGS_BY_PREFIX: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["/financing", new Set(financingSlugs)],
  ["/insights", new Set(INSIGHTS.map((i) => i.slug))],
  ["/structures", new Set(DEAL_STRUCTURES.map((s) => s.slug))],
  ["/calculators", new Set(CALCULATORS.map((c) => c.slug))],
  ["/california", new Set(MARKETS.map((m) => m.slug))],
]);

/**
 * True when `pathname` is `<prefix>/<slug>` for one of the dynamic public
 * routes and the slug is not one we serve. Anything else (the index pages,
 * other routes, deeper paths) is left to Next.
 */
export function isUnknownSlugPath(pathname: string): boolean {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const parts = trimmed.split("/");
  // ["", prefix, slug]
  if (parts.length !== 3) return false;
  const slugs = SLUGS_BY_PREFIX.get(`/${parts[1]}`);
  if (!slugs) return false;
  let slug = parts[2]!;
  try {
    slug = decodeURIComponent(slug);
  } catch {
    return true; // malformed escape: never a real slug
  }
  return !slugs.has(slug);
}
