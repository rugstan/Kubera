"use client";

import { motion } from "motion/react";
import { CONSTRAINT_COPY, usd } from "@/lib/sizing/programs";
import type { ProgramQuote } from "@/lib/sizing/types";

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className={`text-[13px] ${muted ? "text-titanium" : "text-ink/70"}`}>{label}</dt>
      <dd className={`shrink-0 text-right tabular-nums ${strong ? "text-[15px] font-semibold text-ink" : "text-[14px] text-ink"}`}>{value}</dd>
    </div>
  );
}

// An ineligible card is marked by a flat canvas fill and a dashed outline, not by
// fading: opacity dropped titanium text to 2.9:1 (WCAG 1.4.3). The utilities
// layer overrides the white card and shadow that .bento gets on a canvas section.
const INELIGIBLE = "bg-canvas shadow-none outline-1 outline-dashed outline-field-border -outline-offset-1";

export function QuoteCard({ q, best, index }: { q: ProgramQuote; best: boolean; index: number }) {
  return (
    <motion.article
      layout
      // No entrance state: cards must be visible in the server HTML (no-JS
      // visitors and crawlers); layout keeps re-sorts animated.
      initial={false}
      transition={{ type: "spring", stiffness: 260, damping: 30, delay: index * 0.05 }}
      className={`bento relative flex flex-col p-6 ${best ? "ring-2 ring-accent-fill" : ""} ${q.eligible ? "" : INELIGIBLE}`}
      aria-label={`${q.name} quote`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {best && <span className="badge-accent rounded-full px-2.5 py-0.5 text-[11px] font-semibold">Best fit</span>}
        {q.accent === "gold" && <span className="badge rounded-full px-2.5 py-0.5 text-[11px] font-semibold">{q.id.startsWith("HUD") ? "Non-recourse · Long-term" : "Institutional"}</span>}
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
          {q.binding !== "REQUESTED" && (
            <p className="mt-1 text-[12px] text-warning">Limited by {CONSTRAINT_COPY[q.binding]}</p>
          )}

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
            <Row label="P&I monthly" value={usd(q.monthlyPrincipalInterest)} />
            <Row label="P&I annual" value={usd(q.annualPrincipalInterest)} />
            <Row label={q.annualFee.label} value={q.annualFee.amount ? `${usd(q.annualFee.amount)} / yr` : "—"} />
            <Row label="Annual CPA audit" value={q.annualAudit ? `${usd(q.annualAudit)} / yr` : "$0"} />
            <Row label="All-in annual cost" value={usd(q.annualAllIn)} strong />
            <Row label="Est. closing costs" value={usd(q.closingCosts)} strong />
          </dl>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ["DSCR", `${q.dscr.toFixed(2)}x`],
              [q.leverageBasis, `${(q.ltv * 100).toFixed(0)}%`],
              ["Debt yield", `${(q.debtYield * 100).toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-black/[0.03] py-2">
                <p className="text-[10px] uppercase tracking-wider text-graphite">{k}</p>
                <p className="text-sm font-medium tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-1 text-[12px] text-ink/70">
            <p><span className="text-titanium">Recourse:</span> {q.recourse}</p>
            <p><span className="text-titanium">Amortization:</span> {q.amortLabel}</p>
            <p><span className="text-titanium">Typical close:</span> {q.closeTimeline}</p>
            {q.equityRequired !== undefined && <p><span className="text-titanium">Equity required:</span> {usd(q.equityRequired)}</p>}
          </div>

          <details className="group mt-4 text-[12px]">
            <summary className="cursor-pointer list-none font-medium text-accent">
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
