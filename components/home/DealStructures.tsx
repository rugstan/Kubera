import Link from "next/link";
import { StructureCard } from "@/components/trust/StructureCard";
import { HOME_STRUCTURE_SLUGS, getDealStructure } from "@/content/deal-structures";
import { disclosures } from "@/lib/site";
import { Reveal } from "./Reveal";

export function DealStructures() {
  const structures = HOME_STRUCTURE_SLUGS.map((slug) => getDealStructure(slug)).filter((s) => s !== undefined);
  return (
    <section aria-labelledby="structures-title" className="bg-white py-20 md:py-32">
      <div className="mx-auto max-w-[1280px] px-5 md:px-8">
        <Reveal className="mx-auto max-w-[980px] text-center">
          <p className="eyebrow">Representative structures</p>
          <h2 id="structures-title" className="mt-3 text-headline font-semibold md:text-section">
            How deals like yours are usually structured.
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-[17px] text-titanium md:text-lede">
            Illustrative examples of how we arrange these programs. They are not closed transactions or offers.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-5 md:mt-16 md:grid-cols-2 xl:grid-cols-4">
          {structures.map((s, i) => (
            <Reveal key={s.slug} delay={i * 0.05}>
              <StructureCard structure={s} />
            </Reveal>
          ))}
        </div>
        <p className="mt-6 text-[12px] leading-relaxed text-titanium">
          {disclosures.illustrative}{" "}
          <Link href="/structures" className="font-medium text-accent underline underline-offset-2">
            Compare all representative structures
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
