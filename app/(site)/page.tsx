import type { Metadata } from "next";
import { Suspense } from "react";
import { Bento } from "@/components/home/Bento";
import { CapitalMarkets } from "@/components/home/CapitalMarkets";
import { DealStructures } from "@/components/home/DealStructures";
import { Hero } from "@/components/home/Hero";
import { Reveal } from "@/components/home/Reveal";
import { LoanSizer } from "@/components/sizer/LoanSizer";
import { getMarketSnapshot } from "@/lib/rates";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Senior living, hotel and CRE debt advisory",
  absoluteTitle: "Kubera Commercial | Senior Living, Hotel & CRE Debt",
  description:
    "Advisor-led, AI-assisted debt advisory for senior living, hotels and multifamily: HUD 232, SBA 504 hotel stacks, CMBS and bridge financing, sized in 60 seconds.",
  path: "/",
});

async function SizerWithRates() {
  const snap = await getMarketSnapshot();
  return <LoanSizer benchmarks={snap.benchmarks} live={snap.live} />;
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <section id="sizer" className="border-y border-black/[0.06] bg-white/50">
        <div className="mx-auto max-w-[1280px] px-5 py-24 md:px-8 md:py-32">
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="eyebrow">AI loan sizer &amp; comparator</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">Size your loan in 60 seconds.</h2>
            <p className="mt-4 text-lg text-titanium">
              Side-by-side HUD, SBA, CMBS, agency, and bridge structures — with MIP, guarantee fees, audit costs, and closing costs broken out.
            </p>
          </Reveal>
          <div className="mt-12">
            <Suspense fallback={<div className="bento mx-auto h-[640px] animate-pulse" />}>
              <SizerWithRates />
            </Suspense>
          </div>
        </div>
      </section>
      <Bento />
      <Suspense fallback={<div className="h-[720px] bg-pro" />}>
        <CapitalMarkets />
      </Suspense>
      <DealStructures />
    </>
  );
}
