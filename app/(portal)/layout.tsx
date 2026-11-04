import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/site/Logo";
import { licenseLine, site } from "@/lib/site";

// Borrower portal shell: magic-link access for principals to complete their
// profile and upload checklist documents. Never indexed.

export const metadata: Metadata = {
  title: { default: "Borrower portal", template: "%s · Borrower portal" },
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-black/10 bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="rounded-lg">
            <Logo className="h-8" />
            <span className="sr-only"> home</span>
          </Link>
          <span className="eyebrow">Borrower portal</span>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
        {children}
      </main>
      <footer className="mx-auto max-w-4xl px-4 pb-10 text-[12px] leading-relaxed text-ink/80">
        <p>{licenseLine()}</p>
        <p className="mt-2">
          Corin Commercial arranges loans as a broker; the lender of record makes every credit decision. Questions? Email{" "}
          <a href={`mailto:${site.email}`} className="font-medium text-accent underline underline-offset-2">
            {site.email}
          </a>
          . Read our{" "}
          <Link href="/privacy" className="font-medium text-accent underline underline-offset-2">
            privacy policy
          </Link>
          .
        </p>
      </footer>
    </>
  );
}
