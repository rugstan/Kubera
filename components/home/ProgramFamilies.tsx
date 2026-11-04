import Link from "next/link";
import { HOME_FAMILIES } from "@/content/home";
import { FAMILY_LABELS, PROGRAM_FAMILIES, financingPath, hubForFamily, pageCard, type ProgramFamily } from "@/content/programs";
import { disclosures } from "@/lib/site";
import { Reveal } from "./Reveal";
import { TrackedLink } from "./TrackedLink";

// Six equal cards, three across: the four property families, then construction
// and hard money. Below md the cards stack, so each shows who it is for, its lead
// program and a "+N more" link to the hub (one row of chips), and leaves the
// program figure to the hub page, which keeps the families compact on a phone.
const PHONE_CHIPS = 1;

const SPAN: Record<ProgramFamily, string> = {
  "senior-living": "md:col-span-2",
  hotels: "md:col-span-2",
  multifamily: "md:col-span-2",
  commercial: "md:col-span-2",
  construction: "md:col-span-2",
  "hard-money": "md:col-span-2",
};

export function ProgramFamilies() {
  return (
    <section id="programs" className="bg-canvas py-20 md:py-32">
      <div className="mx-auto max-w-[1280px] px-5 md:px-8">
        <Reveal className="mx-auto max-w-[980px] text-center">
          <p className="eyebrow">What we finance</p>
          <h2 className="mt-3 text-headline font-semibold md:text-section">What are you financing?</h2>
          <p className="mx-auto mt-4 max-w-3xl text-[17px] text-titanium md:text-lede">
            Choose your property or project to see the programs lenders use for it and what they look for.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 md:mt-16 md:grid-cols-6 md:gap-5">
          {PROGRAM_FAMILIES.map((family, i) => {
            const data = HOME_FAMILIES.find((f) => f.family === family);
            if (!data) return null;
            const title = FAMILY_LABELS[family];
            const hub = financingPath(hubForFamily(family).slug);
            const chips = data.programSlugs.map((slug) => pageCard(slug)).filter((c) => c !== undefined);
            return (
              <Reveal key={family} delay={i * 0.04} className={SPAN[family]}>
                <article id={family} aria-labelledby={`${family}-title`} className="bento flex h-full scroll-mt-24 flex-col p-6 md:rounded-tile-lg md:p-8">
                  <h3 id={`${family}-title`} className="text-subhead font-semibold">
                    {title}
                  </h3>
                  <p className="mt-2 text-[15px] text-titanium md:text-[17px]">{data.audience}</p>
                  <p className="mt-4 text-[15px] font-semibold text-ink max-md:hidden">{data.fact}</p>
                  <ul className="mt-4 flex flex-wrap gap-2 md:mt-5" aria-label={`${title} programs`}>
                    {chips.map((c, n) => (
                      <li key={c.slug} className={n >= PHONE_CHIPS ? "max-md:hidden" : undefined}>
                        <Link href={c.href} className="inline-flex min-h-9 items-center rounded-full bg-fill px-3 text-[14px] text-ink transition-colors hover:bg-black/10">
                          {c.name}
                        </Link>
                      </li>
                    ))}
                    {chips.length > PHONE_CHIPS && (
                      <li className="md:hidden">
                        <Link href={hub} className="inline-flex min-h-9 items-center rounded-full bg-fill px-3 text-[14px] text-ink transition-colors hover:bg-black/10">
                          +{chips.length - PHONE_CHIPS} more<span className="sr-only"> {title.toLowerCase()} programs</span>
                        </Link>
                      </li>
                    )}
                  </ul>
                  {data.note && <p className="mt-3 text-[12px] text-titanium md:mt-4">{data.note}</p>}
                  {/* One footer layout on every card: a short link and the pill always share a row. */}
                  <div className="mt-auto flex items-center justify-between gap-4 pt-5 md:pt-6">
                    <TrackedLink href={hub} cta="family_hub" section="programs" className="link-chevron text-[15px] max-md:min-h-9">
                      Explore<span className="sr-only"> {title.toLowerCase()} financing</span>
                    </TrackedLink>
                    <TrackedLink href={`/express?family=${family}`} cta="family_options" section="programs" className="pill pill-secondary pill-sm max-md:min-h-9">Get options<span className="sr-only"> for {title.toLowerCase()}</span></TrackedLink>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-6 text-[12px] leading-relaxed text-titanium">{disclosures.indicative}</p>
      </div>
    </section>
  );
}
