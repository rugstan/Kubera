import Link from "next/link";
import { structurePath, type DealStructure } from "@/content/deal-structures";

/** Card for one illustrative structure. Used on the home page and on /structures. */
export function StructureCard({ structure: s }: { structure: DealStructure }) {
  return (
    <article className="bento flex h-full flex-col p-7">
      <p className={`text-4xl font-semibold tracking-tight ${s.gold ? "gold-text" : ""}`}>{s.amount}</p>
      <h3 className="mt-3 text-lg font-semibold">{s.asset}</h3>
      <p className="text-[15px] font-medium text-accent">{s.program}</p>
      <p className="mt-3 text-[14px] leading-relaxed text-titanium">{s.summary}</p>
      <ul className="mt-6 flex flex-wrap gap-1.5">
        {s.tags.map((t) => (
          <li key={t} className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[12px] text-ink/70">{t}</li>
        ))}
      </ul>
      <Link href={structurePath(s.slug)} className="mt-auto pt-6 text-[14px] font-medium text-accent underline-offset-2 hover:underline">
        See how it is structured<span className="sr-only">: {s.asset}, {s.program}</span>
      </Link>
    </article>
  );
}
