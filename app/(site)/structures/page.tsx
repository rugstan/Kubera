import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { LicenseFootnote, PageShell, Section } from "@/components/trust/PageShell";
import { StructureCard } from "@/components/trust/StructureCard";
import { webPageSchema } from "@/components/trust/schemas";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import { TRUST_PAGES } from "@/content/trust-pages";
import { pageMetadata } from "@/lib/seo/metadata";
import { disclosures, licenseLine } from "@/lib/site";

const meta = TRUST_PAGES.structures;

export const metadata: Metadata = pageMetadata({ title: meta.title, description: meta.description, path: meta.path });

export default function StructuresPage() {
  return (
    <PageShell
      eyebrow="Representative structures"
      title="How these programs are typically arranged."
      intro={
        <p>
          Four illustrative examples across senior living and hospitality. They show the reasoning behind a structure, not results we have delivered. {disclosures.illustrative}
        </p>
      }
      breadcrumb={[{ href: meta.path, label: "Representative structures" }]}
    >
      <JsonLd
        data={[
          webPageSchema({ path: meta.path, name: "Representative loan structures", description: meta.description }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Representative structures", path: meta.path },
          ]),
        ]}
      />

      <Section id="structures" title="Four illustrative structures">
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {DEAL_STRUCTURES.map((s) => (
            <li key={s.slug}>
              <StructureCard structure={s} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="next" title="Looking at a similar deal?">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href="/#sizer" className="pill pill-primary">Size your loan</Link>
          <Link href="/express" className="pill pill-glass">Start the 60-second qualifier</Link>
          <Link href="/track-record" className="pill pill-glass">How we report closed deals</Link>
        </div>
      </Section>

      <LicenseFootnote>
        {disclosures.indicative} {licenseLine()}
      </LicenseFootnote>
    </PageShell>
  );
}
