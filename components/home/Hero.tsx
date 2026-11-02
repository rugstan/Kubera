import { site } from "@/lib/site";
import { Reveal } from "./Reveal";
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
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-[1280px] px-5 pb-20 pt-12 text-center md:px-8 md:pb-32 md:pt-24">
        <Reveal className="mx-auto max-w-[980px]">
          <p className="eyebrow">
            Commercial real estate loan broker
            {site.dreCorporateLicense ? ` · CA DRE #${site.dreCorporateLicense}` : null}
          </p>
          <h1 className="mt-4 text-tile font-semibold md:text-hero lg:text-hero-lg">We find the right lender for your commercial real estate loan.</h1>
          <p className="mx-auto mt-6 max-w-3xl text-[17px] text-titanium md:text-lede">
            Kubera Commercial is a licensed California real estate broker. We arrange senior living, hotel, multifamily, construction and hard money loans,
            comparing HUD, SBA, CMBS, agency, bank and private lenders for you. We are not a lender, so we are not tied to one lender&apos;s loans.
          </p>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
            <TrackedLink href="/express" cta="get_options" section="hero" className="pill pill-primary">Get loan options</TrackedLink>
            <TrackedLink href="/#sizer" cta="size_loan" section="hero" className="pill pill-secondary">Size my loan</TrackedLink>
          </div>
          <p className="mt-4 text-[13px] text-titanium">About 60 seconds · No credit check to start · No obligation</p>
          <p className="mt-4">
            <TrackedLink href="/contact#schedule" cta="book_call" section="hero" className="link-chevron text-[17px]">
              Prefer to talk? Book a call with an advisor
            </TrackedLink>
          </p>
        </Reveal>
        <Reveal delay={0.16}>
          <dl className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-y-8 md:mt-20 md:grid-cols-4">
            {PROOF.map((p, i) => (
              <div key={p.k} className={`border-hairline px-4 ${divider(i)}`}>
                <dt className="text-[21px] font-semibold leading-tight text-ink">{p.k}</dt>
                <dd className="mt-1 text-callout text-titanium">{p.v}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
