import Link from "next/link";
import { HOME_FAMILIES } from "@/content/home";
import { FAMILY_LABELS, PROGRAM_FAMILIES, financingPath, hubForFamily, pageCard, type ProgramFamily } from "@/content/programs";
import { disclosures } from "@/lib/site";
import { Reveal } from "./Reveal";
import { TrackedLink } from "./TrackedLink";

// Five equal cards: three across, then construction and hard money two across.
const SPAN: Record<ProgramFamily, string> = {
  "senior-living": "md:col-span-2",
  hotels: "md:col-span-2",
  multifamily: "md:col-span-2",
  construction: "md:col-span-3",
  "hard-money": "md:col-span-3",
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
        <div className="mt-12 grid gap-5 md:mt-16 md:grid-cols-6">
          {PROGRAM_FAMILIES.map((family, i) => {
            const data = HOME_FAMILIES.find((f) => f.family === family);
            if (!data) return null;
            const title = FAMILY_LABELS[family];
            const hub = financingPath(hubForFamily(family).slug);
            const chips = data.programSlugs.map((slug) => pageCard(slug)).filter((c) => c !== undefined);
            return (
              <Reveal key={family} delay={i * 0.04} className={SPAN[family]}>
                <article id={family} aria-labelledby={`${family}-title`} className="bento flex h-full scroll-mt-24 flex-col p-7 md:rounded-tile-lg md:p-8">
                  <h3 id={`${family}-title`} className="text-subhead font-semibold">
                    {title}
                  </h3>
                  <p className="mt-2 text-[17px] text-titanium">{data.audience}</p>
                  <p className="mt-4 text-[15px] font-semibold text-ink">{data.fact}</p>
                  <ul className="mt-5 flex flex-wrap gap-2" aria-label={`${title} programs`}>
                    {chips.map((c) => (
                      <li key={c.slug}>
                        <Link href={c.href} className="inline-flex min-h-9 items-center rounded-full bg-fill px-3 text-[14px] text-ink transition-colors hover:bg-black/10">
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {data.note && <p className="mt-4 text-[12px] text-titanium">{data.note}</p>}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pt-6">
                    <TrackedLink href={hub} cta="family_hub" section="programs" className="link-chevron text-[15px]">
                      {`Explore ${title.toLowerCase()} financing`}
                    </TrackedLink>
                    <TrackedLink href={`/express?family=${family}`} cta="family_options" section="programs" className="pill pill-secondary pill-sm">Get options<span className="sr-only"> for {title.toLowerCase()}</span></TrackedLink>
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
