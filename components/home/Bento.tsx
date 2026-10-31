import Link from "next/link";
import { Reveal } from "./Reveal";

function Stat({ k, v, gold }: { k: string; v: string; gold?: boolean }) {
  return (
    <div>
      <p className={`text-3xl font-semibold tracking-tight md:text-4xl ${gold ? "gold-text" : ""}`}>{k}</p>
      <p className="mt-1 text-[13px] text-titanium">{v}</p>
    </div>
  );
}

export function Bento() {
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-24 md:px-8 md:py-32">
      <Reveal className="mx-auto max-w-3xl text-center">
        <p className="eyebrow">Core financing verticals</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">Three specialties. One advisory team.</h2>
      </Reveal>

      <div className="mt-16 grid gap-5 md:grid-cols-6">
        <Reveal className="md:col-span-3">
          <article id="senior-living" className="bento flex h-full flex-col p-8 md:p-10">
            <span className="badge-gold w-fit rounded-full px-3 py-1 text-xs font-semibold">HUD 232 LEAN</span>
            <h3 className="mt-5 text-3xl font-semibold tracking-tight">Senior care and healthcare</h3>
            <p className="mt-3 text-[17px] leading-relaxed text-titanium">
              35-year fixed, non-recourse HUD 232/223(f) for stabilized assisted living, memory care, RCFE and SNF — and 40-year terms on new construction. For 6-to-80 bed operators, SBA 504 avoids HUD&apos;s annual audit and heavier closing costs, and often closes in about 60 days after a complete file (timing is not guaranteed).
            </p>
            <div className="mt-auto grid grid-cols-3 gap-4 pt-10">
              <Stat k="35–40" v="Year fixed terms" gold />
              <Stat k="80%" v="Max LTV, 232/223(f)" />
              <Stat k="~60d" v="Typical SBA 504 timeline, not guaranteed" />
            </div>
          </article>
        </Reveal>

        <Reveal className="md:col-span-3" delay={0.06}>
          <article id="hospitality" className="relative flex h-full flex-col overflow-hidden rounded-3xl bg-ink p-8 text-white md:p-10">
            <div aria-hidden className="absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(212,175,55,0.35),transparent)]" />
            <span className="relative w-fit rounded-full border border-gold/50 bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">2026 SBA $10M stack</span>
            <h3 className="relative mt-5 text-3xl font-semibold tracking-tight">Hospitality and hotel capital markets</h3>
            <p className="relative mt-3 text-[17px] leading-relaxed text-white/65">
              Combine SBA 7(a) and 504 for up to $10M of SBA debt alongside a bank first loan — a structure that can finance $15M–$22M+ flagged hotel acquisitions and ground-up builds with 15–20% down, subject to SBA eligibility and lender approval. Plus franchise PIP renovation bridge and non-recourse CMBS.
            </p>
            <div className="relative mt-auto grid grid-cols-3 gap-4 pt-10">
              <Stat k="$22M+" v="Total project size" gold />
              <Stat k="15–20%" v="Equity injection" />
              <Stat k="65%" v="CMBS LTV, non-recourse" />
            </div>
          </article>
        </Reveal>

        <Reveal className="md:col-span-4" delay={0.04}>
          <article className="bento flex h-full flex-col p-8 md:p-10">
            <p className="eyebrow">Conversions</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">Hotel-to-senior-living and multifamily</h3>
            <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-titanium">
              Acquisition-plus-conversion bridge financing for developers repositioning underperforming hotels into licensed assisted living (RCFE) or workforce housing — structured from day one for a HUD 232 or 223(f) takeout once licensed and stabilized.
            </p>
            <ol className="mt-auto flex flex-wrap gap-2 pt-8 text-[13px] font-medium">
              {["Acquire", "Convert & license (Title 22)", "Stabilize census", "HUD takeout"].map((s, i) => (
                <li key={s} className="flex items-center gap-2 rounded-full bg-black/[0.04] px-3 py-1.5">
                  <span className="grid size-5 place-items-center rounded-full bg-ink text-[12px] text-white">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </article>
        </Reveal>

        <Reveal className="md:col-span-2" delay={0.1}>
          <article id="multifamily" className="bento flex h-full flex-col p-8">
            <p className="eyebrow">Private capital · $750k–$25M</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight">Private bridge and hard money</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-titanium">
              Many private loans close in 10–21 days after a complete file, subject to lender approval, appraisal, title and diligence; timing is not guaranteed. Kubera arranges these loans as a California real estate broker; the private lender funds and is the lender of record.
            </p>
            <Link href="/#sizer" className="mt-auto pt-6 text-[15px] font-medium text-accent hover:underline">Size a bridge loan →</Link>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
