import Image from "next/image";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { familyImage } from "@/content/images";
import { AS_OF } from "@/content/programs/format";
import { FAMILY_LABELS, financingPath, programsInFamily } from "@/content/programs";
import type { HubEntry, ProgramEntry } from "@/content/programs";
import { Breadcrumbs, CtaBand, CtaLinks, FactsTable, FaqList, ProgramDisclosures, RelatedPages, Sections } from "./parts";
import { hubBreadcrumbs, hubJsonLd, programBreadcrumbs, programJsonLd } from "./schema";

const WRAP = "mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20";

/** Slugs a hub already lists under "Programs we arrange", so the related list never repeats them. */
const familySlugs = (family: ProgramEntry["family"]) => programsInFamily(family).map((p) => p.slug);

function FamilyList({ family, currentSlug, heading }: { family: ProgramEntry["family"]; currentSlug?: string; heading: string }) {
  const members = programsInFamily(family).filter((p) => p.slug !== currentSlug);
  if (members.length === 0) return null;
  return (
    <section aria-labelledby="family-heading" className="mt-14">
      <h2 id="family-heading" className="text-2xl font-semibold md:text-3xl">
        {heading}
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {members.map((p) => (
          <li key={p.slug}>
            <Link href={financingPath(p.slug)} className="bento block h-full p-5">
              <span className="text-[17px] font-semibold text-ink">{p.name}</span>
              <span className="mt-1 block text-[14px] text-titanium">{p.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The family's 2:1 banner under a hub's header; nothing for a family without an image. */
function FamilyBanner({ family }: { family: ProgramEntry["family"] }) {
  const image = familyImage(family);
  if (!image) return null;
  return (
    <figure className="mt-10 overflow-hidden rounded-2xl bg-hairline" data-family-image={family}>
      <Image
        src={image.src}
        alt={image.alt}
        placeholder="blur"
        loading="eager"
        sizes="(min-width: 768px) 704px, calc(100vw - 40px)"
        className="aspect-[2/1] h-auto w-full object-cover"
        style={image.position ? { objectPosition: image.position } : undefined}
      />
    </figure>
  );
}

export function ProgramPage({ entry }: { entry: ProgramEntry }) {
  return (
    <>
      <JsonLd data={programJsonLd(entry)} />
      <article className={WRAP}>
        <Breadcrumbs items={programBreadcrumbs(entry)} />
        <header className="mt-8">
          <p className="eyebrow">{FAMILY_LABELS[entry.family]}</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{entry.name}</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{entry.definition}</p>
          <div className="mt-6">
            <CtaLinks family={entry.family} />
          </div>
        </header>
        {/* A program that is its family's hub (hard money) carries the hub banner; other program pages have no photo. */}
        {entry.isHub && <FamilyBanner family={entry.family} />}
        <FactsTable facts={entry.facts} asOf={AS_OF} />
        <Sections sections={entry.sections} />
        {entry.isHub && <FamilyList family={entry.family} currentSlug={entry.slug} heading="Programs we arrange" />}
        <FaqList faq={entry.faq} />
        <RelatedPages slugs={entry.related} shown={entry.isHub ? familySlugs(entry.family) : []} />
        <CtaBand family={entry.family} />
        <ProgramDisclosures />
      </article>
    </>
  );
}

export function HubPage({ entry }: { entry: HubEntry }) {
  return (
    <>
      <JsonLd data={hubJsonLd(entry)} />
      <article className={WRAP}>
        <Breadcrumbs items={hubBreadcrumbs(entry)} />
        <header className="mt-8">
          <p className="eyebrow">{FAMILY_LABELS[entry.family]}</p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{entry.name}</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">{entry.definition}</p>
          <div className="mt-6">
            <CtaLinks family={entry.family} />
          </div>
        </header>
        <FamilyBanner family={entry.family} />
        <FamilyList family={entry.family} heading="Programs we arrange" />
        <Sections sections={entry.sections} />
        <FaqList faq={entry.faq} />
        <RelatedPages slugs={entry.related} shown={familySlugs(entry.family)} heading="Related financing" />
        <CtaBand family={entry.family} />
        <ProgramDisclosures />
      </article>
    </>
  );
}
