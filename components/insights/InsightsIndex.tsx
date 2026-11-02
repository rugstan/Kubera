import Link from "next/link";
import { NewsletterSignup } from "@/components/newsletter/NewsletterSignup";
import { CtaBand, ProgramDisclosures } from "@/components/program/parts";
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
            name: "Kubera Commercial insights",
            description: INSIGHTS_INDEX.description,
            path: INSIGHTS_BASE,
            items: items.map((i) => ({ name: i.title, path: insightPath(i.slug) })),
          }),
        ]}
      />
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
        <header>
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

        <ul className="mt-12 space-y-5">
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

        <NewsletterSignup source={INSIGHTS_BASE} className="mt-14" />
        <CtaBand />
        <ProgramDisclosures />
      </div>
    </>
  );
}
