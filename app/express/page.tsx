import type { Metadata } from "next";
import { Suspense } from "react";
import { ExpressHeader } from "@/components/express/ExpressHeader";
import { Qualifier } from "@/components/express/Qualifier";
import { LEGAL_PAGES } from "@/components/legal/legal";
import { pageMetadata } from "@/lib/seo/metadata";
import { disclosures, licenseLine } from "@/lib/site";

// One canonical for the qualifier: the main-site URL. kubera.loans serves the same
// page at `/` but is noindex (proxy.ts) and points here.
export const metadata: Metadata = pageMetadata({
  title: "60-second deal qualifier",
  description:
    "Tell us about your senior living, hotel, multifamily, construction or hard money deal. A licensed advisor reviews it and maps the programs that may fit.",
  path: "/express",
});

const HOW_IT_WORKS = [
  { title: "Tell us the basics", body: "Property type, loan purpose, rough size and timing. It takes about a minute." },
  { title: "Program match", body: "We compare your answers with HUD, SBA, CMBS, agency, bridge, construction and hard money program criteria." },
  { title: "Advisor review", body: "A licensed Corin advisor reviews the result and follows up with next steps. Nothing is a commitment to lend." },
] as const;

// The notice at collection already sits on the form itself; the footer links the full pages.
const EXPRESS_LEGAL_LINKS = LEGAL_PAGES.filter((page) => !page.href.includes("#"));

export default function ExpressPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <ExpressHeader />
      <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">
        <section className="mb-10 text-center">
          <h1 className="text-4xl font-semibold md:text-5xl">60-second deal qualifier</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-titanium">
            Share a few details about your senior living, hotel, multifamily, construction or hard money financing. We map the loan programs that may fit,
            and a licensed advisor reviews every submission.
          </p>
        </section>
        <Suspense fallback={<div className="bento h-[560px] animate-pulse" />}>
          <Qualifier />
        </Suspense>
        <section aria-labelledby="how-it-works" className="mt-16">
          <h2 id="how-it-works" className="text-2xl font-semibold">
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
                <a href={page.href} className="inline-flex items-center underline-offset-2 hover:text-ink hover:underline max-md:min-h-9">
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
