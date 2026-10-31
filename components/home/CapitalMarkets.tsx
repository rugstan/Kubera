import { getMarketSnapshot } from "@/lib/rates";
import { ASSUMPTIONS_REVIEWED } from "@/lib/sizing/assumptions";

export async function CapitalMarkets() {
  const snap = await getMarketSnapshot();
  const benchmarks = snap.items.filter((i) => !i.derived);
  const programs = snap.items.filter((i) => i.derived);
  return (
    <section id="rates" className="bg-pro text-white">
      <div className="mx-auto max-w-[1280px] px-5 py-24 md:px-8 md:py-32">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="eyebrow !text-white/50">Capital markets · Pro</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">Today&apos;s rate board.</h2>
          </div>
          <p className="flex items-center gap-2 text-sm text-white/50">
            <span className={`size-2 rounded-full ${snap.live ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden />
            {snap.live ? "Live benchmarks" : "Indicative benchmarks"} as of {snap.asOf} · refreshed every 15 min
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {benchmarks.map((b) => (
            <div key={b.key} className="bento-pro p-6">
              <p className="text-sm text-white/50">{b.label}</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{b.value}</p>
              {b.changeBps !== undefined && (
                <p className={`mt-1 text-sm tabular-nums ${b.changeBps <= 0 ? "text-emerald-400" : "text-rose-300"}`}>
                  {b.changeBps === 0 ? "unch." : `${b.changeBps > 0 ? "+" : ""}${b.changeBps} bp`}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl border border-pro-hairline">
          <table className="w-full text-left">
            <thead className="bg-pro-surface text-[12px] uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-6 py-4 font-medium">Program</th>
                <th className="px-6 py-4 text-right font-medium">Indicative range</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {programs.map((p) => (
                <tr key={p.key}>
                  <td className="px-6 py-4 text-[15px]">{p.label}</td>
                  <td className="px-6 py-4 text-right text-[15px] font-medium tabular-nums text-emerald-400">{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 max-w-3xl text-[11px] leading-relaxed text-white/40">
          Treasury, SOFR, and Prime from the Federal Reserve Bank of St. Louis (FRED). Program ranges are Kubera estimates (benchmark + typical spread, assumptions reviewed {ASSUMPTIONS_REVIEWED}); T = Treasury, S = SOFR, in basis points. Not a rate quote or commitment.
        </p>
      </div>
    </section>
  );
}
