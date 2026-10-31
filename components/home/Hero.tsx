import Link from "next/link";
import { Reveal } from "./Reveal";

const PROOF = [
  { k: "35–40 yr", v: "HUD 232 fixed, non-recourse" },
  { k: "$20M+", v: "SBA 504 + 7(a) hotel stacks" },
  { k: "10–21 days", v: "Typical private bridge close" },
  { k: "60 sec", v: "AI loan sizing & routing" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[640px] max-w-5xl rounded-full bg-[radial-gradient(closest-side,rgba(5,150,105,0.10),transparent),radial-gradient(closest-side,rgba(212,175,55,0.10),transparent)] bg-[length:60%_100%,50%_90%] bg-[position:15%_0,90%_30%] bg-no-repeat blur-2xl" />
      <div className="relative mx-auto max-w-[1280px] px-5 pb-24 pt-20 text-center md:px-8 md:pb-32 md:pt-28">
        <Reveal>
          <p className="eyebrow">Kubera Commercial · Autonomous Debt Advisory</p>
          <h1 className="mx-auto mt-5 max-w-5xl text-5xl font-semibold leading-[1.06] tracking-tight md:text-7xl">
            Institutional Capital for Senior Living, <span className="gold-text">Hospitality</span> &amp; Commercial Real Estate.
          </h1>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-titanium md:text-xl">
            From 35-year non-recourse HUD 232 loans and $20M+ SBA 504 hotel stacks to fast PIP bridge and multifamily financing. Engineered with autonomous underwriting intelligence.
          </p>
        </Reveal>
        <Reveal delay={0.16}>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/#sizer" className="pill pill-primary">Size Your Loan in 60 Seconds</Link>
            <Link href="/partners" className="pill pill-glass">Wholesale Lender &amp; Partner Portal</Link>
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
