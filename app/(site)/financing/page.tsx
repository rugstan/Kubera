import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CtaBand, ProgramDisclosures } from "@/components/program/parts";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { PageContainer } from "@/components/site/PageContainer";
import { familyImage, HOME_HERO_IMAGE } from "@/content/images";
import { FAMILY_LABELS, FINANCING_BASE, financingPath, hubForFamily, PROGRAM_FAMILIES, programsInFamily } from "@/content/programs";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Commercial real estate financing programs",
  description:
    "Every loan program Corin Commercial arranges: HUD, SBA, CMBS, agency, bridge, construction and hard money for senior living, hotels, multifamily and commercial.",
  path: FINANCING_BASE,
  image: HOME_HERO_IMAGE,
});

const anchor = (family: string) => `${family}-heading`;

export default function FinancingIndexPage() {
  const families = PROGRAM_FAMILIES.map((family) => ({ family, label: FAMILY_LABELS[family], hub: hubForFamily(family), programs: programsInFamily(family), image: familyImage(family) }));
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Financing", path: FINANCING_BASE },
        ])}
      />
      <PageContainer className="py-12 md:py-20">
        <header className="max-w-3xl">
          <p className="eyebrow">Financing</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">Financing programs</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">
            Corin Commercial arranges commercial real estate loans as a licensed California real estate broker. Each page below explains one program: how it works, the figures lenders use, what slows a file down, and which alternatives to compare.
          </p>
        </header>

        {/* Every family up front, so construction and hard money are as easy to find as the property types.
            Phones: one sticky, sideways-scrolling row of jump links under the header. It is a direct
            child of the page wrapper so it stays stuck for the whole list. */}
        <nav aria-label="Jump to a financing family" className="glass sticky top-12 z-20 -mx-5 mt-8 border-b border-black/[0.08] md:hidden">
          <ul className="flex gap-2 overflow-x-auto px-5 py-2 [scrollbar-width:none]">
            {families.map(({ family, label }) => (
              <li key={family} className="shrink-0">
                <a href={`#${anchor(family)}`} className="inline-flex min-h-9 items-center rounded-full bg-fill px-4 text-[14px] text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {/* From md: equal tiles, three across, with the hub link and a jump to the family's programs. */}
        <nav aria-label="Financing by family" className="mt-12 hidden md:block">
          <ul className="grid grid-cols-3 gap-4">
            {families.map(({ family, label, hub, programs }) => (
              <li key={family} className="bento flex flex-col p-6">
                <p className="text-[19px] font-semibold leading-tight text-ink">{label}</p>
                <p className="mt-2 text-[14px] text-titanium">{hub.summary}</p>
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-5">
                  <Link href={financingPath(hub.slug)} className="link-chevron min-h-9 text-[15px]">
                    Explore<span className="sr-only"> {label.toLowerCase()} financing</span>
                  </Link>
                  <a href={`#${anchor(family)}`} className="inline-flex min-h-9 items-center text-[14px] text-titanium hover:text-ink hover:underline">
                    {programs.length} programs<span className="sr-only"> in {label.toLowerCase()}</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </nav>

        {/* From lg each family is two columns: its heading, summary and photo on the left (no photo for a
            family without one yet), its programs on the right. Phones skip the photos, as on the homepage. */}
        {families.map(({ family, label, hub, programs, image }) => (
          <section key={family} aria-labelledby={anchor(family)} className="mt-14 md:mt-20 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12 xl:gap-16">
            <div>
              {/* Clears the sticky header, plus the phone jump bar. */}
              <h2 id={anchor(family)} className="scroll-mt-28 text-2xl font-semibold md:scroll-mt-20 md:text-3xl">
                <Link href={financingPath(hub.slug)} className="link-chevron inline-flex min-h-9 text-ink">
                  {label}
                </Link>
              </h2>
              <p className="mt-2 max-w-3xl text-[15px] text-titanium">{hub.summary}</p>
              {image && (
                <figure className="mt-6 hidden overflow-hidden rounded-card bg-hairline lg:block" data-family-index-image={family}>
                  <Image
                    src={image.src}
                    alt={image.alt}
                    placeholder="blur"
                    sizes="(min-width: 1280px) 384px, calc(33vw - 40px)"
                    className="aspect-[4/3] h-auto w-full object-cover"
                    style={image.position ? { objectPosition: image.position } : undefined}
                  />
                </figure>
              )}
            </div>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:mt-0 lg:content-start">
              {programs.map((p) => (
                <li key={p.slug}>
                  <Link href={financingPath(p.slug)} className="bento block h-full p-5">
                    <span className="text-[16px] font-semibold text-ink">{p.name}</span>
                    <span className="mt-1 block text-[14px] text-titanium">{p.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <CtaBand />
        <ProgramDisclosures />
      </PageContainer>
    </>
  );
}
