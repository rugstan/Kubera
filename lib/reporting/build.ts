import { resolveWindow } from "./dates";
import { feeReport, type FeeReport } from "./fees";
import { lenderReport, type LenderReport } from "./lenders";
import { funnelReport, pipelineReport, type FunnelRow, type PipelineReport } from "./pipeline";
import { reconcileFees, type Reconciliation } from "./reconcile";
import { sourceReport, type SourceReport } from "./sources";
import { timeInStageReport, type TimeInStageReport } from "./time-in-stage";
import type { RangeKey, ReportWindow, ReportingData } from "./types";

export type ReportBundle = {
  generatedAt: string;
  window: ReportWindow;
  pipeline: PipelineReport;
  funnel: FunnelRow[];
  timeInStage: TimeInStageReport;
  fees: FeeReport;
  reconciliation: Reconciliation;
  lenders: LenderReport;
  sources: SourceReport;
};

/** Every report over one snapshot of the data. Pure: the clock is a parameter. */
export function buildReports(data: ReportingData, opts: { range: RangeKey; now: Date }): ReportBundle {
  const window = resolveWindow(opts.range, opts.now);
  const fees = feeReport(data.fees, data.deals, window);
  return {
    generatedAt: opts.now.toISOString(),
    window,
    pipeline: pipelineReport(data.deals, window),
    funnel: funnelReport(data.deals, data.stageEntries, window),
    timeInStage: timeInStageReport(data.deals, data.stageEntries, window, opts.now),
    fees,
    reconciliation: reconcileFees(fees, { fees: data.fees, invoices: data.invoices, deals: data.deals, window }),
    lenders: lenderReport(data.outreach, data.lenders, data.deals, window),
    sources: sourceReport({ leads: data.leads, deals: data.deals, fees: data.fees, costs: data.costs, window }),
  };
}
