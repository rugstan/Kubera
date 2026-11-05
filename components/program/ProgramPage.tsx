import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import type { BreadcrumbItem } from "@/components/seo/schemas";
import { MAIN_COLUMN, PageContainer, SIDEBAR_GRID, SIDE_COLUMN } from "@/components/site/PageContainer";
import { familyImage, pageImageFor } from "@/content/images";
import { AS_OF } from "@/content/programs/format";
import { FAMILY_LABELS, financingPath, programsInFamily } from "@/content/programs";
import type { HubEntry, ProgramEntry } from "@/content/programs";
import { LeadForm } from "./LeadForm";
import { CtaBand, CtaLinks, FaqList, HeroImage, KeyFactsCard, PageHero, ProgramDisclosures, RelatedPages, RequestLink, Sections, SideCtaCard } from "./parts";
import { hubBreadcrumbs, hubJsonLd, programBreadcrumbs, programJsonLd } from "./schema";
import { UpdatedLine } from "@/components/seo/UpdatedLine";
import { RelatedInsights } from "@/components/insights/RelatedInsights";

// Layout shared by the hub and program pages, in the site container:
//   1. Hero: breadcrumbs, eyebrow, H1, definition and actions on the left, the
//      page's image on the right from lg (under the text on a phone).
//   2. Body: the main column (about two thirds: sections, the family's
//      programs, the request form and the FAQ) and a side column (the key
//      facts card and a sticky call to action). The side column comes first
//      in the DOM so a phone reads the facts before the sections, as before.
//   3. Related pages, the closing card and the disclosures across the container.

/** Slugs a hub already lists under "Programs we arrange", so the related list never repeats them. */
const familySlugs = (family: ProgramEntry["family"]) => programsInFamily(family).map((p) => p.slug);

/** The main column's blocks each carry their own top margin; the first one sits flush with the side column. */
const MAIN = `${MAIN_COLUMN} [&>*:first-child]:mt-0`;

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

/**
 * The family's programs side by side: what each one is and its first two key
 * facts, taken from the program pages (same figures, same as-of date). A
 * question-shaped heading and a real table so search and answer engines can
 * quote the comparison.
 */
function CompareTable({ family, label }: { family: ProgramEntry["family"]; label: string }) {
  const members = programsInFamily(family);
  if (members.length < 2) return null;
  return (
    <section aria-labelledby="compare-heading" className="mt-14">
      <h2 id="compare-heading" className="text-2xl font-semibold md:text-3xl">
        How do these {label.toLowerCase()} programs compare?
      </h2>
      <div className="mt-5 overflow-x-auto rounded-2xl border border-hairline">
        <table className="w-full min-w-[36rem] text-left text-[15px]">
          <caption className="sr-only">{label} loan programs compared: what each is and its key figures as of {AS_OF}</caption>
          <thead className="bg-canvas text-[13px] font-semibold text-ink">
            <tr>
              <th scope="col" className="px-4 py-3">Program</th>
              <th scope="col" className="px-4 py-3">What it is</th>
              <th scope="col" className="px-4 py-3">Key figures</th>
            </tr>
          </thead>
          <tbody>
            {members.map((p) => (
              <tr key={p.slug} className="border-t border-hairline align-top">
                <th scope="row" className="px-4 py-3 font-semibold">
                  <Link href={financingPath(p.slug)} className="text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink">
                    {p.name}
                  </Link>
                </th>
                <td className="px-4 py-3 text-ink/85">{p.summary}</td>
                <td className="px-4 py-3 text-ink/85">
                  {p.facts.slice(0, 2).map((f) => (
                    <span key={f.label} className="block">
                      {f.label}: {f.value}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-ink/70">Indicative figures as of {AS_OF}. Lenders set final terms after underwriting.</p>
    </section>
  );
}

function Hero({ entry, breadcrumbs }: { entry: ProgramEntry | HubEntry; breadcrumbs: BreadcrumbItem[] }) {
  // The program's own image, else the family's; none for a family without one yet (PENDING_IMAGES).
  const image = pageImageFor(entry);
  const media = image ? <HeroImage image={image} slug={entry.slug} family={image === familyImage(entry.family) ? entry.family : undefined} /> : undefined;
  return (
    <PageContainer className="pb-12 pt-10 md:pb-16 md:pt-14">
      <PageHero breadcrumbs={breadcrumbs} media={media}>
        <p className="eyebrow">{FAMILY_LABELS[entry.family]}</p>
        <h1 className="mt-3 text-4xl font-semibold md:text-5xl">{entry.name}</h1>
        <p className="mt-5 text-lg leading-relaxed text-ink/85">{entry.definition}</p>
        <UpdatedLine path={financingPath(entry.slug)} />
        <div className="mt-6">
          <CtaLinks family={entry.family} />
          <RequestLink />
        </div>
      </PageHero>
    </PageContainer>
  );
}

export function ProgramPage({ entry }: { entry: ProgramEntry }) {
  return (
    <>
      <JsonLd data={programJsonLd(entry)} />
      <article>
        <Hero entry={entry} breadcrumbs={programBreadcrumbs(entry)} />
        <PageContainer className="pb-16 md:pb-24">
          <div className={SIDEBAR_GRID}>
            <div className={`${SIDE_COLUMN} flex flex-col gap-6`}>
              <KeyFactsCard
                title="Key facts"
                caption="Key facts with sources and as-of dates"
                facts={entry.facts.map((f) => ({ label: f.label, value: f.value, source: `${f.source}; as of ${f.asOf}` }))}
                note={`Figures as of ${AS_OF}. Program rules change by notice, so an advisor confirms current terms with lenders before you rely on any figure.`}
              />
              <SideCtaCard family={entry.family} />
            </div>
            <div className={MAIN}>
              <Sections sections={entry.sections} />
              {entry.isHub && <FamilyList family={entry.family} currentSlug={entry.slug} heading="Programs we arrange" />}
              {entry.isHub && <CompareTable family={entry.family} label={FAMILY_LABELS[entry.family]} />}
              <LeadForm family={entry.family} slug={entry.slug} />
              <FaqList faq={entry.faq} />
            </div>
          </div>
          <RelatedPages slugs={entry.related} shown={entry.isHub ? familySlugs(entry.family) : []} />
          <RelatedInsights path={financingPath(entry.slug)} />
          <CtaBand family={entry.family} />
          <ProgramDisclosures />
        </PageContainer>
      </article>
    </>
  );
}

export function HubPage({ entry }: { entry: HubEntry }) {
  return (
    <>
      <JsonLd data={hubJsonLd(entry)} />
      <article>
        <Hero entry={entry} breadcrumbs={hubBreadcrumbs(entry)} />
        <PageContainer className="pb-16 md:pb-24">
          <div className={SIDEBAR_GRID}>
            {/* Only the sticky call to action, which shows from lg. */}
            <div className={`${SIDE_COLUMN} hidden lg:block`}>
              <SideCtaCard family={entry.family} />
            </div>
            <div className={MAIN}>
              <FamilyList family={entry.family} heading="Programs we arrange" />
              <CompareTable family={entry.family} label={FAMILY_LABELS[entry.family]} />
              <Sections sections={entry.sections} />
              <LeadForm family={entry.family} slug={entry.slug} />
              <FaqList faq={entry.faq} />
            </div>
          </div>
          <RelatedPages slugs={entry.related} shown={familySlugs(entry.family)} heading="Related financing" />
          <RelatedInsights path={financingPath(entry.slug)} />
          <CtaBand family={entry.family} />
          <ProgramDisclosures />
        </PageContainer>
      </article>
    </>
  );
}
