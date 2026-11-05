import Link from "next/link";
import { NewsletterSignup } from "@/components/newsletter/NewsletterSignup";
import { CtaBand, ProgramDisclosures } from "@/components/program/parts";
import { MAIN_COLUMN, PageContainer, SIDEBAR_GRID, SIDE_COLUMN } from "@/components/site/PageContainer";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { INSIGHTS_BASE, INSIGHTS_INDEX, insightPath, insightsNewestFirst, readingMinutes } from "@/content/insights";
import { collectionSchema } from "@/lib/growth/schemas";
import { formatDate } from "./InsightPage";

export function InsightsIndex() {
  const items = insightsNewestFirst();
  return (
    <>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: INSIGHTS_INDEX.title, path: INSIGHTS_BASE },
          ]),
          collectionSchema({
            name: "Corin Commercial insights",
            description: INSIGHTS_INDEX.description,
            path: INSIGHTS_BASE,
            items: items.map((i) => ({ name: i.title, path: insightPath(i.slug) })),
          }),
        ]}
      />
      <PageContainer className="py-12 md:py-20">
        <header className="max-w-3xl">
          <p className="eyebrow">Insights</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">Insights on commercial real estate debt</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">
            Analysis of HUD, SBA, CMBS and bridge financing for senior living, hotels and multifamily, with the numbers behind each program. Written by a licensed California broker; every figure comes from the same assumptions as our loan sizer.
            Building or buying with private money? Start with our{" "}
            <Link href="/financing/construction" className="font-medium text-accent underline underline-offset-2">
              construction loan
            </Link>{" "}
            and{" "}
            <Link href="/financing/hard-money" className="font-medium text-accent underline underline-offset-2">
              hard money loan
            </Link>{" "}
            guides.
          </p>
        </header>

        {/* The articles in the main column; from lg the newsletter signup sits beside them and stays in view. */}
        <div className={`mt-12 ${SIDEBAR_GRID}`}>
          <ul className={`${MAIN_COLUMN} space-y-5`}>
            {items.map((i) => (
              <li key={i.slug}>
                <article className="bento p-6 md:p-7">
                  <p className="eyebrow">{i.category}</p>
                  <h2 className="mt-2 text-2xl font-semibold leading-snug">
                    <Link href={insightPath(i.slug)} className="hover:underline">
                      {i.title}
                    </Link>
                  </h2>
                  <p className="mt-3 text-[16px] leading-relaxed text-ink/85">{i.description}</p>
                  <p className="mt-4 text-[13px] text-titanium">
                    <time dateTime={i.published}>{formatDate(i.published)}</time> · {readingMinutes(i)} minute read
                  </p>
                </article>
              </li>
            ))}
          </ul>
          <div className={SIDE_COLUMN}>
            <NewsletterSignup source={INSIGHTS_BASE} className="lg:sticky lg:top-20" />
          </div>
        </div>
        <CtaBand />
        <ProgramDisclosures />
      </PageContainer>
    </>
  );
}
