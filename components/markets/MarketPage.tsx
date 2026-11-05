import Link from "next/link";
import { CtaBand, CtaLinks, FaqList, KeyFactsCard, PageHero, ProgramDisclosures, RelatedPages, Sections, SideCtaCard } from "@/components/program/parts";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, faqSchema } from "@/components/seo/schemas";
import { MAIN_COLUMN, PageContainer, SIDEBAR_GRID, SIDE_COLUMN } from "@/components/site/PageContainer";
import { CALIFORNIA_BASE, CALIFORNIA_INDEX, MARKETS, getMarket, marketDisclaimer, marketPath, type MarketPage as MarketEntry } from "@/content/markets/california";
import { collectionSchema, marketServiceSchema } from "@/lib/growth/schemas";
import { UpdatedLine } from "@/components/seo/UpdatedLine";
import { RelatedInsights } from "@/components/insights/RelatedInsights";

// Laid out like the financing pages: the hero, then the sections and FAQ in
// the main column beside the local figures and a sticky call to action, then
// the related links and the closing card across the container.

export function MarketPage({ entry }: { entry: MarketEntry }) {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "California", path: CALIFORNIA_BASE },
    { name: entry.name, path: marketPath(entry.slug) },
  ];
  const nearby = entry.relatedMarkets.map((s) => getMarket(s)).filter((m): m is MarketEntry => Boolean(m));
  return (
    <>
      <JsonLd
        data={[
          marketServiceSchema({ name: `Commercial real estate loan brokerage in ${entry.name}`, description: entry.description, path: marketPath(entry.slug), areaServed: entry.areaServed }),
          breadcrumbSchema(crumbs),
          faqSchema(entry.faq.map((q) => ({ question: q.question, answer: q.answer }))),
        ]}
      />
      <article>
        <PageContainer className="pb-12 pt-10 md:pb-16 md:pt-14">
          <PageHero breadcrumbs={crumbs}>
            <p className="eyebrow">California markets</p>
            <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{entry.name} commercial real estate loans</h1>
            <p className="mt-5 text-lg leading-relaxed text-ink/85">{entry.definition}</p>
            <UpdatedLine path={marketPath(entry.slug)} />
            <div className="mt-6">
              <CtaLinks />
            </div>
          </PageHero>
        </PageContainer>
        <PageContainer className="pb-16 md:pb-24">
          <div className={SIDEBAR_GRID}>
            <div className={`${SIDE_COLUMN} flex flex-col gap-6`}>
              <KeyFactsCard
                title="Local rules and program figures"
                headingId="market-facts-heading"
                caption="Local rules and program figures with sources"
                sourceHeader="Source"
                facts={entry.facts.map((f) => ({ label: f.label, value: f.value, source: f.source }))}
                note={`Planning figures as of ${entry.facts[0]?.asOf}. Rules change by statute, ordinance and notice, so an advisor confirms them before you rely on any of them.`}
              />
              {/* No request form on a market page, so the card offers the two actions only. */}
              <SideCtaCard request={false} />
            </div>
            <div className={`${MAIN_COLUMN} [&>*:first-child]:mt-0`}>
              <Sections sections={entry.sections} />
              <FaqList faq={entry.faq} />
            </div>
          </div>
          <RelatedPages slugs={entry.relatedPrograms} heading="Programs we arrange here" />
          <RelatedInsights path={marketPath(entry.slug)} />
          <section aria-labelledby="nearby-heading" className="mt-14">
            <h2 id="nearby-heading" className="text-2xl font-semibold md:text-3xl">
              Other California markets
            </h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {nearby.map((m) => (
                <li key={m.slug}>
                  <Link href={marketPath(m.slug)} className="bento block h-full p-5">
                    <span className="text-[17px] font-semibold text-ink">{m.name}</span>
                    <span className="mt-1 block text-[14px] text-titanium">{m.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <CtaBand />
          <p className="mt-10 max-w-4xl text-[12px] leading-relaxed text-titanium">{marketDisclaimer}</p>
          <ProgramDisclosures />
        </PageContainer>
      </article>
    </>
  );
}

export function CaliforniaIndex() {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "California", path: CALIFORNIA_BASE },
  ];
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema(crumbs),
          collectionSchema({ name: CALIFORNIA_INDEX.title, description: CALIFORNIA_INDEX.description, path: CALIFORNIA_BASE, items: MARKETS.map((m) => ({ name: m.name, path: marketPath(m.slug) })) }),
        ]}
      />
      <PageContainer className="py-12 md:py-20">
        <PageHero breadcrumbs={crumbs}>
          <p className="eyebrow">California markets</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">California commercial loans by metro</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{CALIFORNIA_INDEX.description}</p>
        </PageHero>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MARKETS.map((m) => (
            <li key={m.slug}>
              <Link href={marketPath(m.slug)} className="bento block h-full p-6">
                <span className="text-xl font-semibold text-ink">{m.name}</span>
                <span className="mt-2 block text-[15px] leading-relaxed text-titanium">{m.summary}</span>
                <span className="link-chevron mt-4 text-[14px]">Read the guide</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-3xl text-[15px] leading-relaxed text-titanium">We publish a metro guide only where we have something specific to say about how local rules change a loan. More markets follow as that copy is written.</p>
        <CtaBand />
        <ProgramDisclosures />
      </PageContainer>
    </>
  );
}
