import { DEAL_PROGRAM_LABELS, OPEN_DEAL_STATUSES, dealPrograms, type DealProgram } from "@/lib/deals/types";
import { PIPELINE_STAGES, STAGE_LABELS, isTerminalStage, programStageOrder } from "@/lib/deals/stage-catalog";
import { inWindow, laDate } from "./dates";
import type { ReportDeal, ReportWindow, StageEntry } from "./types";

// Pipeline by stage and program, outcomes in the window, and the stage funnel.

export const stageLabelOf = (stage: string): string => STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");

export const isOpen = (d: Pick<ReportDeal, "status" | "stage">): boolean => (OPEN_DEAL_STATUSES as readonly string[]).includes(d.status) && !isTerminalStage(d.stage);

const programLabel = (p: string | null): string => (p && p in DEAL_PROGRAM_LABELS ? DEAL_PROGRAM_LABELS[p as DealProgram] : (p ?? "No program set"));

export type StageRow = { stage: string; label: string; open: number; openAmountCents: number };
export type ProgramRow = { program: string; label: string; open: number; openAmountCents: number; won: number; wonAmountCents: number; lost: number; withdrawn: number };

export type PipelineReport = {
  openDeals: number;
  openAmountCents: number;
  byStage: StageRow[];
  byProgram: ProgramRow[];
  /** Deals settled in the window (won by closing date, lost/withdrawn by the day they left the pipeline). */
  outcomes: { won: number; wonAmountCents: number; lost: number; withdrawn: number; winRatePct: number | null };
};

const outcomeDate = (d: ReportDeal): string => laDate(d.status === "won" ? (d.closedOn ?? d.stageEnteredAt ?? d.createdAt) : (d.stageEnteredAt ?? d.createdAt));

export function pipelineReport(deals: readonly ReportDeal[], window: ReportWindow): PipelineReport {
  const open = deals.filter(isOpen);
  const amount = (d: ReportDeal) => d.loanAmountCents ?? 0;

  const stageMap = new Map<string, StageRow>();
  for (const d of open) {
    const row = stageMap.get(d.stage) ?? { stage: d.stage, label: stageLabelOf(d.stage), open: 0, openAmountCents: 0 };
    row.open += 1;
    row.openAmountCents += amount(d);
    stageMap.set(d.stage, row);
  }
  const order = new Map(PIPELINE_STAGES.map((s, i) => [s.key, i]));
  const byStage = [...stageMap.values()].sort((a, b) => (order.get(a.stage) ?? 999) - (order.get(b.stage) ?? 999) || a.stage.localeCompare(b.stage));

  const programMap = new Map<string, ProgramRow>();
  const prog = (key: string | null): ProgramRow => {
    const k = key ?? "";
    let row = programMap.get(k);
    if (!row) {
      row = { program: k, label: programLabel(key), open: 0, openAmountCents: 0, won: 0, wonAmountCents: 0, lost: 0, withdrawn: 0 };
      programMap.set(k, row);
    }
    return row;
  };
  for (const d of open) {
    const row = prog(d.program);
    row.open += 1;
    row.openAmountCents += amount(d);
  }
  let won = 0;
  let wonAmountCents = 0;
  let lost = 0;
  let withdrawn = 0;
  for (const d of deals) {
    if (d.status !== "won" && d.status !== "lost" && d.status !== "withdrawn") continue;
    if (!inWindow(outcomeDate(d), window)) continue;
    const row = prog(d.program);
    if (d.status === "won") {
      won += 1;
      wonAmountCents += amount(d);
      row.won += 1;
      row.wonAmountCents += amount(d);
    } else if (d.status === "lost") {
      lost += 1;
      row.lost += 1;
    } else {
      withdrawn += 1;
      row.withdrawn += 1;
    }
  }
  const programOrder = new Map<string, number>(dealPrograms.map((p, i) => [p, i]));
  const byProgram = [...programMap.values()].sort((a, b) => (programOrder.get(a.program) ?? 999) - (programOrder.get(b.program) ?? 999));

  const settled = won + lost + withdrawn;
  return {
    openDeals: open.length,
    openAmountCents: open.reduce((s, d) => s + amount(d), 0),
    byStage,
    byProgram,
    outcomes: { won, wonAmountCents, lost, withdrawn, winRatePct: settled === 0 ? null : Math.round((won / settled) * 1000) / 10 },
  };
}

// --- Funnel -------------------------------------------------------------------------------

/** Milestones every program's template shares, in order. */
export const FUNNEL_STAGES = ["intake", "engaged", "packaging", "lender_outreach", "term_sheet", "closing", "closed"] as const;

export type FunnelRow = { stage: string; label: string; reached: number; /** Share of the previous milestone that reached this one. */ conversionPct: number | null };

/**
 * Of the deals opened in the window, how many ever reached each milestone.
 * A deal's reach comes from its recorded stage entries; a deal with none is
 * taken to have passed every stage of its program's template before the one
 * it is in now.
 */
export function funnelReport(deals: readonly ReportDeal[], entries: readonly StageEntry[], window: ReportWindow): FunnelRow[] {
  const byDeal = new Map<string, Set<string>>();
  for (const e of entries) (byDeal.get(e.dealId) ?? byDeal.set(e.dealId, new Set()).get(e.dealId)!).add(e.stage);

  const cohort = deals.filter((d) => inWindow(laDate(d.createdAt), window));
  const reached = new Map<string, number>(FUNNEL_STAGES.map((s) => [s, 0]));
  for (const d of cohort) {
    const seen = new Set(byDeal.get(d.id) ?? []);
    seen.add(d.stage);
    if (!byDeal.has(d.id) && d.program && (dealPrograms as readonly string[]).includes(d.program)) {
      for (const s of programStageOrder(d.program as DealProgram)) {
        if (s === d.stage) break;
        if (!isTerminalStage(s)) seen.add(s);
      }
    }
    // Reaching closed means every earlier milestone was passed, whatever the entries say.
    if (seen.has("closed")) for (const s of FUNNEL_STAGES) seen.add(s);
    for (const s of FUNNEL_STAGES) if (seen.has(s)) reached.set(s, reached.get(s)! + 1);
  }
  return FUNNEL_STAGES.map((stage, i) => {
    const n = reached.get(stage)!;
    const prev = i === 0 ? null : reached.get(FUNNEL_STAGES[i - 1]!)!;
    return { stage, label: stageLabelOf(stage), reached: n, conversionPct: prev === null || prev === 0 ? null : Math.round((n / prev) * 1000) / 10 };
  });
}
