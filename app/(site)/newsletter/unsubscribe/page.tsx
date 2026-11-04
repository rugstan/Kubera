import type { Metadata } from "next";
import { Suspense } from "react";
import { TokenAction } from "@/components/newsletter/TokenAction";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default function UnsubscribeNewsletterPage() {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 md:px-8 md:py-24">
      <h1 className="text-3xl font-semibold md:text-4xl">Unsubscribe from the newsletter</h1>
      <Suspense fallback={<p className="mt-4 text-titanium">Loading</p>}>
        <TokenAction mode="unsubscribe" />
      </Suspense>
    </div>
  );
}
