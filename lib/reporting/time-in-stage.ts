import { PIPELINE_STAGES, isTerminalStage } from "@/lib/deals/stage-catalog";
import { daysBetween, inWindow, laDate, mean, percentile, round1 } from "./dates";
import { isOpen, stageLabelOf } from "./pipeline";
import type { ReportDeal, ReportWindow, StageEntry } from "./types";

// Time in stage. A "visit" is one stretch a deal spent in a stage, from the
// audit entry that put it there to the entry that moved it on. Completed
// visits that ended in the window feed the averages; visits still running are
// counted as open and aged to now.

export type Visit = { dealId: string; stage: string; enteredAt: string; /** Null while the deal is still there. */ exitedAt: string | null };

/** A deal sitting in a stage this many days is called stale when the stage has no history yet. */
export const DEFAULT_STALE_DAYS = 30;
/** Stale means longer than this multiple of the stage's median visit. */
export const STALE_MEDIAN_MULTIPLE = 2;
/** Fewest completed visits before a stage's own median is trusted. */
export const MIN_VISITS_FOR_MEDIAN = 3;

/** Builds every deal's visits from the audit entries, repairing gaps from the deal row. */
export function buildVisits(deals: readonly ReportDeal[], entries: readonly StageEntry[]): Visit[] {
  const byDeal = new Map<string, StageEntry[]>();
  for (const e of entries) (byDeal.get(e.dealId) ?? byDeal.set(e.dealId, []).get(e.dealId)!).push(e);

  const visits: Visit[] = [];
  for (const d of deals) {
    const seq = [...(byDeal.get(d.id) ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    // The row is the truth for where the deal is now.
    if (seq.at(-1)?.stage !== d.stage) seq.push({ dealId: d.id, stage: d.stage, at: d.stageEnteredAt ?? seq.at(-1)?.at ?? d.createdAt });
    // Collapse repeats (an edit that rewrote the same stage).
    const steps = seq.filter((e, i) => i === 0 || e.stage !== seq[i - 1]!.stage);
    steps.forEach((e, i) => {
      const next = steps[i + 1];
      if (isTerminalStage(e.stage)) return; // closed, lost and withdrawn are outcomes, not stages deals wait in
      visits.push({ dealId: d.id, stage: e.stage, enteredAt: e.at, exitedAt: next ? next.at : null });
    });
  }
  return visits;
}

export type StageTimeRow = {
  stage: string;
  label: string;
  /** Visits that ended in the window. */
  completed: number;
  meanDays: number | null;
  medianDays: number | null;
  p90Days: number | null;
  /** Deals in the stage now. */
  open: number;
  oldestOpenDays: number | null;
};

export type AgingDeal = { dealId: string; title: string; program: string | null; stage: string; label: string; days: number; /** Median of completed visits for the stage, when known. */ medianDays: number | null; thresholdDays: number };

export type TimeInStageReport = { rows: StageTimeRow[]; aging: AgingDeal[] };

export function timeInStageReport(deals: readonly ReportDeal[], entries: readonly StageEntry[], window: ReportWindow, now: Date): TimeInStageReport {
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const visits = buildVisits(deals, entries);

  const completed = new Map<string, number[]>();
  const openAges = new Map<string, { dealId: string; days: number }[]>();
  for (const v of visits) {
    if (v.exitedAt) {
      if (!inWindow(laDate(v.exitedAt), window)) continue;
      (completed.get(v.stage) ?? completed.set(v.stage, []).get(v.stage)!).push(daysBetween(v.enteredAt, v.exitedAt));
    } else if (isOpen(dealById.get(v.dealId)!)) {
      (openAges.get(v.stage) ?? openAges.set(v.stage, []).get(v.stage)!).push({ dealId: v.dealId, days: daysBetween(v.enteredAt, now) });
    }
  }

  const order = new Map(PIPELINE_STAGES.map((s, i) => [s.key, i]));
  const keys = [...new Set([...completed.keys(), ...openAges.keys()])].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
  const rows: StageTimeRow[] = keys.map((stage) => {
    const done = completed.get(stage) ?? [];
    const open = openAges.get(stage) ?? [];
    const med = percentile(done, 50);
    const p90 = percentile(done, 90);
    const avg = mean(done);
    return {
      stage,
      label: stageLabelOf(stage),
      completed: done.length,
      meanDays: avg === null ? null : round1(avg),
      medianDays: med === null ? null : round1(med),
      p90Days: p90 === null ? null : round1(p90),
      open: open.length,
      oldestOpenDays: open.length ? round1(Math.max(...open.map((o) => o.days))) : null,
    };
  });

  const rowByStage = new Map(rows.map((r) => [r.stage, r]));
  const aging: AgingDeal[] = [];
  for (const [stage, ages] of openAges) {
    const row = rowByStage.get(stage)!;
    const trusted = row.completed >= MIN_VISITS_FOR_MEDIAN && row.medianDays !== null;
    const threshold = trusted ? Math.max(3, round1(row.medianDays! * STALE_MEDIAN_MULTIPLE)) : DEFAULT_STALE_DAYS;
    for (const a of ages) {
      if (a.days <= threshold) continue;
      const d = dealById.get(a.dealId)!;
      aging.push({ dealId: d.id, title: d.title, program: d.program, stage, label: stageLabelOf(stage), days: round1(a.days), medianDays: trusted ? row.medianDays : null, thresholdDays: threshold });
    }
  }
  aging.sort((a, b) => b.days - a.days);
  return { rows, aging };
}
