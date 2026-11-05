import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { LicenseFootnote, PageShell, Section } from "@/components/trust/PageShell";
import { StructureCard } from "@/components/trust/StructureCard";
import { webPageSchema } from "@/components/trust/schemas";
import { HEADER_CTA, SIZER_LINK } from "@/components/site/nav";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import { TRUST_PAGES } from "@/content/trust-pages";
import { pageMetadata } from "@/lib/seo/metadata";
import { disclosures, licenseLine } from "@/lib/site";
import { structureImage } from "@/content/images";

const meta = TRUST_PAGES.structures;

export const metadata: Metadata = pageMetadata({ title: meta.title, description: meta.description, path: meta.path, image: structureImage(DEAL_STRUCTURES[0]!.slug) });

export default function StructuresPage() {
  return (
    <PageShell
      eyebrow="Representative structures"
      title="How these programs are typically arranged."
      intro={
        <p>
          Illustrative examples across senior living, hotels, construction and hard money. They show the reasoning behind a structure, not results we have delivered.{" "}
          {disclosures.illustrative}
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

      <Section id="structures" title="Illustrative structures">
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {DEAL_STRUCTURES.map((s) => (
            <li key={s.slug}>
              <StructureCard structure={s} withImage />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="next" title="Looking at a similar deal?">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href={HEADER_CTA.href} className="pill pill-primary">
            {HEADER_CTA.label}
          </Link>
          <Link href={SIZER_LINK.href} className="pill pill-glass">
            {SIZER_LINK.label}
          </Link>
          <Link href="/track-record" className="pill pill-glass">How we report closed deals</Link>
        </div>
      </Section>

      <LicenseFootnote>
        {disclosures.indicative} {licenseLine()}
      </LicenseFootnote>
    </PageShell>
  );
}
