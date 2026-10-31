import type { Metadata } from "next";
import { Suspense } from "react";
import { TokenAction } from "@/components/newsletter/TokenAction";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default function UnsubscribeNewsletterPage() {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 md:px-8 md:py-24">
      <Suspense fallback={<p className="text-titanium">Loading</p>}>
        <TokenAction mode="unsubscribe" />
      </Suspense>
    </div>
  );
}
