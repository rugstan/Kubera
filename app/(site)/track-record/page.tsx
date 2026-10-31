import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { LicenseFootnote, PageShell, Section } from "@/components/trust/PageShell";
import { trackRecordSchemas } from "@/components/trust/schemas";
import { formatUsd } from "@/content/deal-structures";
import { TRUST_PAGES } from "@/content/trust-pages";
import { publishableRecords } from "@/content/track-record";
import { pageMetadata } from "@/lib/seo/metadata";
import { licenseLine } from "@/lib/site";

const meta = TRUST_PAGES.trackRecord;

export const metadata: Metadata = pageMetadata({ title: meta.title, description: meta.description, path: meta.path });

export default function TrackRecordPage() {
  const records = publishableRecords();
  return (
    <PageShell
      eyebrow="Track record"
      title="Closed transactions, reported honestly."
      intro={
        <p>
          We list a transaction here only after it has closed, the client has agreed in writing to be described, and a broker has checked every figure against the closing file.
        </p>
      }
      breadcrumb={[{ href: meta.path, label: "Track record" }]}
    >
      <JsonLd data={trackRecordSchemas({ path: meta.path, name: "Kubera Commercial track record", description: meta.description }, records)} />

      {records.length > 0 ? (
        <Section id="closed" title="Closed transactions">
          <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {records.map((r) => (
              <li key={r.id}>
                <article className="bento flex h-full flex-col p-7">
                  <p className="gold-text text-4xl font-semibold tracking-tight">{formatUsd(r.loanAmountUsd)}</p>
                  <h3 className="mt-3 text-lg font-semibold">{r.assetType}</h3>
                  <p className="text-[15px] font-medium text-accent">{r.program}</p>
                  <p className="mt-3 text-[14px] leading-relaxed text-titanium">{r.summary}</p>
                  <p className="mt-auto pt-6 text-[13px] text-titanium">
                    {r.location}, closed {r.closedYear}
                    {r.lender ? `. Lender of record: ${r.lender}` : ""}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <Section id="closed" title="No closed transactions published yet">
          <div className="bento max-w-3xl p-7">
            <p className="text-[16px] leading-relaxed text-titanium">
              We are not publishing closed deals on this page yet, and we will not fill the space with examples that did not happen. When we have transactions that meet the standard above, they will appear here with the program, size and year.
            </p>
            <p className="mt-4 text-[16px] leading-relaxed text-titanium">
              In the meantime, representative structures show how we typically arrange HUD, SBA and bridge financing. They are illustrations, not client results.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/structures" className="pill pill-primary">See representative structures</Link>
              <Link href="/about#licenses" className="pill pill-glass">Verify our licenses</Link>
            </div>
          </div>
        </Section>
      )}

      <Section id="standard" title="Our publishing standard">
        <ul className="grid gap-5 md:grid-cols-3">
          {[
            { title: "Closed only", body: "Pending, withdrawn and estimated deals are never listed." },
            { title: "Client permission", body: "We publish only what the client has agreed to in writing." },
            { title: "Verified figures", body: "A broker checks the amount, program and year against the closing file." },
          ].map((item) => (
            <li key={item.title} className="bento p-7">
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-titanium">{item.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-3xl text-[13px] text-titanium">
          Past results do not predict future results. Lenders fund loans as lender of record.
        </p>
      </Section>

      <LicenseFootnote>{licenseLine()}</LicenseFootnote>
    </PageShell>
  );
}
