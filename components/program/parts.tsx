import Link from "next/link";
import { TableScroll } from "@/components/legal/LegalPage";
import { pageCard } from "@/content/programs";
import type { ProgramFact, ProgramFaq, ProgramSection } from "@/content/programs";
import { disclosures, licenseLine } from "@/lib/site";
import type { BreadcrumbItem } from "@/components/seo/schemas";

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
                <Link href={item.path} className="underline-offset-2 hover:text-ink hover:underline">
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

export function CtaLinks({ sizerLabel = "Size this loan" }: { sizerLabel?: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/#sizer" className="pill pill-primary">
        {sizerLabel}
      </Link>
      <Link href="/express" className="pill pill-glass">
        Start the 60-second qualifier
      </Link>
    </div>
  );
}

export function FactsTable({ facts, asOf, title = "Key facts" }: { facts: ProgramFact[]; asOf: string; title?: string }) {
  if (facts.length === 0) return null;
  return (
    <section aria-labelledby="facts-heading" className="mt-14">
      <h2 id="facts-heading" className="text-2xl font-semibold tracking-tight md:text-3xl">
        {title}
      </h2>
      <p className="mt-2 text-[14px] text-titanium">
        Figures as of {asOf}. Programs change by notice; an advisor confirms current terms with lenders before you rely on them.
      </p>
      <div className="bento mt-5 p-2 md:p-4">
        <TableScroll label={`${title} table`}>
          <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
            <caption className="sr-only">{title} with sources and as-of dates</caption>
            <thead>
              <tr className="border-b border-black/10">
                <th scope="col" className="py-2 pr-4 font-semibold">Item</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Figure</th>
                <th scope="col" className="py-2 font-semibold">Source and date</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.label} className="border-b border-black/[0.06] last:border-0">
                  <th scope="row" className="py-3 pr-4 align-top font-medium text-ink">{f.label}</th>
                  <td className="py-3 pr-4 align-top text-ink">{f.value}</td>
                  <td className="py-3 align-top text-[13px] text-titanium">
                    {f.source}; as of {f.asOf}
                    {f.verify && <span className="ml-1 font-medium text-gold-ink">Re-check before relying on it.</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </section>
  );
}

export function Sections({ sections }: { sections: ProgramSection[] }) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.heading} className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{s.heading}</h2>
          <div className="mt-4 space-y-4 text-[17px] leading-relaxed text-ink/85">
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

/** Native disclosure widgets: keyboard accessible without client JavaScript. */
export function FaqList({ faq }: { faq: ProgramFaq[] }) {
  return (
    <section aria-labelledby="faq-heading" className="mt-14">
      <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight md:text-3xl">
        Frequently asked questions
      </h2>
      <div className="mt-5 space-y-3">
        {faq.map((q) => (
          <details key={q.question} className="bento group p-5">
            <summary className="cursor-pointer list-none text-[17px] font-semibold marker:hidden">
              <span className="flex items-start justify-between gap-4">
                {q.question}
                <span aria-hidden="true" className="text-titanium transition-transform group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-3 text-[16px] leading-relaxed text-ink/85">{q.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function RelatedPages({ slugs, heading = "Related programs" }: { slugs: string[]; heading?: string }) {
  const cards = slugs.map((s) => pageCard(s)).filter((c): c is NonNullable<ReturnType<typeof pageCard>> => Boolean(c));
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="related-heading" className="mt-14">
      <h2 id="related-heading" className="text-2xl font-semibold tracking-tight md:text-3xl">
        {heading}
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.slug}>
            <Link href={c.href} className="bento block h-full p-5 transition hover:shadow-md">
              <span className="text-[17px] font-semibold text-ink">{c.name}</span>
              <span className="mt-1 block text-[14px] text-titanium">{c.summary}</span>
              <span className="mt-3 block text-[14px] font-medium text-accent">Read more</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CtaBand({ heading = "Talk through your deal with an advisor" }: { heading?: string }) {
  return (
    <section className="bento-pro on-dark mt-14 p-8 text-white md:p-10">
      <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{heading}</h2>
      <p className="mt-3 max-w-2xl text-[16px] text-white/80">
        Size the loan in 60 seconds, or send the basics and a licensed Kubera advisor reviews which programs may fit. Advisor-led, AI-assisted.
      </p>
      <div className="mt-6">
        <CtaLinks />
      </div>
    </section>
  );
}

export function ProgramDisclosures() {
  return (
    <aside aria-label="Disclosures" className="mt-14 space-y-2 border-t border-black/[0.06] pt-6 text-[12px] leading-relaxed text-titanium">
      <p>{disclosures.brokerNotLender}</p>
      <p>{disclosures.indicative}</p>
      <p>{disclosures.timeline}</p>
      <p className="font-medium text-ink/70">{licenseLine()}</p>
    </aside>
  );
}
