import { disclosures, licenseLine, site } from "@/lib/site";
import { canonicalUrl } from "./hosts";
import { allSitemapRoutes, type SitemapRoute, type SitemapSection } from "./sitemap-routes";

const SECTION_ORDER: SitemapSection[] = ["Tools", "Programs", "Company", "Resources", "Legal"];

/**
 * Plain-text summary for LLM crawlers (llmstxt.org format): H1, blockquote summary,
 * then sections of links. Built from the same route list as the sitemap.
 */
export function buildLlmsTxt(routes: SitemapRoute[] = allSitemapRoutes()): string {
  const lines: string[] = [
    `# ${site.name}`,
    "",
    `> ${site.legalName} is a California Department of Real Estate licensed real estate broker that arranges commercial real estate loans for senior living, hotel and multifamily owners. Kubera is a broker, not a lender: loans are funded by the lenders it introduces. Service is advisor-led and AI-assisted.`,
    "",
    "## About",
    "",
    "- Programs arranged: HUD 232 and 223(f) senior housing, HUD multifamily, SBA 504 and 7(a) hotel stacks, hotel CMBS, PIP bridge, Fannie Mae and Freddie Mac multifamily, bank and life company, private bridge, hard money and construction financing.",
    "- Rates, terms and sizing shown on the site are indicative estimates, not a commitment to lend. Terms vary by borrower, asset and lender underwriting.",
    `- Contact: ${site.email}`,
    `- Licensing: ${licenseLine()}`,
  ];

  const bySection = new Map<SitemapSection, SitemapRoute[]>();
  for (const r of routes) {
    const key = r.section ?? "Resources";
    bySection.set(key, [...(bySection.get(key) ?? []), r]);
  }
  for (const section of SECTION_ORDER) {
    const items = bySection.get(section);
    if (!items?.length) continue;
    lines.push("", `## ${section}`, "");
    for (const r of items) {
      lines.push(`- [${r.title}](${canonicalUrl(r.path)})${r.description ? `: ${r.description}` : ""}`);
    }
  }

  lines.push("", "## Optional", "", `- [Sitemap](${canonicalUrl("/sitemap.xml")})`, "", "## Disclosure", "", disclosures.indicative, "");
  return lines.join("\n");
}
