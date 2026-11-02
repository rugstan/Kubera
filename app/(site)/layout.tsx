import { Suspense } from "react";
import { SiteJsonLd } from "@/components/seo/JsonLd";
import { Footer } from "@/components/site/Footer";
import { GlassHeader } from "@/components/site/GlassHeader";
import { RateTicker, RateTickerSkeleton } from "@/components/ticker/RateTicker";
import { callLink, contactDetails } from "@/content/contact";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const { phone, telHref } = contactDetails();
  return (
    <>
      <SiteJsonLd />
      <Suspense fallback={<RateTickerSkeleton />}>
        <RateTicker />
      </Suspense>
      <GlassHeader phone={phone} telHref={telHref} call={callLink()} />
      <main id="main-content">{children}</main>
      <Footer />
    </>
  );
}
