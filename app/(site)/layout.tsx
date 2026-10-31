import { Suspense } from "react";
import { SiteJsonLd } from "@/components/seo/JsonLd";
import { Footer } from "@/components/site/Footer";
import { GlassHeader } from "@/components/site/GlassHeader";
import { RateTicker, RateTickerSkeleton } from "@/components/ticker/RateTicker";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteJsonLd />
      <Suspense fallback={<RateTickerSkeleton />}>
        <RateTicker />
      </Suspense>
      <GlassHeader />
      <main id="main-content">{children}</main>
      <Footer />
    </>
  );
}
