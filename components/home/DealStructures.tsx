import { disclosures } from "@/lib/site";
import { Reveal } from "./Reveal";

const STRUCTURES = [
  {
    amount: "$2.5M",
    asset: "58-Bed Assisted Living",
    program: "SBA 504 Refinance",
    detail: "Below HUD's efficient size: 504 avoids six figures of HUD closing costs and the $20k/yr audit.",
    tags: ["25-yr fixed CDC", "Bank 1st", "~60 days"],
  },
  {
    amount: "$14.5M",
    asset: "110-Key Flagged Hotel + PIP",
    program: "SBA 504 Green $5.5M + Bank 1st",
    detail: "Acquisition with the franchise PIP financed in project cost under the energy-efficiency 504 cap.",
    tags: ["Premium flag", "15% equity", "PIP financed"],
    gold: true,
  },
  {
    amount: "$16.8M",
    asset: "96-Bed Memory Care",
    program: "Bridge-to-HUD 232/223(f)",
    detail: "Floating bridge through census lease-up, sized for a 35-year non-recourse HUD takeout.",
    tags: ["Interest-only", "Non-recourse", "HUD exit"],
    gold: true,
  },
  {
    amount: "$9.2M",
    asset: "Boutique Hotel → Assisted Living",
    program: "Conversion Bridge · California",
    detail: "Acquisition plus RCFE conversion budget, with licensing and stabilization milestones built in.",
    tags: ["Title 22 RCFE", "Value-add", "HUD 232 path"],
  },
];

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
        {STRUCTURES.map((s, i) => (
          <Reveal key={s.asset} delay={i * 0.05}>
            <article className="bento flex h-full flex-col p-7">
              <p className={`text-4xl font-semibold tracking-tight ${s.gold ? "gold-text" : ""}`}>{s.amount}</p>
              <h3 className="mt-3 text-lg font-semibold">{s.asset}</h3>
              <p className="text-[15px] font-medium text-accent">{s.program}</p>
              <p className="mt-3 text-[14px] leading-relaxed text-titanium">{s.detail}</p>
              <ul className="mt-auto flex flex-wrap gap-1.5 pt-6">
                {s.tags.map((t) => (
                  <li key={t} className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[12px] text-ink/70">{t}</li>
                ))}
              </ul>
            </article>
          </Reveal>
        ))}
      </div>
      <p className="mt-6 text-[11px] text-titanium">{disclosures.illustrative}</p>
    </section>
  );
}
