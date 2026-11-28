import type { DealSummarySpec } from "@/lib/deals/submission/types";

// The one-page summary as a lender will see it behind the share link (the
// same spec the PDF is rendered from): headline tiles, sections with each
// row's source, tables, how the figures were calculated, and the open items.

export function SummaryView({ spec }: { spec: DealSummarySpec }) {
  return (
    <article aria-labelledby="summary-title" className="space-y-5">
      <header>
        <h3 className="text-lg font-semibold text-ink" id="summary-title">
          {spec.title}
        </h3>
        <p className="text-sm text-titanium">{spec.subtitle}</p>
      </header>
      {spec.headline.length ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {spec.headline.map((h) => (
            <div className="rounded-2xl bg-black/[0.03] p-3" key={h.label}>
              <dt className="text-xs text-titanium">{h.label}</dt>
              <dd className="text-lg font-semibold tabular-nums text-ink">{h.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {spec.sections.map((s) => (
        <section className="min-w-0" key={s.title}>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-titanium">{s.title}</h4>
          {s.rows?.length ? (
            <dl className="mt-2 divide-y divide-black/5 text-sm">
              {s.rows.map((r) => (
                <div className="grid gap-1 py-1.5 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:gap-3" key={`${r.label}${r.value}`}>
                  <dt className="text-titanium">{r.label}</dt>
                  <dd className="min-w-0 break-words text-ink">{r.value}</dd>
                  {r.source ? <dd className="text-xs text-titanium sm:text-right">{r.source}</dd> : null}
                </div>
              ))}
            </dl>
          ) : null}
          {s.paragraphs?.map((p) => (
            <p className="mt-2 whitespace-pre-line break-words text-sm text-ink" key={p}>
              {p}
            </p>
          ))}
          {s.table && s.table.rows.length ? (
            <div aria-label={s.title} className="-mx-1 mt-2 overflow-x-auto" role="region" tabIndex={0}>
              <table className="w-full min-w-[320px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-titanium">
                    {s.table.head.map((h) => (
                      <th className="px-1 py-1.5 font-medium" key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((row, i) => (
                    <tr className="border-b border-black/5" key={i}>
                      {row.map((c, j) => (
                        <td className="px-1 py-1.5" key={j}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}
      {spec.openItems.length ? (
        <section>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-titanium">Not yet in hand</h4>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink">
            {spec.openItems.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {spec.metricNotes.length ? (
        <section>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-titanium">How these figures were calculated</h4>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {spec.metricNotes.map((n) => (
              <li className="break-words" key={n.key}>
                <span className="font-medium">{n.formula}</span>
                <span className="text-titanium"> — {n.inputs.join("; ")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="border-t border-black/10 pt-3 text-xs text-titanium">{spec.footer}</p>
    </article>
  );
}
