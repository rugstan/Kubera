import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CtaBand, PageHero, ProgramDisclosures } from "@/components/program/parts";
import { HEADER_CTA } from "@/components/site/nav";
import { RatesData, RatesSkeleton } from "@/components/rates/RatesData";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { PageContainer } from "@/components/site/PageContainer";
import { RATES_PAGE, RATES_PATH } from "@/content/rates";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({ title: RATES_PAGE.title, description: RATES_PAGE.description, path: RATES_PATH });

export default function RatesPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Rates", path: RATES_PATH },
        ])}
      />
      {/* The intro stays a readable width; the two rate tables span the container. */}
      <PageContainer className="py-12 md:py-20">
        <PageHero breadcrumbs={[{ name: "Home", path: "/" }, { name: "Rates", path: RATES_PATH }]}>
          <p className="eyebrow">Rates</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">Commercial real estate loan rates today</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">
            Commercial loan rates are a benchmark, such as the 10-year Treasury yield, plus a spread that depends on the program and the deal. This page shows the benchmarks lenders use, updated each business day, and the range Corin assumes for HUD, SBA, agency, CMBS, bridge, construction and hard money loans.
          </p>
          <p className="mt-4 text-[15px] text-titanium">
            Rates here are indicative and are not a quote or a commitment to lend.{" "}
            <Link href={HEADER_CTA.href} className="font-medium text-accent underline underline-offset-2">
              {HEADER_CTA.label}
            </Link>{" "}
            for an advisor&apos;s read on your deal.
          </p>
        </PageHero>
        <Suspense fallback={<RatesSkeleton />}>
          <RatesData />
        </Suspense>
        <CtaBand />
        <ProgramDisclosures />
      </PageContainer>
    </>
  );
}
