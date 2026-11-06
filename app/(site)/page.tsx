import type { Metadata } from "next";
import { Suspense } from "react";
import { DealStructures } from "@/components/home/DealStructures";
import { FinalCta } from "@/components/home/FinalCta";
import { Hero } from "@/components/home/Hero";
import { HomeFaq } from "@/components/home/HomeFaq";
import { HowItWorks } from "@/components/home/HowItWorks";
import { ProgramFamilies } from "@/components/home/ProgramFamilies";
import { Reveal } from "@/components/home/Reveal";
import { WhyCorin } from "@/components/home/WhyCorin";
import { PageContainer } from "@/components/site/PageContainer";
import { LoanSizer } from "@/components/sizer/LoanSizer";
import { callLink } from "@/content/contact";
import { getMarketSnapshot } from "@/lib/rates";
import { pageMetadata } from "@/lib/seo/metadata";
import { HOME_HERO_IMAGE } from "@/content/images";

export const metadata: Metadata = pageMetadata({
  title: "Commercial real estate loan broker",
  absoluteTitle: "Corin Commercial | California Commercial Real Estate Loans",
  description:
    "Licensed California broker arranging HUD, SBA, CMBS, agency, construction, bridge and hard money loans for senior living, hotels and multifamily. Not a lender.",
  path: "/",
  image: HOME_HERO_IMAGE,
});

async function SizerWithRates() {
  const snap = await getMarketSnapshot();
  return <LoanSizer benchmarks={snap.benchmarks} live={snap.live} call={callLink()} />;
}

// Section backgrounds alternate white and canvas, with WhyCorin as the page's
// only black (bg-pro) band, so no two neighbours share a background.
export default function HomePage() {
  return (
    <>
      <Hero />
      <ProgramFamilies />
      <HowItWorks />
      <section id="sizer" aria-labelledby="sizer-title" className="bg-canvas py-20 md:py-32">
        <PageContainer>
          <Reveal className="mx-auto max-w-[980px] text-center">
            <p className="eyebrow">Loan sizer</p>
            <h2 id="sizer-title" className="mt-3 text-headline font-semibold md:text-section">
              Size your loan before you talk to anyone.
            </h2>
            <p className="mx-auto mt-4 max-w-3xl text-[17px] text-titanium md:text-lede">
              Choose an asset class and enter a few numbers. Compare indicative HUD, SBA, CMBS, agency, bridge, construction and hard money structures side by
              side, with rate, lender fees, closing costs and our estimated advisory fee broken out. An advisor confirms every figure with lenders.
            </p>
          </Reveal>
          <div className="mt-12 md:mt-16">
            <Suspense fallback={<div className="bento mx-auto h-[640px] animate-pulse" />}>
              <SizerWithRates />
            </Suspense>
          </div>
        </PageContainer>
      </section>
      <WhyCorin />
      <DealStructures />
      <HomeFaq />
      <FinalCta />
    </>
  );
}
