import { inWindow, laDate } from "./dates";
import { STAGE_PROBABILITY_BP, DEFAULT_STAGE_PROBABILITY_BP, bookingDate, type FeeReport } from "./fees";
import type { ReportDeal, ReportFee, ReportInvoice, ReportWindow } from "./types";

// Reconciliation: every figure in the fee report is recomputed from the raw
// ledger rows in the plainest way possible and compared. The page shows the
// result next to the report, so a number that drifts from the ledger is
// visible, not silently wrong. Also ties invoices back to the entries they bill.

export type ReconCheck = { name: string; ok: boolean; expectedCents: number | null; actualCents: number | null; detail?: string };
export type Reconciliation = { ok: boolean; checks: ReconCheck[] };

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function check(name: string, expected: number, actual: number, detail?: string): ReconCheck {
  return { name, ok: expected === actual, expectedCents: expected, actualCents: actual, ...(detail ? { detail } : {}) };
}

export function reconcileFees(report: FeeReport, input: { fees: readonly ReportFee[]; invoices: readonly ReportInvoice[]; deals: readonly ReportDeal[]; window: ReportWindow }): Reconciliation {
  const { fees, invoices, deals, window } = input;
  const checks: ReconCheck[] = [];
  const live = fees.filter((f) => f.status !== "void");
  const income = (f: ReportFee) => f.payee === "corin";

  // Booked in the window, straight from the rows.
  const bookedRows = live.filter((f) => ["earned", "invoiced", "settled"].includes(f.status) && inWindow(f.earnedOn ?? laDate(f.createdAt), window));
  const gross = sum(bookedRows.filter(income).map((f) => f.amountCents));
  const shares = sum(bookedRows.filter((f) => !income(f)).map((f) => f.amountCents));
  checks.push(check("Booked income equals the ledger", gross, report.booked.total.grossCents));
  checks.push(check("Booked partner shares equal the ledger", shares, report.booked.total.partnerSharesCents));
  checks.push(check("Booked net is income minus partner shares", gross - shares, report.booked.total.netCents));
  checks.push(check("Monthly income adds up to the total", gross, sum(report.booked.byMonth.map((m) => m.grossCents))));
  checks.push(check("Income by fee type adds up to the total", gross, sum(report.booked.byKind.map((k) => k.grossCents))));
  checks.push(check("Income by program adds up to the total", gross, sum(report.booked.byProgram.map((p) => p.grossCents))));
  checks.push(
    check(
      "Income by status adds up to the total",
      gross,
      report.booked.incomeByStatus.settled + report.booked.incomeByStatus.invoiced + report.booked.incomeByStatus.earned,
    ),
  );

  // Outlook.
  const receivable = sum(live.filter((f) => income(f) && (f.status === "earned" || f.status === "invoiced")).map((f) => f.amountCents));
  checks.push(check("Receivable equals earned and invoiced income in the ledger", receivable, report.outlook.receivableCents));
  const projectedRows = live.filter((f) => f.status === "projected");
  const dealStage = new Map(deals.map((d) => [d.id, d.stage]));
  const weighted = (rows: ReportFee[]) =>
    sum(
      rows.map((f) => {
        const stage = dealStage.get(f.dealId);
        const bp = stage === undefined ? 0 : (STAGE_PROBABILITY_BP[stage] ?? DEFAULT_STAGE_PROBABILITY_BP);
        return Math.floor((f.amountCents * bp + 5_000) / 10_000);
      }),
    );
  checks.push(check("Projected income equals the ledger", sum(projectedRows.filter(income).map((f) => f.amountCents)), report.outlook.projectedCents));
  checks.push(check("Weighted projected income recomputes", weighted(projectedRows.filter(income)), report.outlook.weightedProjectedCents));
  checks.push(check("Projected income by stage adds up", report.outlook.projectedCents, sum(report.outlook.byStage.map((s) => s.projectedCents))));
  checks.push(check("Weighted income by stage adds up", report.outlook.weightedProjectedCents, sum(report.outlook.byStage.map((s) => s.weightedCents))));
  checks.push(check("Expected income is receivable plus weighted projected", receivable + weighted(projectedRows.filter(income)), report.outlook.expectedGrossCents));
  const receivableShares = sum(live.filter((f) => !income(f) && (f.status === "earned" || f.status === "invoiced")).map((f) => f.amountCents));
  checks.push(
    check(
      "Expected net is expected income minus partner shares",
      receivable + weighted(projectedRows.filter(income)) - receivableShares - weighted(projectedRows.filter((f) => !income(f))),
      report.outlook.expectedNetCents,
    ),
  );

  // Void entries are excluded from everything above.
  checks.push(check("Void entries are left out", sum(fees.filter((f) => f.status === "void").map((f) => f.amountCents)), report.voidedCents, "Counted separately; never in any total"));

  // Ledger integrity: entries must belong to a deal in the report, and invoices must bill what the ledger says.
  const dealIds = new Set(deals.map((d) => d.id));
  const orphans = fees.filter((f) => !dealIds.has(f.dealId));
  checks.push({ name: "Every ledger entry belongs to a deal", ok: orphans.length === 0, expectedCents: 0, actualCents: sum(orphans.map((f) => f.amountCents)), ...(orphans.length ? { detail: `${orphans.length} entr${orphans.length === 1 ? "y" : "ies"} on deals not in the report` } : {}) });

  const byId = new Map(fees.map((f) => [f.id, f]));
  const problems: string[] = [];
  for (const inv of invoices.filter((i) => i.status !== "void")) {
    const lines = sum(inv.lines.map((l) => l.amountCents));
    if (lines !== inv.totalCents) problems.push(`${inv.number}: lines ${lines} differ from total ${inv.totalCents}`);
    for (const l of inv.lines) {
      const entry = byId.get(l.feeEntryId);
      if (!entry) problems.push(`${inv.number}: line for a ledger entry that does not exist`);
      else if (entry.amountCents !== l.amountCents) problems.push(`${inv.number}: line ${l.amountCents} differs from ledger ${entry.amountCents}`);
      else if (entry.status === "void") problems.push(`${inv.number}: bills a void ledger entry`);
      else if (entry.invoiceId !== inv.id && inv.status !== "draft" && inv.status !== "pending_approval") problems.push(`${inv.number}: ledger entry is not linked to this invoice`);
    }
  }
  const issuedTotal = sum(invoices.filter((i) => i.status === "issued" || i.status === "settled").map((i) => i.totalCents));
  const invoicedEntries = sum(fees.filter((f) => income(f) && (f.status === "invoiced" || f.status === "settled") && f.invoiceId !== null && invoices.some((i) => i.id === f.invoiceId && (i.status === "issued" || i.status === "settled"))).map((f) => f.amountCents));
  checks.push({ name: "Issued invoices bill exactly the linked ledger entries", ok: problems.length === 0 && issuedTotal === invoicedEntries, expectedCents: invoicedEntries, actualCents: issuedTotal, ...(problems.length ? { detail: problems.slice(0, 5).join("; ") } : {}) });

  return { ok: checks.every((c) => c.ok), checks };
}

/** The date a booked entry counts for, re-exported so tests can place fixtures. */
export { bookingDate };
