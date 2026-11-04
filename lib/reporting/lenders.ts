import { daysBetween, inWindow, laDate, mean, round1 } from "./dates";
import type { ReportDeal, ReportLender, ReportOutreach, ReportWindow } from "./types";

// Lender hit rate from lender_outreach (lib/deals/packages.ts). An outreach is
// "sent" once the broker-approved package went out (sentAt set); the lender
// then either declines or returns a term sheet. Requests the approval gate
// stopped (rejected or expired) never went anywhere and are shown separately.

/** Below this many sent packages a rate is a small-sample guess and is marked so. */
export const MIN_SAMPLE = 5;

export type LenderRow = {
  lenderId: string;
  name: string;
  brokerFriendly: boolean;
  /** Outreach requests created in the window. */
  requested: number;
  /** Stopped at the approval gate (rejected or expired). */
  stoppedAtGate: number;
  /** Packages sent in the window. */
  sent: number;
  declined: number;
  termSheets: number;
  /** Sent and still waiting for an answer. */
  awaiting: number;
  withdrawn: number;
  /** Term sheets / sent. Null when nothing was sent. */
  hitRatePct: number | null;
  /** (declined + term sheets) / sent. */
  responseRatePct: number | null;
  /** Average days from sending to the lender's answer. */
  avgResponseDays: number | null;
  /** Deals this lender gave a term sheet on that have since closed. */
  closedDealsWithTermSheet: number;
  lowSample: boolean;
};

export type LenderReport = { rows: LenderRow[]; totals: Omit<LenderRow, "lenderId" | "name" | "brokerFriendly"> };

const pct = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

type Acc = Omit<LenderRow, "hitRatePct" | "responseRatePct" | "avgResponseDays" | "lowSample"> & { answerDays: number[]; wonDeals: Set<string> };

const blank = (lenderId: string, name: string, brokerFriendly: boolean): Acc => ({
  lenderId,
  name,
  brokerFriendly,
  requested: 0,
  stoppedAtGate: 0,
  sent: 0,
  declined: 0,
  termSheets: 0,
  awaiting: 0,
  withdrawn: 0,
  closedDealsWithTermSheet: 0,
  answerDays: [],
  wonDeals: new Set(),
});

function finish(a: Acc): LenderRow {
  const { answerDays, wonDeals, ...rest } = a;
  const avg = mean(answerDays);
  return {
    ...rest,
    closedDealsWithTermSheet: wonDeals.size,
    hitRatePct: pct(a.termSheets, a.sent),
    responseRatePct: pct(a.declined + a.termSheets, a.sent),
    avgResponseDays: avg === null ? null : round1(avg),
    lowSample: a.sent < MIN_SAMPLE,
  };
}

export function lenderReport(outreach: readonly ReportOutreach[], lenders: readonly ReportLender[], deals: readonly ReportDeal[], window: ReportWindow): LenderReport {
  const lenderById = new Map(lenders.map((l) => [l.id, l]));
  const wonDeals = new Set(deals.filter((d) => d.status === "won").map((d) => d.id));
  const accs = new Map<string, Acc>();
  const total = blank("", "", false);

  for (const o of outreach) {
    const l = lenderById.get(o.lenderId);
    const acc = accs.get(o.lenderId) ?? blank(o.lenderId, l?.name ?? "Unknown lender", l?.brokerFriendly ?? false);
    accs.set(o.lenderId, acc);
    for (const t of [acc, total]) {
      if (inWindow(laDate(o.createdAt), window)) {
        t.requested += 1;
        if (o.status === "rejected" || o.status === "expired") t.stoppedAtGate += 1;
      }
      if (o.sentAt && inWindow(laDate(o.sentAt), window)) {
        t.sent += 1;
        if (o.status === "declined") t.declined += 1;
        else if (o.status === "term_sheet") t.termSheets += 1;
        else if (o.status === "withdrawn") t.withdrawn += 1;
        else t.awaiting += 1;
        if (o.status === "declined" || o.status === "term_sheet") t.answerDays.push(daysBetween(o.sentAt, o.updatedAt));
        if (o.status === "term_sheet" && wonDeals.has(o.dealId)) t.wonDeals.add(`${o.lenderId}:${o.dealId}`);
      }
    }
  }
  // The totals row counts a closed deal once per lender that gave a term sheet on it.
  const rows = [...accs.values()].map(finish).sort((a, b) => b.sent - a.sent || b.requested - a.requested || a.name.localeCompare(b.name));
  const { requested, stoppedAtGate, sent, declined, termSheets, awaiting, withdrawn, hitRatePct, responseRatePct, avgResponseDays, closedDealsWithTermSheet, lowSample } = finish(total);
  return { rows, totals: { requested, stoppedAtGate, sent, declined, termSheets, awaiting, withdrawn, hitRatePct, responseRatePct, avgResponseDays, closedDealsWithTermSheet, lowSample } };
}
