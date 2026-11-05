import type { Metadata } from "next";
import { Suspense } from "react";
import { TokenAction } from "@/components/newsletter/TokenAction";
import { PageContainer } from "@/components/site/PageContainer";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

// In the site container like every page; the one action keeps a short column.
export default function UnsubscribeNewsletterPage() {
  return (
    <PageContainer className="py-16 md:py-24">
      <div className="max-w-xl">
        <h1 className="text-3xl font-semibold md:text-4xl">Unsubscribe from the newsletter</h1>
        <Suspense fallback={<p className="mt-4 text-titanium">Loading</p>}>
          <TokenAction mode="unsubscribe" />
        </Suspense>
      </div>
    </PageContainer>
  );
}
