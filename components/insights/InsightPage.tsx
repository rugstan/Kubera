import Link from "next/link";
import { DraftNotice } from "@/components/legal/DraftNotice";
import { TableOfContents } from "@/components/legal/LegalPage";
import { CtaBand, FaqList, PageHero, ProgramDisclosures, Sections, SideCtaCard, sectionAnchor } from "@/components/program/parts";
import { MAIN_COLUMN, PageContainer, SIDEBAR_GRID, SIDE_COLUMN } from "@/components/site/PageContainer";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, faqSchema } from "@/components/seo/schemas";
import { NewsletterSignup } from "@/components/newsletter/NewsletterSignup";
import { INSIGHTS_BASE, INSIGHTS_INDEX, insightAuthor, insightPath, readingMinutes, relatedInsights, wordCount, type Insight } from "@/content/insights";
import { articleSchema } from "@/lib/growth/schemas";

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function insightJsonLd(i: Insight) {
  const author = insightAuthor();
  return [
    articleSchema({
      headline: i.title,
      description: i.description,
      path: insightPath(i.slug),
      datePublished: i.published,
      dateModified: i.updated,
      author,
      section: i.category,
      wordCount: wordCount(i),
    }),
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: INSIGHTS_INDEX.title, path: INSIGHTS_BASE },
      { name: i.title, path: insightPath(i.slug) },
    ]),
    faqSchema(i.faq.map((q) => ({ question: q.question, answer: q.answer }))),
  ];
}

export function InsightPage({ insight: i }: { insight: Insight }) {
  const author = insightAuthor();
  const more = relatedInsights(i.slug, 2);
  // The side column's contents list: the article's own headings, in order.
  const toc = [
    { id: "takeaways-heading", label: "Key takeaways" },
    ...i.sections.map((s) => ({ id: sectionAnchor(s.heading), label: s.heading })),
    { id: "faq-heading", label: "Frequently asked questions" },
    { id: "next-heading", label: "Keep going" },
    { id: "sources-heading", label: "Sources" },
  ];
  return (
    <>
      <JsonLd data={insightJsonLd(i)} />
      {/* The article in a readable main column; from lg a sticky contents list and call to action beside it. */}
      <PageContainer as="article" className="pb-16 pt-10 md:pb-24 md:pt-14">
        <PageHero
          breadcrumbs={[
            { name: "Home", path: "/" },
            { name: INSIGHTS_INDEX.title, path: INSIGHTS_BASE },
            { name: i.metaTitle, path: insightPath(i.slug) },
          ]}
        >
          <p className="eyebrow">{i.category}</p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] md:text-5xl">{i.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{i.summary}</p>
          <p className="mt-5 text-[14px] text-titanium">
            By{" "}
            <Link href={author.path} className="font-medium text-ink underline-offset-2 hover:underline">
              {author.name}
            </Link>
            , {author.jobTitle.toLowerCase()}. Published <time dateTime={i.published}>{formatDate(i.published)}</time>
            {i.updated !== i.published && (
              <>
                , updated <time dateTime={i.updated}>{formatDate(i.updated)}</time>
              </>
            )}
            . {readingMinutes(i)} minute read.
          </p>
        </PageHero>

        <div className={`mt-10 ${SIDEBAR_GRID}`}>
          <div className={`${MAIN_COLUMN} [&>*:first-child]:mt-0`}>
            {i.legalDraft && (
              <div className="mt-8">
                <DraftNotice />
              </div>
            )}

            <section aria-labelledby="takeaways-heading" className="bento mt-10 p-6 md:p-7">
              <h2 id="takeaways-heading" className="scroll-mt-24 text-lg font-semibold">
                Key takeaways
              </h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[16px] leading-relaxed text-ink/85">
                {i.keyTakeaways.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>

            <Sections sections={i.sections} anchors />
            <FaqList faq={i.faq} />

            <section aria-labelledby="next-heading" className="mt-14">
              <h2 id="next-heading" className="scroll-mt-24 text-2xl font-semibold md:text-3xl">
                Keep going
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {i.related.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="bento block h-full p-4 text-[15px] font-medium text-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="sources-heading" className="mt-14">
              <h2 id="sources-heading" className="scroll-mt-24 text-lg font-semibold">
                Sources
              </h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] text-titanium">
                {i.sources.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="mt-3 max-w-[70ch] text-[13px] text-titanium">This article is general information, not legal, tax or investment advice. Program rules change by notice; confirm current terms with a lender.</p>
            </section>

            {more.length > 0 && (
              <section aria-labelledby="more-heading" className="mt-14">
                <h2 id="more-heading" className="text-2xl font-semibold md:text-3xl">
                  More insights
                </h2>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                  {more.map((m) => (
                    <li key={m.slug}>
                      <Link href={insightPath(m.slug)} className="bento block h-full p-5">
                        <span className="eyebrow">{m.category}</span>
                        <span className="mt-1 block text-[17px] font-semibold text-ink">{m.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <NewsletterSignup source={insightPath(i.slug)} className="mt-14" />
          </div>
          {/* From lg: the call to action, then the contents list, which sticks under the header as the article scrolls. */}
          <div className={`${SIDE_COLUMN} hidden flex-col gap-6 lg:flex`}>
            <SideCtaCard request={false} sticky={false} />
            <TableOfContents entries={toc} />
          </div>
        </div>
        <CtaBand />
        <ProgramDisclosures />
      </PageContainer>
    </>
  );
}
