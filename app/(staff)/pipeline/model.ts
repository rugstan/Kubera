// Pipeline row shape and pure helpers shared by the server loader and the
// client table. Stage keys and their order come from the deal desk's stage
// templates (lib/deals/stage-catalog.ts); keys from older rows that no template
// uses fall back to a humanized label and sort last.

import { PIPELINE_STAGES } from "@/lib/deals/stage-catalog";
import { OPEN_DEAL_STATUSES } from "@/lib/deals/types";

export const DEAL_STAGES = PIPELINE_STAGES;

export type DealStage = string;

const STAGE_INDEX = new Map<string, number>(DEAL_STAGES.map((s, i) => [s.key, i]));

export function stageLabel(stage: string): string {
  return DEAL_STAGES.find((s) => s.key === stage)?.label ?? stage.replace(/_/g, " ");
}

/** Sort key that follows the deal lifecycle rather than the alphabet. */
export function stageOrder(stage: string): number {
  return STAGE_INDEX.get(stage) ?? DEAL_STAGES.length;
}

export type MldsStatus = "required" | "generated" | "sent" | "signed" | "held_for_counsel" | null;

export type PipelineRow = {
  id: string;
  name: string;
  program: string | null;
  assetType: string | null;
  stage: string;
  status: string;
  loanAmountUsd: number | null;
  location: string | null;
  ownerName: string | null;
  mldsStatus: MldsStatus;
  pendingApprovals: number;
  /** ISO timestamp. */
  updatedAt: string;
};

/** Still being worked: active or paused by a hold (not won, lost or withdrawn). */
export function isOpenDeal(row: Pick<PipelineRow, "status">): boolean {
  return (OPEN_DEAL_STATUSES as readonly string[]).includes(row.status);
}

export type StageSummary = { stage: string; label: string; count: number; amountUsd: number };

/** Count and loan volume per stage, in lifecycle order, for open deals. */
export function summarizeStages(rows: PipelineRow[]): StageSummary[] {
  const by = new Map<string, StageSummary>();
  for (const r of rows) {
    if (!isOpenDeal(r)) continue;
    const s = by.get(r.stage) ?? { stage: r.stage, label: stageLabel(r.stage), count: 0, amountUsd: 0 };
    s.count += 1;
    s.amountUsd += r.loanAmountUsd ?? 0;
    by.set(r.stage, s);
  }
  return [...by.values()].sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage));
}

export function formatUsd(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return "—";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

export const MLDS_LABELS: Record<NonNullable<MldsStatus>, string> = {
  required: "Required",
  generated: "Generated",
  sent: "Sent",
  signed: "Signed",
  held_for_counsel: "Held for counsel",
};

/** Case-insensitive match across the visible text columns. */
export function matchesQuery(row: PipelineRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.program, row.assetType, row.location, row.ownerName, stageLabel(row.stage)].some((v) => v?.toLowerCase().includes(q));
}
