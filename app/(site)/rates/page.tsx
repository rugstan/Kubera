import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Breadcrumbs, CtaBand, ProgramDisclosures } from "@/components/program/parts";
import { RatesData, RatesSkeleton } from "@/components/rates/RatesData";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
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
      <div className="mx-auto max-w-4xl px-5 py-12 md:px-8 md:py-20">
        <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Rates", path: RATES_PATH }]} />
        <header className="mt-8">
          <p className="eyebrow">Rates</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Commercial real estate loan rates today</h1>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink/85">
            Commercial loan rates are a benchmark, such as the 10-year Treasury yield, plus a spread that depends on the program and the deal. This page shows the benchmarks lenders use, updated each business day, and the range Kubera assumes for HUD, SBA, agency, CMBS and bridge loans.
          </p>
          <p className="mt-4 text-[15px] text-titanium">
            Rates here are indicative and are not a quote or a commitment to lend.{" "}
            <Link href="/express" className="font-medium text-accent underline underline-offset-2">
              Start the 60-second qualifier
            </Link>{" "}
            for an advisor&apos;s read on your deal.
          </p>
        </header>
        <Suspense fallback={<RatesSkeleton />}>
          <RatesData />
        </Suspense>
        <CtaBand />
        <ProgramDisclosures />
      </div>
    </>
  );
}
