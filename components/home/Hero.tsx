import Link from "next/link";
import { Reveal } from "./Reveal";

const PROOF = [
  { k: "35–40 yr", v: "HUD 232 fixed-rate terms, non-recourse" },
  { k: "$20M+", v: "Hotel projects with SBA 7(a) + 504 stacks" },
  { k: "CA DRE", v: "Licensed broker, not the lender" },
  { k: "60 sec", v: "AI-assisted first-pass sizing" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[640px] max-w-5xl rounded-full bg-[radial-gradient(closest-side,rgba(5,150,105,0.10),transparent),radial-gradient(closest-side,rgba(212,175,55,0.10),transparent)] bg-[length:60%_100%,50%_90%] bg-[position:15%_0,90%_30%] bg-no-repeat blur-2xl" />
      <div className="relative mx-auto max-w-[1280px] px-5 pb-24 pt-20 text-center md:px-8 md:pb-32 md:pt-28">
        <Reveal>
          <p className="eyebrow">Kubera Commercial · Advisor-led, AI-assisted debt advisory</p>
          <h1 className="mx-auto mt-5 max-w-5xl text-5xl font-semibold leading-[1.06] tracking-tight md:text-7xl">
            Institutional capital for senior living, <span className="gold-text">hospitality</span> and commercial real estate.
          </h1>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-titanium md:text-xl">
            From 35-year non-recourse HUD 232 loans and SBA 7(a) + 504 stacks for $20M+ hotel projects to PIP bridge and multifamily financing. Licensed advisors lead every deal; AI handles the first-pass sizing so they can focus on structure and lenders.
          </p>
        </Reveal>
        <Reveal delay={0.16}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/#sizer" className="pill pill-primary">Size your loan in 60 seconds</Link>
            <Link href="/partners" className="pill pill-glass">Lender and partner portal</Link>
          </div>
        </Reveal>
        <Reveal delay={0.24}>
          <dl className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-3xl border border-black/[0.06] bg-black/[0.06] md:grid-cols-4">
            {PROOF.map((p) => (
              <div key={p.k} className="bg-white/80 px-4 py-6">
                <dt className="text-2xl font-semibold tracking-tight md:text-3xl">{p.k}</dt>
                <dd className="mt-1 text-[13px] text-titanium">{p.v}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
