import type { ReportBundle } from "./build";

// CSV export of one report. Cells that start with = + - @ (or a tab/CR) are
// prefixed with an apostrophe so a spreadsheet never runs them as a formula.

export const REPORT_CSV_KINDS = ["pipeline", "time-in-stage", "fees", "lenders", "sources"] as const;
export type ReportCsvKind = (typeof REPORT_CSV_KINDS)[number];

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // A plain signed decimal ("-12.50") is a number, not a formula.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Whole dollars and cents as a plain decimal ("12500.50"), never a formatted string. */
export const dollars = (cents: number): string => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

export function reportCsv(kind: ReportCsvKind, r: ReportBundle): { filename: string; body: string } {
  const stamp = `${r.window.from}_to_${r.window.to}`;
  switch (kind) {
    case "pipeline":
      return {
        filename: `pipeline-by-stage-${r.generatedAt.slice(0, 10)}.csv`,
        body: toCsv(
          ["Stage", "Open deals", "Requested loan volume (USD)"],
          r.pipeline.byStage.map((s) => [s.label, s.open, dollars(s.openAmountCents)]),
        ),
      };
    case "time-in-stage":
      return {
        filename: `time-in-stage-${stamp}.csv`,
        body: toCsv(
          ["Stage", "Completed visits", "Mean days", "Median days", "90th percentile days", "Deals in stage now", "Oldest open (days)"],
          r.timeInStage.rows.map((s) => [s.label, s.completed, s.meanDays, s.medianDays, s.p90Days, s.open, s.oldestOpenDays]),
        ),
      };
    case "fees":
      return {
        filename: `fee-report-${stamp}.csv`,
        body: toCsv(
          ["Month", "Income (USD)", "Partner shares (USD)", "Net (USD)", "Settled income (USD)"],
          r.fees.booked.byMonth.map((m) => [m.month, dollars(m.grossCents), dollars(m.partnerSharesCents), dollars(m.netCents), dollars(m.settledCents)]),
        ),
      };
    case "lenders":
      return {
        filename: `lender-hit-rate-${stamp}.csv`,
        body: toCsv(
          ["Lender", "Requested", "Stopped at approval gate", "Sent", "Declined", "Term sheets", "Awaiting", "Hit rate %", "Response rate %", "Avg response days", "Closed deals with term sheet"],
          r.lenders.rows.map((l) => [l.name, l.requested, l.stoppedAtGate, l.sent, l.declined, l.termSheets, l.awaiting, l.hitRatePct, l.responseRatePct, l.avgResponseDays, l.closedDealsWithTermSheet]),
        ),
      };
    case "sources":
      return {
        filename: `lead-source-roi-${stamp}.csv`,
        body: toCsv(
          ["Source", "Leads", "Deals", "Won", "Lead to deal %", "Deal to won %", "Booked net (USD)", "Expected net (USD)", "Spend (USD)", "Cost per lead (USD)", "Cost per won deal (USD)", "ROI %"],
          r.sources.rows.map((s) => [
            s.source,
            s.leads,
            s.deals,
            s.won,
            s.leadToDealPct,
            s.dealToWonPct,
            dollars(s.bookedNetCents),
            dollars(s.expectedNetCents),
            dollars(s.spendCents),
            s.costPerLeadCents === null ? null : dollars(s.costPerLeadCents),
            s.costPerWonDealCents === null ? null : dollars(s.costPerWonDealCents),
            s.roiPct,
          ]),
        ),
      };
  }
}
