import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { LicenseFootnote, PageShell, Section } from "@/components/trust/PageShell";
import { webPageSchema } from "@/components/trust/schemas";
import { callLink } from "@/content/contact";
import { DEAL_STRUCTURES, formatUsd, getDealStructure, structurePath } from "@/content/deal-structures";
import { TRUST_PAGES } from "@/content/trust-pages";
import { ASSUMPTIONS_REVIEWED } from "@/lib/sizing/assumptions";
import { pageMetadata } from "@/lib/seo/metadata";
import { disclosures, licenseLine } from "@/lib/site";

// The rates job (app/api/cron/rates) expires the "rates" cache tag, which the
// rate ticker in app/(site)/layout.tsx uses, so this page is rendered again
// on the next visit. It awaits `params` above any <Suspense>; with Partial
// Prefetching that render fails (NEXT_STATIC_GEN_BAILOUT, a 500) unless the
// route may wait for its params, like `fallback: 'blocking'`.
export const instant = false;

// With Cache Components every slug must be listed up front; unknown slugs 404.
export function generateStaticParams() {
  return DEAL_STRUCTURES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = getDealStructure(slug);
  // An unknown slug is a 404, not a page with empty metadata.
  if (!s) notFound();
  return pageMetadata({ title: s.metaTitle, description: s.summary, path: structurePath(s.slug) });
}

export default async function StructurePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getDealStructure(slug);
  if (!s) notFound();
  const call = callLink();
  const path = structurePath(s.slug);
  const others = DEAL_STRUCTURES.filter((o) => o.slug !== s.slug);

  return (
    <PageShell
      eyebrow={`Illustrative structure · ${s.program}`}
      title={`${s.amount} ${s.asset}`}
      intro={<p>{s.situation}</p>}
      breadcrumb={[
        { href: TRUST_PAGES.structures.path, label: "Representative structures" },
        { href: path, label: s.asset },
      ]}
    >
      <JsonLd
        data={[
          webPageSchema({ path, name: `${s.asset}: ${s.program}`, description: s.summary }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Representative structures", path: TRUST_PAGES.structures.path },
            { name: s.asset, path },
          ]),
        ]}
      />

      <p role="note" className="notice max-w-3xl rounded-2xl px-5 py-4 text-[14px] leading-relaxed">
        <strong className="font-semibold">Illustrative example.</strong> {disclosures.illustrative} This is not a closed transaction and not an offer or commitment to lend.
      </p>

      <Section id="why" title="Why this structure">
        <ul className="grid gap-5 md:grid-cols-3">
          {s.reasons.map((r) => (
            <li key={r} className="bento p-7 text-[15px] leading-relaxed text-titanium">{r}</li>
          ))}
        </ul>
      </Section>

      {s.stack && (
        <Section id="stack" title={s.stack.title} lead={`Illustrative amounts on ${formatUsd(s.amountUsd)} of total cost.`}>
          <div role="region" aria-label={`${s.stack.title} (scrollable table)`} tabIndex={0} className="bento overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-[15px]">
              <caption className="sr-only">{s.stack.title}</caption>
              <thead>
                <tr className="border-b border-black/10">
                  <th scope="col" className="px-6 py-3 font-semibold">Source</th>
                  <th scope="col" className="px-6 py-3 text-right font-semibold">Amount</th>
                  <th scope="col" className="px-6 py-3 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {s.stack.lines.map((l) => (
                  <tr key={l.label} className="border-b border-black/[0.06]">
                    <th scope="row" className="px-6 py-4 text-left font-medium">
                      {l.label}
                      {l.note && <span className="mt-0.5 block text-[13px] font-normal text-titanium">{l.note}</span>}
                    </th>
                    <td className="px-6 py-4 text-right tabular-nums">{formatUsd(l.amountUsd)}</td>
                    <td className="px-6 py-4 text-right tabular-nums">{(l.share * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="px-6 py-4 text-left font-semibold">Total</th>
                  <td className="px-6 py-4 text-right font-semibold tabular-nums">{formatUsd(s.amountUsd)}</td>
                  <td className="px-6 py-4 text-right font-semibold tabular-nums">100.0%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-titanium">{s.stack.footnote}</p>
        </Section>
      )}

      <Section id="parameters" title="Program parameters used" lead={`Taken from the sizer's assumptions, reviewed ${ASSUMPTIONS_REVIEWED}. Programs change by notice; an advisor confirms current rules before you rely on any figure.`}>
        <div className="bento overflow-hidden">
          <dl className="divide-y divide-black/[0.06] text-[15px]">
            {s.facts.map((f) => (
              <div key={f.label} className="grid gap-1 px-6 py-4 sm:grid-cols-[1fr_1fr] sm:gap-6">
                <dt className="font-medium text-ink">{f.label}</dt>
                <dd className="text-titanium">
                  <span className="font-medium text-ink">{f.value}</span>
                  {f.note && <span className="mt-0.5 block text-[13px]">{f.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-4 max-w-3xl text-[13px] text-titanium">{disclosures.timeline}</p>
      </Section>

      <Section id="steps" title="How it typically unfolds">
        <ol className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {s.steps.map((step, i) => (
            <li key={step.title} className="bento p-7">
              <p className="text-sm font-semibold text-titanium">Step {i + 1}</p>
              <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-titanium">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="watch" title="What a lender will look at closely">
        <ul className="max-w-3xl list-disc space-y-2 pl-6 text-[16px] leading-relaxed text-titanium">
          {s.watch.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </Section>

      <Section id="next" title="Have a similar property?">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {s.related.map((l, i) => (
            <Link key={l.href} href={l.href} className={i === 0 ? "pill pill-primary" : "pill pill-glass"}>
              {l.label}
            </Link>
          ))}
          <Link href={call.href} className="pill pill-glass">
            {call.label}
          </Link>
        </div>
      </Section>

      <Section id="more" title="Other representative structures">
        <ul className="grid gap-3 md:grid-cols-3">
          {others.map((o) => (
            <li key={o.slug}>
              <Link href={structurePath(o.slug)} className="bento block p-5 text-[15px]">
                <span className="font-semibold">{o.amount} {o.asset}</span>
                <span className="mt-1 block text-accent">{o.program}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <LicenseFootnote>
        {disclosures.indicative} {licenseLine()}
      </LicenseFootnote>
    </PageShell>
  );
}
