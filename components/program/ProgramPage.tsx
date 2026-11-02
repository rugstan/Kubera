import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { AS_OF } from "@/content/programs/format";
import { FAMILY_LABELS, financingPath, programsInFamily } from "@/content/programs";
import type { HubEntry, ProgramEntry } from "@/content/programs";
import { Breadcrumbs, CtaBand, CtaLinks, FactsTable, FaqList, ProgramDisclosures, RelatedPages, Sections } from "./parts";
import { hubBreadcrumbs, hubJsonLd, programBreadcrumbs, programJsonLd } from "./schema";

const WRAP = "mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20";

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
            <CtaLinks />
          </div>
        </header>
        <FactsTable facts={entry.facts} asOf={AS_OF} />
        <Sections sections={entry.sections} />
        {entry.isHub && <FamilyList family={entry.family} currentSlug={entry.slug} heading="More in this category" />}
        <FaqList faq={entry.faq} />
        <RelatedPages slugs={entry.related} />
        <CtaBand />
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
            <CtaLinks sizerLabel="Size a loan" />
          </div>
        </header>
        <FamilyList family={entry.family} heading="Programs we arrange" />
        <Sections sections={entry.sections} />
        <FaqList faq={entry.faq} />
        <RelatedPages slugs={entry.related} heading="Related financing" />
        <CtaBand />
        <ProgramDisclosures />
      </article>
    </>
  );
}
