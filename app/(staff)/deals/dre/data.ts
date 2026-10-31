import "server-only";
import { annualActivity, thresholdMonitor, type ThresholdCounters } from "@/lib/deals/dre";
import type { DealDeskRuntime } from "@/lib/deals/runtime";
import type { FeeEntry } from "@/lib/deals/types";

/** Live threshold counters as of today (office date). */
export async function liveThreshold(rt: DealDeskRuntime): Promise<ThresholdCounters> {
  const asOf = rt.now().toISOString().slice(0, 10);
  const yearAgo = `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
  const [closed, pipeline, history] = await Promise.all([rt.store.closedLoans({ from: yearAgo, to: asOf }), rt.store.listDeals({ openOnly: true, limit: 1000 }), rt.store.listDreReports()]);
  return thresholdMonitor({ asOf, closed, pipeline, history });
}

export async function annualData(rt: DealDeskRuntime, form: "RE860" | "RE881", year: number, broker: Parameters<typeof annualActivity>[4]) {
  const closed = await rt.store.closedLoans({ from: `${year}-01-01`, to: `${year}-12-31` });
  const ledgers = new Map<string, FeeEntry[]>();
  for (const l of closed) ledgers.set(l.dealId, await rt.store.listFeeEntries(l.dealId));
  return annualActivity(form, year, closed, ledgers, broker);
}
