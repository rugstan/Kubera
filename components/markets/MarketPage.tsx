import Link from "next/link";
import { TableScroll } from "@/components/legal/LegalPage";
import { Breadcrumbs, CtaBand, CtaLinks, FaqList, ProgramDisclosures, RelatedPages, Sections } from "@/components/program/parts";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, faqSchema } from "@/components/seo/schemas";
import { CALIFORNIA_BASE, CALIFORNIA_INDEX, MARKETS, getMarket, marketDisclaimer, marketPath, type MarketPage as MarketEntry } from "@/content/markets/california";
import { marketServiceSchema } from "@/lib/growth/schemas";

const WRAP = "mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20";

function Facts({ facts }: { facts: MarketEntry["facts"] }) {
  return (
    <section aria-labelledby="market-facts-heading" className="mt-14">
      <h2 id="market-facts-heading" className="text-2xl font-semibold md:text-3xl">
        Local rules and program figures
      </h2>
      <p className="mt-2 text-[14px] text-titanium">Planning figures as of {facts[0]?.asOf}. Rules change by statute, ordinance and notice; verify before relying on any of them.</p>
      <div className="bento mt-5 p-2 md:p-4">
        <TableScroll label="Local rules and program figures table">
          <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
            <caption className="sr-only">Local rules and program figures with sources</caption>
            <thead>
              <tr className="border-b border-black/10">
                <th scope="col" className="py-2 pr-4 font-semibold">Item</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Figure</th>
                <th scope="col" className="py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.label} className="border-b border-black/[0.06] last:border-0">
                  <th scope="row" className="py-3 pr-4 align-top font-medium text-ink">{f.label}</th>
                  <td className="py-3 pr-4 align-top text-ink">{f.value}</td>
                  <td className="py-3 align-top text-[13px] text-titanium">
                    {f.source}
                    {f.verify && <span className="ml-1 font-medium text-warning">Re-check before relying on it.</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </section>
  );
}

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
      <article className={WRAP}>
        <Breadcrumbs items={crumbs} />
        <header className="mt-8">
          <p className="eyebrow">California markets</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{entry.name} commercial real estate loans</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{entry.definition}</p>
          <div className="mt-6">
            <CtaLinks />
          </div>
        </header>
        <Facts facts={entry.facts} />
        <Sections sections={entry.sections} />
        <FaqList faq={entry.faq} />
        <RelatedPages slugs={entry.relatedPrograms} heading="Programs we arrange here" />
        <section aria-labelledby="nearby-heading" className="mt-14">
          <h2 id="nearby-heading" className="text-2xl font-semibold md:text-3xl">
            Other California markets
          </h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
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
        <p className="mt-10 text-[12px] leading-relaxed text-titanium">{marketDisclaimer}</p>
        <ProgramDisclosures />
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
      <JsonLd data={breadcrumbSchema(crumbs)} />
      <div className={WRAP}>
        <Breadcrumbs items={crumbs} />
        <header className="mt-8">
          <p className="eyebrow">California markets</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">California commercial loans by metro</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{CALIFORNIA_INDEX.description}</p>
        </header>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
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
        <p className="mt-8 text-[15px] leading-relaxed text-titanium">We publish a metro guide only where we have something specific to say about how local rules change a loan. More markets follow as that copy is written.</p>
        <CtaBand />
        <ProgramDisclosures />
      </div>
    </>
  );
}
