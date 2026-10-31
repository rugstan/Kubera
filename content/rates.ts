// Copy and source metadata for the standalone /rates page. The numbers come
// from getMarketSnapshot() (lib/rates), the same cached feed as the ticker;
// the spread bands come from lib/sizing/assumptions.ts.

import type { Benchmarks } from "@/lib/rates";
import type { SitemapRoute } from "@/lib/seo/sitemap-routes";
import { SPREADS } from "@/lib/sizing/assumptions";

export const RATES_PATH = "/rates";

export const RATES_PAGE = {
  title: "Commercial real estate loan rates today",
  description: "Dated benchmark rates (Treasuries, SOFR, Prime) and indicative HUD, SBA, CMBS and bridge loan rates, updated each business day from FRED.",
} as const;

export type SeriesMeta = {
  key: keyof Benchmarks;
  label: string;
  /** FRED series id. */
  seriesId: string;
  /** FRED's series title. */
  fredTitle: string;
  /** Who publishes the underlying data. */
  publisher: string;
  unit: string;
  frequency: string;
  /** What lenders use it for. */
  usedFor: string;
};

export const SERIES: readonly SeriesMeta[] = [
  {
    key: "fiveYear",
    label: "5-year Treasury",
    seriesId: "DGS5",
    fredTitle: "Market Yield on U.S. Treasury Securities at 5-Year Constant Maturity",
    publisher: "Board of Governors of the Federal Reserve System (US)",
    unit: "Percent, not seasonally adjusted",
    frequency: "Daily",
    usedFor: "SBA bank first-lien loans and shorter fixed-rate bank debt",
  },
  {
    key: "tenYear",
    label: "10-year Treasury",
    seriesId: "DGS10",
    fredTitle: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity",
    publisher: "Board of Governors of the Federal Reserve System (US)",
    unit: "Percent, not seasonally adjusted",
    frequency: "Daily",
    usedFor: "HUD, agency, SBA 504 debenture and hotel CMBS pricing",
  },
  {
    key: "sofr30",
    label: "30-day average SOFR",
    seriesId: "SOFR30DAYAVG",
    fredTitle: "30-Day Average SOFR",
    publisher: "Federal Reserve Bank of New York",
    unit: "Percent, not seasonally adjusted",
    frequency: "Daily",
    usedFor: "Floating-rate bridge and construction loans",
  },
  {
    key: "prime",
    label: "Bank prime rate",
    seriesId: "DPRIME",
    fredTitle: "Bank Prime Loan Rate",
    publisher: "Board of Governors of the Federal Reserve System (US)",
    unit: "Percent, not seasonally adjusted",
    frequency: "Daily",
    usedFor: "SBA 7(a) loans and other prime-based bank loans",
  },
];

export const fredSeriesUrl = (seriesId: string) => `https://fred.stlouisfed.org/series/${seriesId}`;

export const FRED_ATTRIBUTION =
  "Benchmark data: Board of Governors of the Federal Reserve System (US) and the Federal Reserve Bank of New York, retrieved from FRED, Federal Reserve Bank of St. Louis. This page is not endorsed or certified by the Federal Reserve Bank of St. Louis.";

export type SpreadRow = { key: string; label: string; baseKey: keyof Benchmarks; base: string; lo: number; hi: number; note: string };

const BASE_LABEL: Record<keyof Benchmarks, string> = { tenYear: "10-year Treasury", fiveYear: "5-year Treasury", prime: "Prime", sofr30: "30-day SOFR" };

/** The spread bands the estimates use, in percentage points over their benchmark. */
export const SPREAD_ROWS: readonly SpreadRow[] = [
  { key: "hud232", label: "HUD 232 / 223(f) senior housing", ...band(SPREADS.hud232), note: "Note rate; excludes mortgage insurance premium" },
  { key: "hudMultifamily", label: "HUD multifamily (223(f), 221(d)(4))", ...band(SPREADS.hudMultifamily), note: "Note rate; excludes mortgage insurance premium" },
  { key: "agency", label: "Fannie Mae and Freddie Mac multifamily", ...band(SPREADS.agency), note: "Fixed rate, typical 10-year term" },
  { key: "sba504Debenture", label: "SBA 504 debenture", ...band(SPREADS.sba504Debenture), note: "Before SBA and servicing fees" },
  { key: "sba504Effective", label: "SBA 504 effective rate", ...band(SPREADS.sba504Effective), note: "Debenture rate plus ongoing fees" },
  { key: "sbaBankFirst", label: "SBA 504 bank first lien", ...band(SPREADS.sbaBankFirst), note: "Fixed-period bank loan" },
  { key: "sba7a", label: "SBA 7(a)", ...band(SPREADS.sba7a), note: "Variable, over Prime" },
  { key: "hotelCmbs", label: "Hotel CMBS", ...band(SPREADS.hotelCmbs), note: "Conduit fixed rate" },
  { key: "bridge", label: "Private bridge", ...band(SPREADS.bridge), note: "Floating over SOFR, interest-only" },
];

function band(s: { lo: number; hi: number; base: keyof Benchmarks }) {
  return { baseKey: s.base, base: BASE_LABEL[s.base], lo: s.lo, hi: s.hi };
}

/** Indicative range for a program: the benchmark plus the low and high ends of its spread band, in percent. */
export function programRange(row: Pick<SpreadRow, "baseKey" | "lo" | "hi">, b: Benchmarks): { lo: number; hi: number } {
  return { lo: b[row.baseKey] + row.lo, hi: b[row.baseKey] + row.hi };
}

export const ratesRoutes: SitemapRoute[] = [
  {
    path: RATES_PATH,
    title: "Commercial real estate loan rates",
    description: RATES_PAGE.description,
    changeFrequency: "daily",
    priority: 0.8,
    section: "Tools",
  },
];
