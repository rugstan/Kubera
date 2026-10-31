import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, ProgramDisclosures } from "@/components/program/parts";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { FAMILY_LABELS, FINANCING_BASE, financingPath, hubForFamily, PROGRAM_FAMILIES, programsInFamily } from "@/content/programs";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Financing programs",
  description:
    "Every loan program Kubera Commercial arranges: HUD, SBA, CMBS, agency, bridge, construction and hard money for senior living, hotels and multifamily.",
  path: FINANCING_BASE,
});

export default function FinancingIndexPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Financing", path: FINANCING_BASE },
        ])}
      />
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
        <header>
          <p className="eyebrow">Financing</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Financing programs</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">
            Kubera Commercial arranges commercial real estate loans as a licensed California real estate broker. Each page below explains one program: how it works, the figures lenders use, what slows a file down, and which alternatives to compare.
          </p>
        </header>
        {PROGRAM_FAMILIES.map((family) => {
          const hub = hubForFamily(family);
          return (
            <section key={family} aria-labelledby={`${family}-heading`} className="mt-14">
              <h2 id={`${family}-heading`} className="text-2xl font-semibold tracking-tight md:text-3xl">
                <Link href={financingPath(hub.slug)} className="hover:underline">
                  {FAMILY_LABELS[family]}
                </Link>
              </h2>
              <p className="mt-2 text-[15px] text-titanium">{hub.summary}</p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {programsInFamily(family).map((p) => (
                  <li key={p.slug}>
                    <Link href={financingPath(p.slug)} className="bento block h-full p-4 transition hover:shadow-md">
                      <span className="text-[16px] font-semibold text-ink">{p.name}</span>
                      <span className="mt-1 block text-[14px] text-titanium">{p.summary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <CtaBand />
        <ProgramDisclosures />
      </div>
    </>
  );
}
