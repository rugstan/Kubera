"use client";

import { motion } from "motion/react";
import { usd } from "@/lib/sizing/programs";
import { SIZER_CONSTRAINT_COPY, isInterim } from "@/lib/sizing/programs/quote";
import type { ExitResult, SizerQuote, StackLayer } from "@/lib/sizing/programs/types";
import { coarseTimeline } from "../timeline";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-[13px] text-ink/70">{label}</dt>
      <dd className={`shrink-0 text-right tabular-nums ${strong ? "text-[15px] font-semibold text-ink" : "text-[14px] text-ink"}`}>{value}</dd>
    </div>
  );
}

const EXIT_STYLE: Record<ExitResult, { label: string; className: string }> = {
  PASS: { label: "Passes", className: "badge-success" },
  MARGINAL: { label: "Marginal", className: "badge-warning" },
  FAIL: { label: "Falls short", className: "badge-danger" },
};

// Layer fills use the design tokens; the list beside the bar carries the numbers for screen readers.
const LAYER_FILL: Record<StackLayer["kind"], string> = {
  SENIOR: "bg-accent-fill",
  C_PACE: "bg-accent-fill/60",
  MEZZANINE: "bg-accent-hover",
  PREFERRED_EQUITY: "bg-ink/50",
  COMMON_EQUITY: "bg-ink/20",
};

// A 2px surface-colored seam on each segment's left edge. A shadow, not a flex gap or border, so segment widths stay exactly proportional to the numbers beside the bar.
const SEGMENT_GAP = "shadow-[-2px_0_0_var(--color-surface)]";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function badgeFor(q: SizerQuote): string | null {
  if (q.accent === "gold") return q.id.startsWith("HUD") ? "Non-recourse · Long-term" : "Institutional";
  if (isInterim(q)) return "Short-term";
  return null;
}

// An ineligible card is marked by a flat canvas fill and a dashed outline, not by
// fading: opacity dropped titanium text to 2.9:1 (WCAG 1.4.3). The utilities
// layer overrides the white card and shadow that .bento gets on a canvas section.
const INELIGIBLE = "bg-canvas shadow-none outline-1 outline-dashed outline-field-border -outline-offset-1";

