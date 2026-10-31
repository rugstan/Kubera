import Link from "next/link";
import { TableScroll } from "@/components/legal/LegalPage";
import { JsonLd } from "@/components/seo/JsonLd";
import { FRED_ATTRIBUTION, RATES_PATH, SERIES, SPREAD_ROWS, fredSeriesUrl, programRange } from "@/content/rates";
import { datasetSchema } from "@/lib/growth/schemas";
import { getMarketSnapshot } from "@/lib/rates";

const pct = (n: number) => `${n.toFixed(2)}%`;

/** The dated part of /rates: reads the cached market snapshot, so it lives inside a Suspense boundary. */
export async function RatesData() {
  const snap = await getMarketSnapshot();
  const changes = new Map(snap.items.map((i) => [i.key, i.changeBps]));
  const changeKey = { fiveYear: "ust5", tenYear: "ust10", sofr30: "sofr", prime: "prime" } as const;
  const asOfLabel = new Date(`${snap.asOf}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <>
      <JsonLd
        data={datasetSchema({
          name: "Commercial real estate loan benchmark rates",
          description: "Daily U.S. Treasury 5-year and 10-year yields, 30-day average SOFR and the bank prime rate, with indicative loan rate ranges for HUD, SBA, agency, CMBS and bridge programs.",
          path: RATES_PATH,
          dateModified: snap.asOf,
          temporalCoverage: snap.asOf,
          creator: { name: "Federal Reserve Bank of St. Louis (FRED)", url: "https://fred.stlouisfed.org/" },
          citation: FRED_ATTRIBUTION,
          variables: SERIES.map((s) => ({ name: s.label, description: s.fredTitle, unitText: "percent", url: fredSeriesUrl(s.seriesId) })),
        })}
      />

      <p className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]" data-rates-as-of={snap.asOf}>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-medium ${snap.live ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
          <span aria-hidden="true" className={`size-1.5 rounded-full ${snap.live ? "bg-emerald-600" : "bg-amber-600"}`} />
          {snap.live ? "Live data" : "Indicative values"}
        </span>
        <span className="text-ink">
          Rates as of <time dateTime={snap.asOf}>{asOfLabel}</time>
        </span>
      </p>
      {!snap.live && (
        <p role="note" className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-[14px] leading-relaxed text-amber-950">
          One or more benchmark series could not be reached, so some figures below are Kubera&apos;s indicative fallbacks rather than the latest published values.
        </p>
      )}

      <section aria-labelledby="benchmarks-heading" className="mt-12">
        <h2 id="benchmarks-heading" className="text-2xl font-semibold tracking-tight md:text-3xl">
          Benchmark rates
        </h2>
        <p className="mt-2 text-[15px] text-titanium">The indexes commercial loans are priced from.</p>
        <div className="bento mt-5 p-2 md:p-4">
          <TableScroll label="Benchmark rates table">
            <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
              <caption className="sr-only">Benchmark rates as of {asOfLabel}</caption>
              <thead>
                <tr className="border-b border-black/10">
                  <th scope="col" className="py-2 pr-4 font-semibold">Benchmark</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Latest</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Daily change</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Used for</th>
                  <th scope="col" className="py-2 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {SERIES.map((s) => {
                  const change = changes.get(changeKey[s.key]);
                  return (
                    <tr key={s.key} className="border-b border-black/[0.06] last:border-0">
                      <th scope="row" className="py-3 pr-4 align-top font-medium text-ink">{s.label}</th>
                      <td className="py-3 pr-4 text-right align-top font-semibold tabular-nums text-ink">{pct(snap.benchmarks[s.key])}</td>
                      <td className="py-3 pr-4 text-right align-top tabular-nums text-titanium">
                        {change === undefined ? "n/a" : change === 0 ? "unchanged" : `${change > 0 ? "up" : "down"} ${Math.abs(change)} bp`}
                      </td>
                      <td className="py-3 pr-4 align-top text-titanium">{s.usedFor}</td>
                      <td className="py-3 align-top text-[13px] text-titanium">
                        <a href={fredSeriesUrl(s.seriesId)} rel="noopener" className="font-medium text-accent underline underline-offset-2">
                          FRED {s.seriesId}
                        </a>
                        <span className="block">{s.publisher}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </section>

      <section aria-labelledby="programs-heading" className="mt-14">
        <h2 id="programs-heading" className="text-2xl font-semibold tracking-tight md:text-3xl">
          Indicative loan rates by program
        </h2>
        <p className="mt-2 text-[15px] text-titanium">
          Each range is the benchmark above plus the spread band Kubera assumes for the program. They are planning estimates, not quotes, and lenders price each loan individually.
        </p>
        <div className="bento mt-5 p-2 md:p-4">
          <TableScroll label="Indicative loan rates table">
            <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
              <caption className="sr-only">Indicative loan rates by program as of {asOfLabel}</caption>
              <thead>
                <tr className="border-b border-black/10">
                  <th scope="col" className="py-2 pr-4 font-semibold">Program</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Indicative range</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Pricing basis</th>
                  <th scope="col" className="py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {SPREAD_ROWS.map((row) => {
                  const r = programRange(row, snap.benchmarks);
                  return (
                    <tr key={row.key} className="border-b border-black/[0.06] last:border-0">
                      <th scope="row" className="py-3 pr-4 align-top font-medium text-ink">{row.label}</th>
                      <td className="py-3 pr-4 text-right align-top font-semibold tabular-nums text-ink">
                        {pct(r.lo)} to {pct(r.hi)}
                      </td>
                      <td className="py-3 pr-4 align-top text-titanium">
                        {row.base} + {row.lo.toFixed(2)} to {row.hi.toFixed(2)} points
                      </td>
                      <td className="py-3 align-top text-[13px] text-titanium">{row.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </div>
        <p className="mt-4 text-[14px] text-titanium">
          Turn a rate into a payment with the <Link href="/calculators/dscr" className="font-medium text-accent underline underline-offset-2">DSCR calculator</Link>, or size a full structure with the{" "}
          <Link href="/#sizer" className="font-medium text-accent underline underline-offset-2">60-second loan sizer</Link>.
        </p>
      </section>

      <p className="mt-10 text-[13px] leading-relaxed text-titanium">{FRED_ATTRIBUTION}</p>
    </>
  );
}

export function RatesSkeleton() {
  return (
    <div aria-hidden="true" className="mt-10 space-y-6">
      <div className="h-6 w-64 rounded-full bg-black/[0.06]" />
      <div className="bento h-56" />
      <div className="bento h-80" />
    </div>
  );
}
