import type { Metadata } from "next";
import { Suspense } from "react";
import { TokenAction } from "@/components/newsletter/TokenAction";
import { PageContainer } from "@/components/site/PageContainer";

// Opened from the confirmation email. Not indexed, and the page itself changes
// nothing: the button posts the token.
export const metadata: Metadata = { title: "Confirm your subscription", robots: { index: false, follow: false } };

// In the site container like every page; the one action keeps a short column.
export default function ConfirmNewsletterPage() {
  return (
    <PageContainer className="py-16 md:py-24">
      <div className="max-w-xl">
        <h1 className="text-3xl font-semibold md:text-4xl">Confirm your subscription</h1>
        <Suspense fallback={<p className="mt-4 text-titanium">Loading</p>}>
          <TokenAction mode="confirm" />
        </Suspense>
      </div>
    </PageContainer>
  );
}
