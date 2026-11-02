import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqSchema } from "@/components/seo/schemas";
import { HOME_FAQ } from "@/content/home";
import { Reveal } from "./Reveal";
import { TrackedLink } from "./TrackedLink";

/** Native <details> accordions: no client JavaScript, and every answer is in the server HTML. */
export function HomeFaq() {
  return (
    <section aria-labelledby="home-faq-title" className="bg-canvas py-20 md:py-32">
      <JsonLd data={faqSchema([...HOME_FAQ])} />
      <div className="mx-auto max-w-[980px] px-5 md:px-8">
        <Reveal className="text-center">
          <p className="eyebrow">Questions</p>
          <h2 id="home-faq-title" className="mt-3 text-headline font-semibold md:text-section">
            Questions borrowers ask first.
          </h2>
        </Reveal>
        <div className="mt-12 divide-y divide-hairline rounded-tile-lg bg-white md:mt-16">
          {HOME_FAQ.map((q) => (
            <details key={q.question} className="group px-6 md:px-8">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                {q.question}
                <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 text-titanium transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m3.5 6 4.5 4.5L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <p className="max-w-3xl pb-6 text-[17px] text-titanium">
                {q.answer}
                {q.link && (
                  <>
                    {" "}
                    <Link href={q.link.href} className="text-accent underline underline-offset-2">
                      {q.link.label}
                    </Link>
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-center">
          <TrackedLink href="/financing" cta="family_hub" section="faq" className="link-chevron text-[17px] max-md:min-h-9">
            See all financing programs
          </TrackedLink>
        </p>
      </div>
    </section>
  );
}
