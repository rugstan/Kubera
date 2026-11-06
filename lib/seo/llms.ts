import { CALCULATORS, calculatorPath } from "@/content/calculators";
import { DEAL_STRUCTURES, structurePath } from "@/content/deal-structures";
import { GLOSSARY, GLOSSARY_PATH } from "@/content/glossary";
import { INSIGHTS, insightPath } from "@/content/insights";
import { MARKETS, marketPath } from "@/content/markets/california";
import { financingPath, hubs, programs } from "@/content/programs";
import { AS_OF } from "@/content/programs/format";
import { disclosures, licenseLine, site } from "@/lib/site";
import { contentUpdated } from "./content-dates";
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
    `> ${site.legalName} is a California Department of Real Estate licensed real estate broker that arranges commercial real estate loans for senior living, hotel, multifamily, construction and hard money borrowers. Corin is a broker, not a lender: loans are funded by the lenders it introduces. A licensed advisor leads every engagement.`,
    "",
    "## About",
    "",
    "- Programs arranged: HUD 232 and 223(f) senior housing, HUD multifamily, SBA 504 and 7(a) hotel stacks, hotel CMBS, PIP bridge, Fannie Mae and Freddie Mac multifamily, bank and life company, private bridge, hard money and construction financing.",
    "- Rates, terms and sizing shown on the site are indicative estimates, not a commitment to lend. Terms vary by borrower, asset and lender underwriting.",
    `- Contact: ${site.email}`,
    `- Licensing: ${licenseLine()}`,
    `- License lookup: the corporate license can be verified on the California Department of Real Estate public license search (https://www2.dre.ca.gov/PublicASP/pplinfo.asp?License_id=${site.dreCorporateLicense}).`,
    "- Where Corin works: California. City guides cover Los Angeles, Orange County and the San Francisco Bay Area.",
    "- How Corin is paid: by the borrower, the lender or both, only as agreed in writing; every amount on a loan secured by real property appears on the Mortgage Loan Disclosure Statement. Lenders make every credit decision and fund loans as lender of record.",
    `- Full text of the program pages, FAQs, city guides, articles and glossary: ${canonicalUrl("/llms-full.txt")}`,
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

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * llms-full.txt: the substance of the key pages as plain text, so an answer
 * engine can quote a program's definition, key figures and FAQ without
 * rendering the site. Built from the same content modules as the pages; every
 * figure carries its as-of date and the indicative-terms disclosure closes the file.
 */
export function buildLlmsFullTxt(): string {
  const out: string[] = [
    `# ${site.name}: full text of key pages`,
    "",
    `> ${site.legalName} is a California real estate broker licensed by the Department of Real Estate. It arranges commercial real estate loans and is not a lender. ${licenseLine()}.`,
    "",
    disclosures.indicative,
    "",
    disclosures.brokerNotLender,
    "",
    `Index of pages with one-line summaries: ${canonicalUrl("/llms.txt")}`,
  ];

  const section = (title: string) => out.push("", `## ${title}`, "");

  section("Financing programs");
  for (const entry of [...hubs, ...programs]) {
    const path = financingPath(entry.slug);
    out.push(`### ${entry.name}`, "", `URL: ${canonicalUrl(path)}`);
    const updated = contentUpdated(path);
    if (updated) out.push(`Updated: ${updated}`);
    out.push("", clean(entry.definition), "");
    const facts = programs.find((p) => p.slug === entry.slug)?.facts ?? [];
    if (facts.length) {
      out.push(`Key figures (indicative, as of ${AS_OF}):`, "");
      for (const f of facts) out.push(`- ${f.label}: ${f.value} (source: ${f.source})`);
      out.push("");
    }
    for (const sec of entry.sections) {
      out.push(`#### ${sec.heading}`, "", ...sec.paragraphs.map(clean));
      if (sec.bullets?.length) out.push("", ...sec.bullets.map((b) => `- ${clean(b)}`));
      out.push("");
    }
    if (entry.faq.length) {
      out.push("#### Frequently asked questions", "");
      for (const q of entry.faq) out.push(`Q: ${q.question}`, `A: ${clean(q.answer)}`, "");
    }
  }

  section("California city guides");
  for (const m of MARKETS) {
    out.push(`### ${m.name} commercial real estate loans`, "", `URL: ${canonicalUrl(marketPath(m.slug))}`, "", clean(m.definition), "");
    for (const f of m.facts) out.push(`- ${f.label}: ${f.value} (source: ${f.source}; as of ${f.asOf})`);
    out.push("");
    for (const q of m.faq) out.push(`Q: ${q.question}`, `A: ${clean(q.answer)}`, "");
  }

  section("Calculators");
  for (const c of CALCULATORS) {
    out.push(`### ${c.name}`, "", `URL: ${canonicalUrl(calculatorPath(c.slug))}`, "", clean(c.definition), "");
    for (const q of c.faq) out.push(`Q: ${q.question}`, `A: ${clean(q.answer)}`, "");
  }

  section("Illustrative loan structures");
  out.push("These are illustrative examples of how programs are typically arranged, not closed transactions, client results or testimonials.", "");
  for (const st of DEAL_STRUCTURES) out.push(`- [${st.amount} ${st.asset}: ${st.program}](${canonicalUrl(structurePath(st.slug))}): ${clean(st.metaDescription)}`);

  section("Articles");
  for (const i of INSIGHTS) {
    out.push(`### ${i.title}`, "", `URL: ${canonicalUrl(insightPath(i.slug))}`, `Published: ${i.published}; updated: ${i.updated}`, "", clean(i.summary), "");
    if (i.keyTakeaways.length) out.push("Key takeaways:", "", ...i.keyTakeaways.map((k) => `- ${clean(k)}`), "");
    for (const q of i.faq) out.push(`Q: ${q.question}`, `A: ${clean(q.answer)}`, "");
  }

  section("Glossary");
  out.push(`URL: ${canonicalUrl(GLOSSARY_PATH)}`, "");
  for (const t of GLOSSARY) out.push(`- ${t.term}${t.alias ? ` (${t.alias})` : ""}: ${clean(t.definition)}`);

  out.push("", "## Disclosure", "", disclosures.indicative, "", disclosures.timeline, "");
  return out.join("\n");
}
