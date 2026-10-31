// Pipeline row shape and pure helpers shared by the server loader and the
// client table. These are the default stage keys; WS-T stage templates may add
// others, which fall back to a humanized label and sort last.

export const DEAL_STAGES = [
  { key: "intake", label: "Intake" },
  { key: "qualifying", label: "Qualifying" },
  { key: "application", label: "Application" },
  { key: "packaging", label: "Packaging" },
  { key: "lender_outreach", label: "Lender outreach" },
  { key: "term_sheet", label: "Term sheet" },
  { key: "underwriting", label: "Underwriting" },
  { key: "commitment", label: "Commitment" },
  { key: "closing", label: "Closing" },
  { key: "closed", label: "Closed" },
  { key: "lost", label: "Lost" },
] as const;

export type DealStage = (typeof DEAL_STAGES)[number]["key"];

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

export type StageSummary = { stage: string; label: string; count: number; amountUsd: number };

/** Count and loan volume per stage, in lifecycle order, for active deals. */
export function summarizeStages(rows: PipelineRow[]): StageSummary[] {
  const by = new Map<string, StageSummary>();
  for (const r of rows) {
    if (r.status !== "active") continue;
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