/** A quote card for every sizer box: the original fields plus term-sheet detail, capital stack and exit test. */
export function ProgramCard({ q, best, index }: { q: SizerQuote; best: boolean; index: number }) {
  const interestOnly = q.tranches.length > 0 && q.tranches.every((t) => t.amortYears === 0);
  const badge = badgeFor(q);
  return (
    <motion.article
      layout
      // No entrance state: cards must be visible in the server HTML.
      initial={false}
      transition={{ type: "spring", stiffness: 260, damping: 30, delay: index * 0.05 }}
      // Blue marks only what can be pressed, so the best-fit card and badge are ink.
      className={`bento relative flex flex-col p-6 ${best ? "ring-2 ring-ink" : ""} ${q.eligible ? "" : INELIGIBLE}`}
      aria-label={`${q.name} quote`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {best && <span className="rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-semibold text-white">Best fit</span>}
        {badge && <span className={`${badge === "Short-term" ? "bg-black/[0.05] text-ink/80" : "badge"} rounded-full px-2.5 py-0.5 text-[11px] font-semibold`}>{badge}</span>}
        {!q.eligible && <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-graphite">Not a fit</span>}
      </div>
      <h3 className="mt-3 text-xl font-semibold">{q.name}</h3>
      <p className="text-[13px] text-titanium">{q.short}</p>

      {q.eligible ? (
        <>
          <p className="mt-5 text-[34px] font-semibold leading-none tracking-tight tabular-nums">{usd(q.loanAmount)}</p>
          <p className="mt-1.5 text-[13px] text-titanium">
            {q.ratePct.toFixed(2)}% est. note rate · {q.termLabel}
          </p>
          {q.binding !== "REQUESTED" && <p className="mt-1 text-[12px] text-warning">Limited by {SIZER_CONSTRAINT_COPY[q.binding]}</p>}

          {q.tranches.length > 1 && (
            <ul className="mt-4 space-y-1.5 rounded-2xl bg-black/[0.03] p-3 text-[12px]">
              {q.tranches.map((t) => (
                <li key={t.label}>
                  <p className="text-ink/70">{t.label}</p>
                  <p className="tabular-nums text-ink">{usd(t.amount)} <span className="text-titanium">at</span> {t.ratePct.toFixed(2)}%</p>
                </li>
              ))}
            </ul>
          )}

          <dl className="mt-4 divide-y divide-black/[0.05] border-y border-black/[0.05]">
            <Row label={interestOnly ? "Interest monthly (fully funded)" : "P&I monthly"} value={usd(q.monthlyPrincipalInterest)} />
            <Row label={interestOnly ? "Interest annual" : "P&I annual"} value={usd(q.annualPrincipalInterest)} />
            {q.annualFee.amount > 0 && <Row label={q.annualFee.label} value={`${usd(q.annualFee.amount)} / yr`} />}
            {q.annualAudit > 0 && <Row label="Annual CPA audit" value={`${usd(q.annualAudit)} / yr`} />}
            <Row label="All-in annual cost" value={usd(q.annualAllIn)} strong />
            <Row label="Est. closing costs" value={usd(q.closingCosts)} strong />
          </dl>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ["DSCR", q.dscr > 0 ? `${q.dscr.toFixed(2)}x` : "—"],
              [q.leverageBasis, `${(q.ltv * 100).toFixed(0)}%`],
              ["Debt yield", q.debtYield > 0 ? `${(q.debtYield * 100).toFixed(1)}%` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-black/[0.03] py-2">
                <p className="text-[11px] uppercase tracking-wider text-graphite">{k}</p>
                <p className="text-sm font-medium tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-1 text-[12px] text-ink/70">
            <p><span className="text-titanium">Recourse:</span> {q.recourse}</p>
            <p><span className="text-titanium">Amortization:</span> {q.amortLabel}</p>
            <p><span className="text-titanium">Typical close:</span> {coarseTimeline(q.closeTimeline)}</p>
            {q.equityRequired !== undefined && <p><span className="text-titanium">Equity required:</span> {usd(q.equityRequired)}</p>}
          </div>

          {q.stack && q.stack.layers.length > 0 && (
            <section className="mt-4" aria-label="Capital stack">
              <p className="text-[12px] font-medium text-ink">Capital stack · {usd(q.stack.totalCost)}</p>
              <div aria-hidden className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-black/[0.05]">
                {q.stack.layers.map((l) => (
                  <span key={l.kind} className={`${LAYER_FILL[l.kind]} ${SEGMENT_GAP}`} style={{ width: `${Math.max(0, l.pctOfCost * 100)}%` }} />
                ))}
              </div>
              <dl className="mt-2 space-y-1 text-[12px]">
                {q.stack.layers.map((l) => (
                  <div key={l.kind} className="flex items-baseline justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-ink/70">
                      <span aria-hidden className={`inline-block size-2 rounded-full ${LAYER_FILL[l.kind]}`} />
                      {l.label}
                    </dt>
                    <dd className="tabular-nums">
                      {usd(l.amount)} <span className="text-titanium">· {pct(l.pctOfCost)}{l.costPct !== null ? ` · ${l.costPct.toFixed(2)}%` : ""}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {q.exit && (
            <section className="mt-4 rounded-2xl bg-black/[0.03] p-3 text-[12px]" aria-label={q.exit.label}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-ink">{q.exit.label}</p>
                <span className={`${EXIT_STYLE[q.exit.result].className} rounded-full px-2 py-0.5 text-[11px] font-semibold`}>{EXIT_STYLE[q.exit.result].label}</span>
              </div>
              <dl className="mt-2 space-y-1">
                {q.exit.lines.map((l) => (
                  <div key={l.label} className="flex justify-between gap-3">
                    <dt className="text-ink/70">{l.label}</dt>
                    <dd className="text-right tabular-nums">{l.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {q.terms && q.terms.length > 0 && (
            <details className="group mt-4 text-[12px]">
              <summary className="cursor-pointer list-none font-medium text-accent max-md:flex max-md:min-h-9 max-md:items-center">
                <span className="group-open:hidden">Show term sheet detail</span>
                <span className="hidden group-open:inline">Hide term sheet detail</span>
              </summary>
              <dl className="mt-2 space-y-1">
                {q.terms.map((t) => (
                  <div key={t.label} className="flex justify-between gap-3">
                    <dt className="text-ink/70">{t.label}</dt>
                    <dd className="text-right tabular-nums">{t.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}

          <details className="group mt-3 text-[12px]">
            <summary className="cursor-pointer list-none font-medium text-accent max-md:flex max-md:min-h-9 max-md:items-center">
              <span className="group-open:hidden">Show closing cost detail</span>
              <span className="hidden group-open:inline">Hide closing cost detail</span>
            </summary>
            <dl className="mt-2 space-y-1">
              {q.closingBreakdown.map((l) => (
                <div key={l.label} className="flex justify-between gap-3">
                  <dt className="text-ink/70">{l.label}</dt>
                  <dd className="tabular-nums">{usd(l.amount)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      ) : (
        <p className="mt-5 text-sm text-ink/70">This structure doesn&apos;t fit the profile you entered.</p>
      )}

      {(q.warnings.length > 0 || q.notes.length > 0) && (
        <ul className="mt-4 space-y-1.5 border-t border-black/[0.05] pt-4 text-[12px] leading-snug">
          {q.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-warning"><span aria-hidden>•</span>{w}</li>
          ))}
          {q.notes.map((n) => (
            <li key={n} className="flex gap-2 text-titanium"><span aria-hidden>•</span>{n}</li>
          ))}
        </ul>
      )}
    </motion.article>
  );
}
