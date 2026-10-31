// Presentational pieces for the reports (server components).

import Link from "next/link";
import { RANGE_LABELS } from "@/lib/reporting/dates";
import { RANGE_KEYS, type RangeKey } from "@/lib/reporting/types";
import { REPORT_VIEWS, REPORT_VIEW_LABELS, type ReportView } from "../_lib/access";

const usdExact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Dollars and cents. */
export const usd = (cents: number): string => usdExact.format(cents / 100);
/** Whole dollars, for loan volumes. */
export const usd0 = (cents: number): string => usdWhole.format(cents / 100);
export const pct = (n: number | null): string => (n === null ? "—" : `${n}%`);
export const days = (n: number | null): string => (n === null ? "—" : `${n}`);

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bento p-5">
      <p className="text-[13px] text-titanium">{label}</p>
      <p className="mt-1 font-display text-[28px] font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-[13px] text-titanium">{hint}</p> : null}
    </div>
  );
}

export function Panel({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="bento p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-[18px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {description ? <p className="mt-1 max-w-3xl text-[14px] text-titanium">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export type Column = { header: string; align?: "right" };

/** A table in a keyboard-scrollable wrapper, with an empty state. */
export function DataTable({ label, columns, rows, empty = "Nothing to show for this period." }: { label: string; columns: Column[]; rows: React.ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className="text-[14px] text-titanium">{empty}</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${label}, scrollable`}>
      <table className="w-full min-w-[32rem] border-collapse text-left text-[14px]">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-hairline text-[13px] text-titanium">
            {columns.map((c) => (
              <th key={c.header} scope="col" className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-hairline last:border-0">
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="px-3 py-2.5 font-medium text-ink">
                    {cell}
                  </th>
                ) : (
                  <td key={j} className={`px-3 py-2.5 tabular-nums text-ink ${columns[j]?.align === "right" ? "text-right" : ""}`}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Decorative share-of-maximum bar next to a number (the number carries the meaning). */
export function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <span aria-hidden="true" className="block h-2 w-full min-w-16 rounded-full bg-black/5">
      <span className="block h-2 rounded-full bg-accent" style={{ width: `${width}%` }} />
    </span>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn"; children: React.ReactNode }) {
  const tones = { neutral: "bg-black/5 text-ink", good: "badge-emerald", warn: "badge-gold" } as const;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${tones[tone]}`}>{children}</span>;
}

const href = (view: ReportView, range: RangeKey) => `/reports?view=${view}&range=${range}`;

export function ViewNav({ view, range }: { view: ReportView; range: RangeKey }) {
  return (
    <nav aria-label="Reports">
      <ul className="flex flex-wrap gap-2">
        {REPORT_VIEWS.map((v) => (
          <li key={v}>
            <Link
              href={href(v, range)}
              aria-current={view === v ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium ${view === v ? "bg-ink text-white" : "border border-black/10 bg-white text-ink"}`}
            >
              {REPORT_VIEW_LABELS[v]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function RangeNav({ view, range }: { view: ReportView; range: RangeKey }) {
  return (
    <nav aria-label="Date range">
      <ul className="flex flex-wrap gap-2">
        {RANGE_KEYS.map((r) => (
          <li key={r}>
            <Link
              href={href(view, r)}
              aria-current={range === r ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-3.5 text-[13px] font-medium ${range === r ? "bg-accent text-white" : "border border-black/10 bg-white text-ink"}`}
            >
              {RANGE_LABELS[r]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CsvLink({ report, range, children = "Download CSV" }: { report: string; range: RangeKey; children?: React.ReactNode }) {
  return (
    <a href={`/reports/export?report=${report}&range=${range}`} className="pill pill-glass min-h-11 px-4 py-2 text-[14px]" download>
      {children}
    </a>
  );
}
