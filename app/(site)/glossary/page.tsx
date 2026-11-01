import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, CtaBand, ProgramDisclosures } from "@/components/program/parts";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/components/seo/schemas";
import { GLOSSARY_META, GLOSSARY_PATH, getTerm, glossaryLetters, learnMoreHref, sortedGlossary } from "@/content/glossary";
import { definedTermSetSchema } from "@/lib/growth/schemas";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({ title: GLOSSARY_META.title, description: GLOSSARY_META.description, path: GLOSSARY_PATH });

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Glossary", path: GLOSSARY_PATH },
];

export default function GlossaryPage() {
  const terms = sortedGlossary();
  const letters = glossaryLetters(terms);
  return (
    <>
      <JsonLd
        data={[
          definedTermSetSchema({
            name: "Kubera Commercial glossary of commercial real estate finance",
            description: GLOSSARY_META.description,
            path: GLOSSARY_PATH,
            terms: terms.map((t) => ({ name: t.alias ? `${t.term} (${t.alias})` : t.term, description: t.definition, anchor: t.slug })),
          }),
          breadcrumbSchema(CRUMBS),
        ]}
      />
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-20">
        <Breadcrumbs items={CRUMBS} />
        <header className="mt-8">
          <p className="eyebrow">Glossary</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Commercial real estate finance glossary</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink/85">
            Plain-English definitions of the terms that decide how much you can borrow and what it costs, from DSCR and debt yield to HUD 232, SBA 504 and California&apos;s rent and property tax rules. Figures match the assumptions behind our loan sizer.
          </p>
        </header>

        <nav aria-label="Jump to letter" className="mt-8">
          <ul className="flex flex-wrap gap-2">
            {letters.map((l) => (
              <li key={l}>
                <a href={`#letter-${l}`} className="pill pill-quiet !min-h-11 !min-w-11 justify-center !px-3">
                  {l}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10">
          {letters.map((letter) => (
            <section key={letter} aria-labelledby={`letter-${letter}`} className="mt-10 first:mt-0">
              <h2 id={`letter-${letter}`} className="scroll-mt-24 border-b border-black/10 pb-2 text-2xl font-semibold tracking-tight">
                {letter}
              </h2>
              <dl className="mt-4 space-y-6">
                {terms
                  .filter((t) => t.term[0]!.toUpperCase() === letter)
                  .map((t) => (
                    <div key={t.slug} id={t.slug} className="scroll-mt-24">
                      <dt className="text-xl font-semibold tracking-tight">
                        {t.term}
                        {t.alias && <span className="font-normal text-titanium"> ({t.alias})</span>}
                      </dt>
                      <dd className="mt-2 text-[16px] leading-relaxed text-ink/85">
                        <p>{t.definition}</p>
                        <p className="mt-2 text-[13px] text-titanium">
                          <span className="eyebrow mr-2">{t.category}</span>
                          {t.learnMore && (
                            <Link href={learnMoreHref(t.learnMore)} className="mr-3 font-medium text-accent underline underline-offset-2">
                              {t.learnMore.startsWith("/calculators") ? "Try the calculator" : "Read about the program"}
                            </Link>
                          )}
                          {t.related && t.related.length > 0 && (
                            <span>
                              See also:{" "}
                              {t.related.map((slug, i) => {
                                const r = getTerm(slug);
                                return r ? (
                                  <span key={slug}>
                                    {i > 0 && ", "}
                                    <a href={`#${r.slug}`} className="text-accent underline underline-offset-2">
                                      {r.alias?.split(",")[0] ?? r.term}
                                    </a>
                                  </span>
                                ) : null;
                              })}
                            </span>
                          )}
                        </p>
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="mt-12 text-[13px] text-titanium">Definitions are general information, not legal, tax or investment advice. Program figures change by notice; confirm current terms with a lender.</p>
        <CtaBand />
        <ProgramDisclosures />
      </div>
    </>
  );
}
