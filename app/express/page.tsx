import type { Metadata } from "next";
import { Suspense } from "react";
import { Qualifier } from "@/components/express/Qualifier";
import { LEGAL_PAGES } from "@/components/legal/legal";
import { Logo } from "@/components/site/Logo";
import { pageMetadata } from "@/lib/seo/metadata";
import { disclosures, licenseLine } from "@/lib/site";

// One canonical for the qualifier: the main-site URL. kubera.loans serves the same
// page at `/` but is noindex (proxy.ts) and points here.
export const metadata: Metadata = pageMetadata({
  title: "60-second deal qualifier",
  description:
    "Tell us about your senior living, hotel, multifamily or bridge deal. An AI-assisted first pass, reviewed by a licensed advisor, maps the programs that may fit.",
  path: "/express",
});

const HOW_IT_WORKS = [
  { title: "Tell us the basics", body: "Property type, loan purpose, rough size and timing. It takes about a minute." },
  { title: "AI-assisted first pass", body: "Our rules engine compares your answers with HUD, SBA, CMBS, agency and bridge program criteria." },
  { title: "Advisor review", body: "A licensed Kubera advisor reviews the result and follows up with next steps. Nothing is a commitment to lend." },
] as const;

// The notice at collection already sits on the form itself; the footer links the full pages.
const EXPRESS_LEGAL_LINKS = LEGAL_PAGES.filter((page) => !page.href.includes("#"));

export default function ExpressPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-6">
        <Logo />
        <span className="flex items-center gap-1.5 text-[13px] text-titanium">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden><path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" /></svg>
          Private &amp; encrypted
        </span>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">
        <section className="mb-10 text-center">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">60-second deal qualifier</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-titanium">
            Share a few details about your senior living, hotel, multifamily or bridge financing. We map the loan programs that may fit, and a licensed
            advisor reviews every submission.
          </p>
        </section>
        <Suspense fallback={<div className="bento h-[560px] animate-pulse" />}>
          <Qualifier />
        </Suspense>
        <section aria-labelledby="how-it-works" className="mt-16">
          <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => (
              <li key={step.title} className="bento p-6">
                <span className="text-sm font-semibold text-titanium">Step {i + 1}</span>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-titanium">{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[13px] leading-relaxed text-titanium">{disclosures.indicative}</p>
        </section>
      </main>
      <footer className="mx-auto w-full max-w-3xl px-5 pb-10 text-center text-xs leading-relaxed text-titanium">
        {/* Plain anchors: on kubera.loans these paths 308 to the main site (proxy.ts). */}
        <nav aria-label="Legal">
          <ul className="mb-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {EXPRESS_LEGAL_LINKS.map((page) => (
              <li key={page.href}>
                <a href={page.href} className="underline-offset-2 hover:text-ink hover:underline">
                  {page.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p>{licenseLine()}</p>
      </footer>
    </div>
  );
}
