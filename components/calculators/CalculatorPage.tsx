import Link from "next/link";
import { Suspense } from "react";
import { Breadcrumbs, CtaBand, FaqList, ProgramDisclosures, RelatedPages } from "@/components/program/parts";
import { sizerLinkFor } from "@/components/site/nav";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema, faqSchema } from "@/components/seo/schemas";
import { CALCULATORS, CALCULATORS_BASE, CALCULATORS_INDEX, calculatorPath, type CalculatorPage as CalculatorEntry } from "@/content/calculators";
import { getTerm } from "@/content/glossary";
import { webApplicationSchema } from "@/lib/growth/schemas";
import { getMarketSnapshot } from "@/lib/rates";
import { DscrCalculator } from "./DscrCalculator";
import { HotelDebtYieldCalculator } from "./HotelDebtYieldCalculator";
import { HudMipCalculator } from "./HudMipCalculator";
import { Sba504Calculator } from "./Sba504Calculator";

const WRAP = "mx-auto max-w-5xl px-5 py-12 md:px-8 md:py-20";

/** Construction and hard money are sized on the homepage sizer; these cards open it on the right tab. */
const SIZER_CARDS = [
  {
    family: "construction",
    name: "Construction loan sizer",
    summary: "Enter land, hard and soft costs and the stabilized NOI to compare bank, debt fund and private construction quotes, with the capital stack and take-out test.",
  },
  {
    family: "hard-money",
    name: "Hard money and fix-and-flip sizer",
    summary: "Enter the as-is value, rehab budget and strategy to size a fix-and-flip or private bridge loan, with its interest reserve and exit test.",
  },
] as const;

/** Reads the cached market snapshot for default rates; lives inside a Suspense boundary. */
async function Calculator({ slug }: { slug: CalculatorEntry["slug"] }) {
  const snap = await getMarketSnapshot();
  const props = { benchmarks: snap.benchmarks, asOf: snap.asOf, live: snap.live };
  switch (slug) {
    case "dscr":
      return <DscrCalculator {...props} />;
    case "hud-mip":
      return <HudMipCalculator {...props} />;
    case "sba-504":
      return <Sba504Calculator {...props} />;
    case "hotel-debt-yield":
      return <HotelDebtYieldCalculator {...props} />;
  }
}

function CalculatorSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6 md:grid-cols-[5fr_6fr]">
      <div className="bento h-96" />
      <div className="bento h-96" />
    </div>
  );
}

export function CalculatorPage({ entry }: { entry: CalculatorEntry }) {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Calculators", path: CALCULATORS_BASE },
    { name: entry.name, path: calculatorPath(entry.slug) },
  ];
  const terms = entry.relatedTerms.map((t) => getTerm(t)).filter((t): t is NonNullable<ReturnType<typeof getTerm>> => Boolean(t));
  const others = CALCULATORS.filter((c) => c.slug !== entry.slug);
  return (
    <>
      <JsonLd
        data={[
          webApplicationSchema({ name: entry.name, description: entry.description, path: calculatorPath(entry.slug) }),
          breadcrumbSchema(crumbs),
          faqSchema(entry.faq.map((q) => ({ question: q.question, answer: q.answer }))),
        ]}
      />
      <article className={WRAP}>
        <Breadcrumbs items={crumbs} />
        <header className="mt-8 max-w-3xl">
          <p className="eyebrow">Calculator</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{entry.name}</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{entry.definition}</p>
        </header>

        <div className="mt-10">
          <Suspense fallback={<CalculatorSkeleton />}>
            <Calculator slug={entry.slug} />
          </Suspense>
          <p className="mt-4 text-[13px] leading-relaxed text-titanium">
            Results are indicative estimates for discussion. They are not a loan offer, a rate quote or a commitment to lend. Nothing you type here is sent anywhere; the math runs in your browser.
          </p>
        </div>

        <section aria-labelledby="how-heading" className="mt-14 max-w-3xl">
          <h2 id="how-heading" className="text-2xl font-semibold md:text-3xl">
            How it works
          </h2>
          <div className="mt-4 space-y-4 text-[17px] leading-relaxed text-ink/85">
            {entry.howItWorks.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <h2 className="mt-10 text-2xl font-semibold md:text-3xl">Reading the result</h2>
          <div className="mt-4 space-y-4 text-[17px] leading-relaxed text-ink/85">
            {entry.readingTheResult.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </section>

        <div className="max-w-3xl">
          <FaqList faq={entry.faq} />
          <RelatedPages slugs={entry.relatedPrograms} heading="Related financing" />

          {terms.length > 0 && (
            <section aria-labelledby="terms-heading" className="mt-14">
              <h2 id="terms-heading" className="text-2xl font-semibold md:text-3xl">
                Terms used here
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {terms.map((t) => (
                  <li key={t.slug}>
                    <Link href={`/glossary#${t.slug}`} className="bento block h-full p-4">
                      <span className="text-[16px] font-semibold text-ink">{t.term}</span>
                      <span className="mt-1 line-clamp-2 block text-[14px] text-titanium">{t.definition}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="more-calcs-heading" className="mt-14">
            <h2 id="more-calcs-heading" className="text-2xl font-semibold md:text-3xl">
              More calculators
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {others.map((c) => (
                <li key={c.slug}>
                  <Link href={calculatorPath(c.slug)} className="bento block h-full p-4">
                    <span className="text-[16px] font-semibold text-ink">{c.name}</span>
                    <span className="mt-1 block text-[14px] text-titanium">{c.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <CtaBand heading="Want an advisor to check the numbers?" />
          <ProgramDisclosures />
        </div>
      </article>
    </>
  );
}

export function CalculatorsIndex() {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Calculators", path: CALCULATORS_BASE },
  ];
  return (
    <>
      <JsonLd data={breadcrumbSchema(crumbs)} />
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
        <Breadcrumbs items={crumbs} />
        <header className="mt-8">
          <p className="eyebrow">Calculators</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{CALCULATORS_INDEX.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{CALCULATORS_INDEX.description}</p>
        </header>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {CALCULATORS.map((c) => (
            <li key={c.slug}>
              <Link href={calculatorPath(c.slug)} className="bento block h-full p-6">
                <span className="text-xl font-semibold text-ink">{c.name}</span>
                <span className="mt-2 block text-[15px] leading-relaxed text-titanium">{c.summary}</span>
                <span className="link-chevron mt-4 text-[14px]">Open the calculator</span>
              </Link>
            </li>
          ))}
        </ul>
        <h2 className="mt-14 text-2xl font-semibold md:text-3xl">Construction and hard money</h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {SIZER_CARDS.map((c) => (
            <li key={c.family}>
              <Link href={sizerLinkFor(c.family).href} className="bento block h-full p-6">
                <span className="text-xl font-semibold text-ink">{c.name}</span>
                <span className="mt-2 block text-[15px] leading-relaxed text-titanium">{c.summary}</span>
                <span className="link-chevron mt-4 text-[14px]">Open the sizer</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-[15px] leading-relaxed text-titanium">
          Looking for a full structure instead of one number? The{" "}
          <Link href="/#sizer" className="font-medium text-accent underline underline-offset-2">
            60-second loan sizer
          </Link>{" "}
          compares programs side by side.
        </p>
        <CtaBand />
        <ProgramDisclosures />
      </div>
    </>
  );
}
