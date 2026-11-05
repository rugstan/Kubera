import Image from "next/image";
import Link from "next/link";
import { READABLE } from "@/components/site/PageContainer";
import type { SiteImage } from "@/content/images";
import { pageCard } from "@/content/programs";
import type { ProgramFaq, ProgramFamily, ProgramSection } from "@/content/programs";
import { HEADER_CTA, expressHrefFor, sizerLinkFor } from "@/components/site/nav";
import { disclosures, licenseLine } from "@/lib/site";
import type { BreadcrumbItem } from "@/components/seo/schemas";
import { LEAD_FORM_ANCHOR } from "./lead-form";

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-titanium">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={item.path} className="flex items-center gap-2">
              {last ? (
                <span aria-current="page" className="text-ink">
                  {item.name}
                </span>
              ) : (
                <Link href={item.path} className="inline-flex items-center underline-offset-2 hover:text-ink hover:underline max-md:min-h-9">
                  {item.name}
                </Link>
              )}
              {!last && <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The page's two actions, worded as everywhere else on the site. On a family's
 * hub and program pages both carry the family, so the qualifier opens on that
 * family's first step and the sizer on its tab; calculators and markets pass none.
 */
export function CtaLinks({ family, stacked = false }: { family?: ProgramFamily; stacked?: boolean }) {
  const sizer = sizerLinkFor(family);
  // Stacked: one full-width pill per row, for the narrow side card.
  const pill = stacked ? "w-full" : "max-w-full";
  return (
    <div className={stacked ? "flex flex-col gap-3" : "flex flex-wrap gap-3"}>
      <Link href={expressHrefFor(family)} className={`pill pill-primary ${pill} whitespace-normal text-center`}>
        {HEADER_CTA.label}
      </Link>
      <Link href={sizer.href} className={`pill pill-secondary ${pill} whitespace-normal text-center`}>
        {sizer.label}
      </Link>
    </div>
  );
}

/** A short jump from the page's opening actions to the request form further down. */
export function RequestLink({ className = "mt-4" }: { className?: string }) {
  return (
    <p className={`${className} text-[15px]`}>
      <a href={`#${LEAD_FORM_ANCHOR}`} className="link-chevron inline-flex min-h-9 items-center">
        Or send a short request to an advisor
      </a>
    </p>
  );
}

/** Next to the hero text from lg, under it on smaller screens. */
const HERO_IMAGE_SIZES = "(min-width: 1280px) 576px, (min-width: 1024px) calc(50vw - 56px), (min-width: 768px) calc(100vw - 64px), calc(100vw - 40px)";

/**
 * The page's image in the right half of its hero, 3:2 (the whole master).
 * The largest paint above a desktop fold, so it is preloaded.
 * `data-family-image` marks a family image, on a hub or as a program's fallback.
 */
export function HeroImage({ image, slug, family }: { image: SiteImage; slug: string; family?: ProgramFamily }) {
  return (
    <figure className="overflow-hidden rounded-card bg-hairline md:rounded-tile-lg" data-page-image={slug} data-family-image={family}>
      <Image
        src={image.src}
        alt={image.alt}
        placeholder="blur"
        preload
        sizes={HERO_IMAGE_SIZES}
        className="aspect-[3/2] h-auto w-full object-cover"
        style={image.position ? { objectPosition: image.position } : undefined}
      />
    </figure>
  );
}

/**
 * The hero of a page with breadcrumbs: the text on the left and, when there is
 * one, the page's image on the right from lg. Without an image the text keeps
 * a readable width. On a phone the image follows the text.
 */
export function PageHero({ breadcrumbs, media, children }: { breadcrumbs: BreadcrumbItem[]; media?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={media ? "grid items-center gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-16" : undefined}>
      <div className={media ? "min-w-0" : "max-w-3xl"}>
        <Breadcrumbs items={breadcrumbs} />
        <header className="mt-8">{children}</header>
      </div>
      {media}
    </div>
  );
}

/** One row of a key-facts card. `source` already carries its date where there is one. */
export type KeyFact = { label: string; value: string; source: string };

/**
 * A page's key figures as a card for the side column. Still a table for
 * assistive technology (one row per figure, with item, figure and source
 * columns), laid out as a stacked list so it reads in a third of the page or
 * on a phone without scrolling sideways. The explicit roles keep the table
 * semantics that `display: block` would otherwise drop in some browsers.
 */
export function KeyFactsCard({
  facts,
  title,
  note,
  caption,
  sourceHeader = "Source and date",
  headingId = "facts-heading",
}: {
  facts: KeyFact[];
  title: string;
  note: React.ReactNode;
  caption: string;
  sourceHeader?: string;
  headingId?: string;
}) {
  if (facts.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="bento p-6" data-key-facts>
      <h2 id={headingId} className="text-2xl font-semibold">
        {title}
      </h2>
      {/* One caveat for the whole table: per-row `verify` flags are an internal review aid, not public copy. */}
      <p className="mt-2 text-[13px] leading-relaxed text-titanium">{note}</p>
      <table role="table" className="mt-4 block w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup" className="sr-only">
          <tr role="row">
            <th role="columnheader" scope="col">Item</th>
            <th role="columnheader" scope="col">Figure</th>
            <th role="columnheader" scope="col">{sourceHeader}</th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="block divide-y divide-black/[0.08]">
          {facts.map((f) => (
            <tr role="row" key={f.label} className="block py-3 first:pt-0 last:pb-0">
              <th role="rowheader" scope="row" className="block text-[13px] font-medium leading-snug text-graphite">
                {f.label}
              </th>
              <td role="cell" className="mt-1 block text-[16px] font-semibold leading-snug text-ink">
                {f.value}
              </td>
              <td role="cell" className="mt-1 block text-[12px] leading-snug text-titanium">
                {f.source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The side column's call to action, shown from lg and sticky below the header
 * while the main column scrolls (`sticky={false}` inside a column that is
 * sticky itself). Phones already have the page's actions near the top, and
 * the closing card below. `request` adds the jump to the request form, on
 * pages that have one.
 */
export function SideCtaCard({ family, request = true, sticky = true, className = "" }: { family?: ProgramFamily; request?: boolean; sticky?: boolean; className?: string }) {
  return (
    <div className={`bento hidden p-6 lg:block ${sticky ? "lg:sticky lg:top-20" : ""} ${className}`.trim()} data-side-cta>
      <p className="text-[19px] font-semibold leading-snug text-ink">Talk through your deal with an advisor</p>
      <p className="mt-2 text-[14px] leading-relaxed text-titanium">
        A licensed Corin advisor reviews which programs and lenders may fit. No credit check, and no obligation.
      </p>
      <div className="mt-5">
        <CtaLinks family={family} stacked />
      </div>
      {request && <RequestLink className="mt-3" />}
    </div>
  );
}

export function Sections({ sections, anchors = false }: { sections: ProgramSection[]; anchors?: boolean }) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.heading} className="mt-14" aria-labelledby={anchors ? sectionAnchor(s.heading) : undefined}>
          <h2 id={anchors ? sectionAnchor(s.heading) : undefined} className="scroll-mt-24 text-2xl font-semibold md:text-3xl">
            {s.heading}
          </h2>
          <div className={`mt-4 space-y-4 text-[17px] leading-relaxed text-ink/85 ${READABLE}`}>
            {s.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {s.bullets && (
              <ul className="list-disc space-y-2 pl-6">
                {s.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </>
  );
}

/** Ids for section headings that a table of contents links to. */
export function sectionAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Native disclosure widgets: keyboard accessible without client JavaScript.
 * `columns={2}` sets the questions in two columns from lg, for pages where the
 * list spans the whole container; each answer keeps a readable width.
 */
export function FaqList({ faq, columns = 1 }: { faq: ProgramFaq[]; columns?: 1 | 2 }) {
  return (
    <section aria-labelledby="faq-heading" className="mt-14">
      <h2 id="faq-heading" className="scroll-mt-24 text-2xl font-semibold md:text-3xl">
        Frequently asked questions
      </h2>
      <div className={columns === 2 ? "mt-5 grid gap-3 lg:grid-cols-2 lg:items-start" : "mt-5 space-y-3"}>
        {faq.map((q) => (
          <details key={q.question} className="bento group p-5">
            <summary className="cursor-pointer list-none text-[17px] font-semibold marker:hidden">
              <span className="flex min-h-9 items-center justify-between gap-4">
                {q.question}
                <span aria-hidden="true" className="text-titanium transition-transform group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className={`mt-3 text-[16px] leading-relaxed text-ink/85 ${READABLE}`}>{q.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/**
 * Cards for the page's related links. `shown` holds slugs the page already
 * links to in its own program list, which are left out here.
 */
export function RelatedPages({ slugs, shown = [], heading = "Related programs" }: { slugs: string[]; shown?: string[]; heading?: string }) {
  const cards = slugs
    .filter((s) => !shown.includes(s))
    .map((s) => pageCard(s))
    .filter((c): c is NonNullable<ReturnType<typeof pageCard>> => Boolean(c));
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="related-heading" className="mt-14">
      <h2 id="related-heading" className="text-2xl font-semibold md:text-3xl">
        {heading}
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <li key={c.slug}>
            {/* The whole card is the link and the program name leads it, as on /financing, so link lists read "C-PACE …", not "Read more". */}
            <Link href={c.href} className="bento block h-full p-5 transition hover:shadow-md">
              <span className="text-[17px] font-semibold text-ink">{c.name}</span>
              <span className="mt-1 block text-[14px] text-titanium">{c.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Closing call to action: a light card, as on apple.com, never a dark band.
 * Across the container from lg: the text on the left, the actions on the right.
 */
export function CtaBand({ heading = "Talk through your deal with an advisor", family }: { heading?: string; family?: ProgramFamily }) {
  return (
    <section className="bento mt-14 p-6 sm:p-8 md:p-10 lg:flex lg:items-center lg:justify-between lg:gap-12">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold md:text-3xl">{heading}</h2>
        <p className="mt-3 max-w-2xl text-[16px] text-titanium">
          Send the basics and a licensed Corin advisor reviews which programs and lenders may fit, or size the loan yourself first.
        </p>
      </div>
      <div className="mt-6 lg:mt-0 lg:shrink-0">
        <CtaLinks family={family} />
      </div>
    </section>
  );
}

export function ProgramDisclosures() {
  return (
    <aside aria-label="Disclosures" className="mt-14 border-t border-black/[0.06] pt-6 text-[12px] leading-relaxed text-titanium">
      <div className="max-w-4xl space-y-2">
        <p>{disclosures.brokerNotLender}</p>
        <p>{disclosures.indicative}</p>
        <p>{disclosures.timeline}</p>
        <p className="font-medium text-ink/70">{licenseLine()}</p>
      </div>
    </aside>
  );
}
