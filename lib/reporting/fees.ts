import { DEAL_PROGRAM_LABELS, FEE_ENTRY_LABELS, type DealProgram, type FeeEntryKind } from "@/lib/deals/types";
import { PIPELINE_STAGES } from "@/lib/deals/stage-catalog";
import { inWindow, laDate, monthOf, monthsIn } from "./dates";
import { stageLabelOf } from "./pipeline";
import type { ReportDeal, ReportFee, ReportWindow } from "./types";

// Fee forecast from the fee ledger (lib/deals/ledger.ts). All amounts are
// Corin's own compensation in integer cents.
//
//   Corin income   entries with payee = corin (paid by the borrower or the lender)
//   Partner shares  entries Corin owes a co-broker or referral partner (payer = corin)
//   Net             income minus partner shares
//
// Two views:
//   Booked    entries earned, invoiced or settled, by the day they were earned
//   Outlook   what is still to come: earned/invoiced not yet settled (receivable)
//             plus projected entries weighted by how far along their deal is
//
// Void entries never count.

/**
 * Chance, in basis points, that a deal's projected fee is earned, by the stage
 * the deal is in. These are management assumptions for planning (a projected
 * fee on a deal in intake is far less likely than one at firm commitment), not
 * a prediction and not a commitment to anyone; edit them as the desk's own
 * conversion history accumulates (the funnel report shows it).
 */
export const STAGE_PROBABILITY_BP: Readonly<Record<string, number>> = {
  intake: 1000,
  engaged: 2000,
  packaging: 3000,
  lender_outreach: 3500,
  term_sheet: 5500,
  application: 6500,
  third_party_reports: 7500,
  plan_and_cost_review: 7500,
  underwriting: 7500,
  lender_underwriting: 7500,
  hud_review: 8000,
  sba_authorization: 8000,
  commitment: 9000,
  firm_commitment: 9000,
  closing: 9500,
  closed: 10000,
  withdrawn: 0,
  lost: 0,
};

/** Unknown stages are weighted like the middle of the pipeline rather than silently dropped. */
export const DEFAULT_STAGE_PROBABILITY_BP = 5000;

export const stageProbabilityBp = (stage: string | undefined): number => (stage === undefined ? 0 : (STAGE_PROBABILITY_BP[stage] ?? DEFAULT_STAGE_PROBABILITY_BP));

/** `amount` × `bp` / 10,000, rounded half-up to the cent. */
export const weigh = (amountCents: number, bp: number): number => Math.floor((amountCents * bp + 5_000) / 10_000);

export const BOOKED_STATUSES = ["earned", "invoiced", "settled"] as const;
const isBooked = (f: ReportFee) => (BOOKED_STATUSES as readonly string[]).includes(f.status);
const isIncome = (f: ReportFee) => f.payee === "corin";

/** The day a booked entry counts for: the earned date, else the day it was created. */
export const bookingDate = (f: ReportFee): string => f.earnedOn ?? laDate(f.createdAt);

export type Money3 = { grossCents: number; partnerSharesCents: number; netCents: number };
const zero = (): Money3 => ({ grossCents: 0, partnerSharesCents: 0, netCents: 0 });
function add(m: Money3, f: ReportFee) {
  if (isIncome(f)) m.grossCents += f.amountCents;
  else m.partnerSharesCents += f.amountCents;
  m.netCents = m.grossCents - m.partnerSharesCents;
}

export type MonthRow = Money3 & { month: string; settledCents: number };
export type KindRow = Money3 & { kind: FeeEntryKind; label: string };
export type ProgramFeeRow = Money3 & { program: string; label: string };

export type BookedFees = {
  total: Money3;
  /** Income by status: what is settled, invoiced and earned in the window. */
  incomeByStatus: { settled: number; invoiced: number; earned: number };
  byMonth: MonthRow[];
  byKind: KindRow[];
  byProgram: ProgramFeeRow[];
  entries: number;
};

export type StageOutlookRow = { stage: string; label: string; deals: number; probabilityPct: number; projectedCents: number; weightedCents: number; partnerSharesWeightedCents: number };

export type OutlookFees = {
  /** Earned or invoiced income not yet settled (any date). */
  receivableCents: number;
  /** Partner shares Corin owes on earned or invoiced entries not yet settled. */
  receivablePartnerSharesCents: number;
  /** Projected income, unweighted. */
  projectedCents: number;
  /** Projected income weighted by stage probability. */
  weightedProjectedCents: number;
  weightedPartnerSharesCents: number;
  /** receivable + weighted projected income. */
  expectedGrossCents: number;
  /** expected income minus expected partner shares. */
  expectedNetCents: number;
  byStage: StageOutlookRow[];
};

