import { Suspense } from "react";
import { Footer } from "@/components/site/Footer";
import { GlassHeader } from "@/components/site/GlassHeader";
import { RateTicker, RateTickerSkeleton } from "@/components/ticker/RateTicker";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<RateTickerSkeleton />}>
        <RateTicker />
      </Suspense>
      <GlassHeader />
      <main>{children}</main>
      <Footer />
    </>
  );
}
