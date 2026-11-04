import { daysInclusive, inWindow, laDate } from "./dates";
import { weigh, stageProbabilityBp } from "./fees";
import { isOpen } from "./pipeline";
import type { ReportDeal, ReportFee, ReportLead, ReportWindow, SourceCost } from "./types";

// Lead-source ROI. A cohort is the leads created in the window, by source,
// followed through the deals they became and the fees those deals booked.
// Spend is Corin's own marketing cost per source (lead_source_costs), prorated
// by days when a cost period straddles the window.
//
//   booked net     income minus partner shares on earned, invoiced or settled entries (any date)
//   expected net   booked net plus the weighted outlook on the same deals (see fees.ts)
//   ROI            (booked net - spend) / spend; blank until spend is recorded

/** Deals with no lead behind them (referrals entered by hand, take-outs). */
export const DIRECT_SOURCE = "(no lead)";

export type SourceRow = {
  source: string;
  leads: number;
  deals: number;
  won: number;
  /** Deals / leads. */
  leadToDealPct: number | null;
  /** Won / deals. */
  dealToWonPct: number | null;
  bookedNetCents: number;
  expectedNetCents: number;
  spendCents: number;
  costPerLeadCents: number | null;
  costPerWonDealCents: number | null;
  /** (booked net - spend) / spend as a percent; null with no spend. */
  roiPct: number | null;
  spendRecorded: boolean;
};

export type SourceReport = { rows: SourceRow[]; totals: Omit<SourceRow, "source"> };

const pct = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

/** Share of a cost period that falls inside the window, applied to its spend (half-up to the cent). */
export function proratedSpend(cost: SourceCost, window: Pick<ReportWindow, "from" | "to">): number {
  const start = cost.periodStart > window.from ? cost.periodStart : window.from;
  const end = cost.periodEnd < window.to ? cost.periodEnd : window.to;
  if (start > end) return 0;
  const overlap = daysInclusive(start, end);
  const period = daysInclusive(cost.periodStart, cost.periodEnd);
  return Math.floor((cost.spendCents * overlap * 2 + period) / (period * 2));
}

type Acc = { leads: number; deals: Set<string>; won: Set<string>; bookedNet: number; expectedNet: number; spend: number; spendRecorded: boolean };
const acc = (): Acc => ({ leads: 0, deals: new Set(), won: new Set(), bookedNet: 0, expectedNet: 0, spend: 0, spendRecorded: false });

function metrics(a: Acc): Omit<SourceRow, "source"> {
  const deals = a.deals.size;
  const won = a.won.size;
  return {
    leads: a.leads,
    deals,
    won,
    leadToDealPct: pct(deals, a.leads),
    dealToWonPct: pct(won, deals),
    bookedNetCents: a.bookedNet,
    expectedNetCents: a.expectedNet,
    spendCents: a.spend,
    costPerLeadCents: a.leads > 0 && a.spendRecorded ? Math.round(a.spend / a.leads) : null,
    costPerWonDealCents: won > 0 && a.spendRecorded ? Math.round(a.spend / won) : null,
    roiPct: a.spend > 0 ? Math.round(((a.bookedNet - a.spend) / a.spend) * 1000) / 10 : null,
    spendRecorded: a.spendRecorded,
  };
}

const row = (source: string, a: Acc): SourceRow => ({ source, ...metrics(a) });

export function sourceReport(input: { leads: readonly ReportLead[]; deals: readonly ReportDeal[]; fees: readonly ReportFee[]; costs: readonly SourceCost[]; window: ReportWindow }): SourceReport {
  const { window } = input;
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const accs = new Map<string, Acc>();
  const get = (s: string) => accs.get(s) ?? accs.set(s, acc()).get(s)!;

  // Cohort: leads created in the window.
  const cohortLeads = input.leads.filter((l) => inWindow(laDate(l.createdAt), window));
  const cohortIds = new Set(cohortLeads.map((l) => l.id));
  for (const l of cohortLeads) get(l.source).leads += 1;

  // Their deals, plus deals opened in the window with no lead behind them.
  const sourceOf = new Map<string, string>();
  for (const d of input.deals) {
    if (d.leadId && leadById.has(d.leadId)) {
      if (cohortIds.has(d.leadId)) sourceOf.set(d.id, leadById.get(d.leadId)!.source);
    } else if (inWindow(laDate(d.createdAt), window)) {
      sourceOf.set(d.id, DIRECT_SOURCE);
    }
  }
  const dealById = new Map(input.deals.map((d) => [d.id, d]));
  for (const [dealId, source] of sourceOf) {
    const a = get(source);
    a.deals.add(dealId);
    if (dealById.get(dealId)!.status === "won") a.won.add(dealId);
  }

  // Fees on those deals.
  for (const f of input.fees) {
    const source = sourceOf.get(f.dealId);
    if (!source || f.status === "void") continue;
    const sign = f.payee === "corin" ? 1 : -1;
    const a = get(source);
    if (f.status === "earned" || f.status === "invoiced" || f.status === "settled") {
      // Booked on any date: the cohort is what the leads in the window are worth.
      a.bookedNet += sign * f.amountCents;
      a.expectedNet += sign * f.amountCents;
    } else if (f.status === "projected") {
      const deal = dealById.get(f.dealId)!;
      a.expectedNet += sign * (isOpen(deal) ? weigh(f.amountCents, stageProbabilityBp(deal.stage)) : 0);
    }
  }

  // Spend.
  for (const c of input.costs) {
    const spend = proratedSpend(c, window);
    const a = get(c.source);
    a.spendRecorded = true;
    a.spend += spend;
  }

  const rows = [...accs.entries()]
    .map(([source, a]) => row(source, a))
    .filter((r) => r.leads > 0 || r.deals > 0 || r.spendCents > 0)
    .sort((a, b) => b.bookedNetCents - a.bookedNetCents || b.leads - a.leads || a.source.localeCompare(b.source));

  const total = acc();
  for (const a of accs.values()) {
    total.leads += a.leads;
    a.deals.forEach((d) => total.deals.add(d));
    a.won.forEach((d) => total.won.add(d));
    total.bookedNet += a.bookedNet;
    total.expectedNet += a.expectedNet;
    total.spend += a.spend;
    total.spendRecorded ||= a.spendRecorded;
  }
  return { rows, totals: metrics(total) };
}

