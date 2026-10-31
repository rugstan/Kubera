import type { Metadata } from "next";
import { Suspense } from "react";
import { TokenAction } from "@/components/newsletter/TokenAction";

// Opened from the confirmation email. Not indexed, and the page itself changes
// nothing: the button posts the token.
export const metadata: Metadata = { title: "Confirm your subscription", robots: { index: false, follow: false } };

export default function ConfirmNewsletterPage() {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 md:px-8 md:py-24">
      <Suspense fallback={<p className="text-titanium">Loading</p>}>
        <TokenAction mode="confirm" />
      </Suspense>
    </div>
  );
}
