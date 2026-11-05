import Link from "next/link";
import { insightPath, insightsLinkingTo } from "@/content/insights";

/**
 * "Related reading": the articles that link to this page. Program, calculator
 * and city pages show it so every article is reachable from the pages it
 * explains, not only from /insights. Renders nothing when no article cites the page.
 */
export function RelatedInsights({ path, className = "mt-14" }: { path: string; className?: string }) {
  const articles = insightsLinkingTo(path);
  if (articles.length === 0) return null;
  return (
    <section aria-labelledby="related-reading-heading" className={className}>
      <h2 id="related-reading-heading" className="text-2xl font-semibold md:text-3xl">
        Related reading
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((a) => (
          <li key={a.slug}>
            <Link href={insightPath(a.slug)} className="bento block h-full p-5 transition hover:shadow-md">
              <span className="text-[17px] font-semibold text-ink">{a.title}</span>
              <span className="mt-1 block text-[14px] text-titanium">{a.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
