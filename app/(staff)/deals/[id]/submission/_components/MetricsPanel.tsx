import type { SubmissionMetrics } from "@/lib/deals/submission/types";
import { formatMetricInput, metricValue, needsLine, sourceLabel } from "../_lib/format";
import { SourceTag } from "./SourceTag";

// Computed figures, read-only everywhere: there is no input for a ratio. Each
// shows its value (or what it still needs, never a zero or a guess), the
// "Corin calculation" tag, and a disclosure with the formula and every input
// with its own source.

export function MetricsPanel({ metrics, headingLevel = 2 }: { metrics: SubmissionMetrics; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div>
      <H className="text-base font-semibold text-ink">Computed metrics</H>
      <p className="mt-1 text-xs text-titanium">Calculated from the stored figures; edit the inputs, not the result.</p>
      {metrics.warnings.length ? (
        <ul className="notice-warning mt-3 list-disc rounded-xl py-2 pl-7 pr-3 text-xs">
          {metrics.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {metrics.metrics.length ? (
        <ul aria-label="Computed metrics" className="mt-3 divide-y divide-black/5">
          {metrics.metrics.map((m) => {
            const value = metricValue(m);
            return (
              <li className="py-2.5" data-metric={m.key} key={m.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm text-ink">{m.label}</span>
                  <span className={`text-sm font-semibold tabular-nums ${value ? "text-ink" : "text-titanium"}`}>{value ?? "—"}</span>
                </div>
                {value ? null : <p className="mt-0.5 text-xs text-warning">{needsLine(m)}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <SourceTag calculation />
                  {m.note ? <span className="text-xs text-titanium">{m.note}</span> : null}
                </div>
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer py-1 font-medium text-accent">How this is calculated</summary>
                  <p className="mt-1 text-ink">{m.formula}</p>
                  <ul className="mt-1 space-y-0.5 text-titanium">
                    {m.inputs.map((i) => (
                      <li key={i.field}>
                        {i.label}: <span className="text-ink">{formatMetricInput(i)}</span>
                        {i.value !== null && i.source ? ` (${sourceLabel(i.source)})` : i.field.startsWith("deal.") && i.value !== null ? " (deal record)" : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-titanium">No metrics apply yet.</p>
      )}
    </div>
  );
}
