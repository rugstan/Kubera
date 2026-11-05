import Image from "next/image";
import { callLink } from "@/content/contact";
import { HOME_HERO_IMAGE } from "@/content/images";
import { FAMILY_LABELS, PROGRAM_FAMILIES, financingPath, hubForFamily } from "@/content/programs";
import { site } from "@/lib/site";
import { TrackedLink } from "./TrackedLink";

const PROOF = [
  { k: "HUD and SBA", v: "Long-term government loan programs" },
  { k: "CMBS and agency", v: "Fannie Mae, Freddie Mac and conduit loans" },
  { k: "Construction and bridge", v: "Bank, debt fund, private and hard money lenders" },
  { k: "Not a lender", v: "A licensed broker working for you" },
] as const;

// Mobile: a 2x2 grid, so the first cell of each row has no divider. From md: one row of four.
const divider = (i: number) => [i % 2 === 1 ? "border-l" : "", i === 2 ? "md:border-l" : ""].join(" ").trim();

export function Hero() {
  const call = callLink();
  return (
    <section className="bg-white">
      {/* Sized so the facts row clears a 1440x900 fold: 56px headline, tighter top padding.
          No Reveal anywhere in the hero: a scroll-driven fade leaves whatever overhangs the fold
          part-transparent on first paint (the actions at 390x844, the facts row at 1440x789),
          which fails text contrast and hides the actions on short phones. */}
      <div className="mx-auto max-w-[1280px] px-5 pb-20 pt-12 text-center md:px-8 md:pb-28 md:pt-16">
        <div className="mx-auto max-w-[980px]">
          <p className="eyebrow">
            Commercial real estate loan broker
            {site.dreCorporateLicense ? (
              <>
                {" · "}
                {/* Kept on one line when it fits; a long license value breaks instead of widening the page at 320px. */}
                <span data-dre-license className="inline-block max-w-full [overflow-wrap:anywhere]">CA DRE #{site.dreCorporateLicense}</span>
              </>
            ) : null}
          </p>
          <h1 className="mt-4 text-tile font-semibold md:text-hero">We help you find the right lender for your commercial real estate loan.</h1>
          <p className="mx-auto mt-6 max-w-3xl text-[17px] text-titanium md:text-lede">
            Corin Commercial is a licensed California real estate broker. We arrange senior living, hotel, multifamily, construction and hard money loans,
            comparing HUD, SBA, CMBS, agency, bank and private lenders for you. We are not a lender, so we are not tied to one lender&apos;s loans.
          </p>
        </div>
        <div>
          <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
            <TrackedLink href="/express" cta="get_options" section="hero" className="pill pill-primary">Get loan options</TrackedLink>
            <TrackedLink href="/#sizer" cta="size_loan" section="hero" className="pill pill-secondary">Size my loan</TrackedLink>
          </div>
          <p className="mt-4 text-[13px] text-titanium">About 60 seconds · No credit check to start · No obligation</p>
          <p className="mt-4">
            <TrackedLink href={call.href} cta={call.kind === "book" ? "book_call" : "email_advisor"} section="hero" className="link-chevron text-[17px] max-md:min-h-9">
              {call.kind === "book" ? "Prefer to talk? Book a call with an advisor" : "Questions first? Email an advisor"}
            </TrackedLink>
          </p>
          {/* Every family has an entry point above the fold, construction and hard money included. */}
          <nav aria-label="What we finance" className="mx-auto mt-8 max-w-3xl border-t border-hairline pt-6">
            <ul className="flex flex-wrap justify-center gap-2">
              {PROGRAM_FAMILIES.map((family) => (
                <li key={family}>
                  <TrackedLink
                    href={financingPath(hubForFamily(family).slug)}
                    cta="family_hub"
                    section="hero"
                    className="inline-flex min-h-9 items-center rounded-full bg-canvas px-4 text-[15px] text-ink transition-colors hover:bg-fill"
                  >
                    {FAMILY_LABELS[family]}
                  </TrackedLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div>
          <dl className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-y-8 md:mt-14 md:grid-cols-4">
            {PROOF.map((p, i) => (
              <div key={p.k} className={`border-hairline px-4 ${divider(i)}`}>
                <dt className="text-[21px] font-semibold leading-tight text-ink">{p.k}</dt>
                <dd className="mt-1 text-callout text-titanium">{p.v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {/* Below the facts row, so the headline, actions and facts keep the fold. Never lazy, but
            not preloaded either: it starts below a 1440x900 fold and the headline is the largest
            paint. Not in a Reveal, so it never fades. 2:1 from md, 4:3 on phones. */}
        <figure className="mt-12 overflow-hidden rounded-card bg-hairline md:mt-16 md:rounded-tile-lg" data-home-hero-image>
          <Image
            src={HOME_HERO_IMAGE.src}
            alt={HOME_HERO_IMAGE.alt}
            placeholder="blur"
            loading="eager"
            sizes="(min-width: 1280px) 1216px, (min-width: 768px) calc(100vw - 64px), calc(100vw - 40px)"
            className="aspect-[4/3] h-auto w-full object-cover md:aspect-[2/1]"
            style={{ objectPosition: HOME_HERO_IMAGE.position }}
          />
        </figure>
      </div>
    </section>
  );
}
