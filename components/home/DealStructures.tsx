import Link from "next/link";
import { StructureCard } from "@/components/trust/StructureCard";
import { DEAL_STRUCTURES } from "@/content/deal-structures";
import { disclosures } from "@/lib/site";
import { Reveal } from "./Reveal";

export function DealStructures() {
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-24 md:px-8 md:py-32">
      <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <p className="eyebrow">Representative debt structures</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">The right structure is usually not the obvious one.</h2>
        </div>
        <p className="max-w-sm text-[15px] text-titanium">How Kubera typically arranges these programs. Illustrative examples, not closed transactions.</p>
      </Reveal>
      <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {DEAL_STRUCTURES.map((s, i) => (
          <Reveal key={s.slug} delay={i * 0.05}>
            <StructureCard structure={s} />
          </Reveal>
        ))}
      </div>
      <p className="mt-6 text-[12px] text-titanium">
        {disclosures.illustrative}{" "}
        <Link href="/structures" className="font-medium text-accent underline underline-offset-2">
          Compare all representative structures
        </Link>
        .
      </p>
    </section>
  );
}