export type FeeReport = { booked: BookedFees; outlook: OutlookFees; voidedCents: number; voidedEntries: number; assumptions: { stageProbabilityBp: Record<string, number>; defaultBp: number } };

const programLabel = (p: string | null): string => (p && p in DEAL_PROGRAM_LABELS ? DEAL_PROGRAM_LABELS[p as DealProgram] : (p ?? "No program set"));

export function feeReport(fees: readonly ReportFee[], deals: readonly ReportDeal[], window: ReportWindow): FeeReport {
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const live = fees.filter((f) => f.status !== "void");

  // --- Booked in the window ---------------------------------------------------------------
  const booked = live.filter((f) => isBooked(f) && inWindow(bookingDate(f), window));
  const total = zero();
  const incomeByStatus = { settled: 0, invoiced: 0, earned: 0 };
  const months = new Map<string, MonthRow>(monthsIn(window).map((m) => [m, { month: m, ...zero(), settledCents: 0 }]));
  const kinds = new Map<FeeEntryKind, KindRow>();
  const programs = new Map<string, ProgramFeeRow>();
  for (const f of booked) {
    add(total, f);
    if (isIncome(f)) incomeByStatus[f.status as "settled" | "invoiced" | "earned"] += f.amountCents;
    const month = months.get(monthOf(bookingDate(f)))!;
    add(month, f);
    if (isIncome(f) && f.status === "settled") month.settledCents += f.amountCents;
    const kind = kinds.get(f.entryKind) ?? { kind: f.entryKind, label: FEE_ENTRY_LABELS[f.entryKind], ...zero() };
    add(kind, f);
    kinds.set(f.entryKind, kind);
    const key = dealById.get(f.dealId)?.program ?? "";
    const program = programs.get(key) ?? { program: key, label: programLabel(key || null), ...zero() };
    add(program, f);
    programs.set(key, program);
  }

  // --- Outlook ------------------------------------------------------------------------------
  let receivable = 0;
  let receivableShares = 0;
  let projected = 0;
  let weighted = 0;
  let weightedShares = 0;
  const stages = new Map<string, StageOutlookRow & { dealIds: Set<string> }>();
  for (const f of live) {
    if (f.status === "earned" || f.status === "invoiced") {
      if (isIncome(f)) receivable += f.amountCents;
      else receivableShares += f.amountCents;
    } else if (f.status === "projected") {
      const stage = dealById.get(f.dealId)?.stage;
      const bp = stageProbabilityBp(stage);
      const w = weigh(f.amountCents, bp);
      const key = stage ?? "(unknown deal)";
      const row = stages.get(key) ?? { stage: key, label: stage ? stageLabelOf(stage) : "Unknown deal", deals: 0, probabilityPct: bp / 100, projectedCents: 0, weightedCents: 0, partnerSharesWeightedCents: 0, dealIds: new Set<string>() };
      row.dealIds.add(f.dealId);
      if (isIncome(f)) {
        projected += f.amountCents;
        weighted += w;
        row.projectedCents += f.amountCents;
        row.weightedCents += w;
      } else {
        weightedShares += w;
        row.partnerSharesWeightedCents += w;
      }
      stages.set(key, row);
    }
  }
  const order = new Map(PIPELINE_STAGES.map((s, i) => [s.key, i]));
  const byStage: StageOutlookRow[] = [...stages.values()]
    .map(({ dealIds, ...row }) => ({ ...row, deals: dealIds.size }))
    .sort((a, b) => (order.get(a.stage) ?? 999) - (order.get(b.stage) ?? 999));

  const voided = fees.filter((f) => f.status === "void");
  const byKind = [...kinds.values()].sort((a, b) => b.grossCents - a.grossCents || a.kind.localeCompare(b.kind));
  const byProgram = [...programs.values()].sort((a, b) => b.grossCents - a.grossCents || a.program.localeCompare(b.program));
  return {
    booked: { total, incomeByStatus, byMonth: [...months.values()], byKind, byProgram, entries: booked.length },
    outlook: {
      receivableCents: receivable,
      receivablePartnerSharesCents: receivableShares,
      projectedCents: projected,
      weightedProjectedCents: weighted,
      weightedPartnerSharesCents: weightedShares,
      expectedGrossCents: receivable + weighted,
      expectedNetCents: receivable + weighted - receivableShares - weightedShares,
      byStage,
    },
    voidedCents: voided.reduce((s, f) => s + f.amountCents, 0),
    voidedEntries: voided.length,
    assumptions: { stageProbabilityBp: { ...STAGE_PROBABILITY_BP }, defaultBp: DEFAULT_STAGE_PROBABILITY_BP },
  };
}
