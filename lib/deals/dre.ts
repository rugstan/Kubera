// DRE reporting: the B&P §10232 threshold-broker monitor and the data the
// desk needs for RE 853 (threshold notification) and the annual RE 860 /
// RE 881 reports.
//
// §10232(a) criteria (VERIFY with counsel; form titles and field lists below
// are pending counsel review):
//   (1) in the past 12 months negotiated 10 or more loans secured by real
//       property (or a business opportunity) for others, aggregating more than
//       $1,000,000;
//   (2) intends to do the same in the next 12 months;
//   (3) collected 100+ payments or $250,000+ in any 3 months for note owners —
//       never true for Kubera, which does not service loans (Global rule 1).
// A broker meeting a criterion notifies the DRE within 30 days (RE 853).

import { addCalendarDays } from "@/lib/disclosures/business-days";
import { DEAL_PROGRAM_LABELS, type Deal, type DreReport, type FeeEntry } from "./types";
import type { ClosedLoan } from "./store";

export const THRESHOLD_LOAN_COUNT = 10;
/** "More than one million dollars" (strictly greater). */
export const THRESHOLD_AGGREGATE_CENTS = 100_000_000;
export const NOTIFY_WITHIN_DAYS = 30;
/** Warn when either counter reaches this share of its threshold. */
export const WARNING_RATIO = 0.8;

/** Stages from which the desk treats a deal as likely to close within 12 months. */
const FORWARD_STAGES: ReadonlySet<string> = new Set([
  "term_sheet",
  "application",
  "third_party_reports",
  "plan_and_cost_review",
  "hud_review",
  "firm_commitment",
  "lender_underwriting",
  "sba_authorization",
  "underwriting",
  "commitment",
  "closing",
]);

export type ThresholdCounters = {
  asOf: string;
  trailing: { from: string; to: string; count: number; aggregateCents: number; dealIds: string[] };
  forward: { count: number; aggregateCents: number; dealIds: string[] };
  /** Kubera never collects payments for note owners; recorded as zero by design. */
  servicing: { payments: 0; aggregateCents: 0 };
  /** Closed loans without a real-property lien (business-asset-only): listed for review, not counted. */
  excludedForReview: { count: number; dealIds: string[] };
  criteria: { pastTwelveMonths: boolean; nextTwelveMonths: boolean; servicing: false };
  thresholdMet: boolean;
  approaching: boolean;
  firstMetOn: string | null;
  notifyBy: string | null;
  notified: boolean;
};

/** Twelve-month lookback window ending on `asOf` (inclusive), as civil dates. */
export function trailingWindow(asOf: string): { from: string; to: string } {
  const [y, m, d] = asOf.split("-").map(Number) as [number, number, number];
  const start = new Date(Date.UTC(y - 1, m - 1, d));
  return { from: addCalendarDays(start.toISOString().slice(0, 10), 1), to: asOf };
}

function meets(count: number, aggregateCents: number): boolean {
  return count >= THRESHOLD_LOAN_COUNT && aggregateCents > THRESHOLD_AGGREGATE_CENTS;
}

export function thresholdMonitor(input: { asOf: string; closed: ClosedLoan[]; pipeline: Deal[]; history: DreReport[] }): ThresholdCounters {
  const win = trailingWindow(input.asOf);
  const inWindow = input.closed.filter((l) => l.closedOn >= win.from && l.closedOn <= win.to);
  const counted = inWindow.filter((l) => l.collateralRealProperty);
  const excluded = inWindow.filter((l) => !l.collateralRealProperty);
  const count = counted.length;
  const aggregateCents = counted.reduce((a, l) => a + l.loanAmountCents, 0);

  const forwardDeals = input.pipeline.filter((d) => FORWARD_STAGES.has(d.stage) && d.collateralRealProperty);
  const forwardCount = forwardDeals.length;
  const forwardAggregate = forwardDeals.reduce((a, d) => a + (d.loanAmountCents ?? 0), 0);

  const pastTwelveMonths = meets(count, aggregateCents);
  const nextTwelveMonths = meets(forwardCount, forwardAggregate);
  const thresholdMet = pastTwelveMonths || nextTwelveMonths;
  const approaching =
    !thresholdMet &&
    (count >= THRESHOLD_LOAN_COUNT * WARNING_RATIO || aggregateCents >= THRESHOLD_AGGREGATE_CENTS * WARNING_RATIO || forwardCount >= THRESHOLD_LOAN_COUNT * WARNING_RATIO);

  const earlier = input.history.filter((r) => r.reportKind === "threshold_monitor" && r.thresholdMet && r.asOf <= input.asOf).sort((a, b) => a.asOf.localeCompare(b.asOf));
  const firstMetOn = thresholdMet ? (earlier[0]?.firstMetOn ?? earlier[0]?.asOf ?? input.asOf) : null;
  const notified = input.history.some((r) => r.reportKind === "RE853" && r.notifiedOn !== null);

  return {
    asOf: input.asOf,
    trailing: { ...win, count, aggregateCents, dealIds: counted.map((l) => l.dealId) },
    forward: { count: forwardCount, aggregateCents: forwardAggregate, dealIds: forwardDeals.map((d) => d.id) },
    servicing: { payments: 0, aggregateCents: 0 },
    excludedForReview: { count: excluded.length, dealIds: excluded.map((l) => l.dealId) },
    criteria: { pastTwelveMonths, nextTwelveMonths, servicing: false },
    thresholdMet,
    approaching,
    firstMetOn,
    notifyBy: firstMetOn ? addCalendarDays(firstMetOn, NOTIFY_WITHIN_DAYS) : null,
    notified,
  };
}

// ---------------------------------------------------------------------------
// Exports

export type BrokerIdentity = { legalName: string; dreLicense: string; address: string; designatedOfficer: string; officerLicense: string };

export type Re853Data = {
  form: "RE853";
  title: string;
  broker: BrokerIdentity;
  criteriaMet: string[];
  dateMet: string;
  notifyBy: string;
  trailingCount: number;
  trailingAggregateCents: number;
  forwardCount: number;
  forwardAggregateCents: number;
  servicingPayments: 0;
  note: string;
};

export function re853Data(c: ThresholdCounters, broker: BrokerIdentity): Re853Data | null {
  if (!c.thresholdMet || !c.firstMetOn || !c.notifyBy) return null;
  const criteriaMet = [
    ...(c.criteria.pastTwelveMonths ? ["§10232(a)(1): 10+ loans aggregating over $1,000,000 negotiated in the past 12 months"] : []),
    ...(c.criteria.nextTwelveMonths ? ["§10232(a)(2): 10+ loans aggregating over $1,000,000 expected in the next 12 months"] : []),
  ];
  return {
    form: "RE853",
    title: "Threshold notification (RE 853) — data for the DRE form (VERIFY form fields with counsel)",
    broker,
    criteriaMet,
    dateMet: c.firstMetOn,
    notifyBy: c.notifyBy,
    trailingCount: c.trailing.count,
    trailingAggregateCents: c.trailing.aggregateCents,
    forwardCount: c.forward.count,
    forwardAggregateCents: c.forward.aggregateCents,
    servicingPayments: 0,
    note: "Kubera Commercial, Inc. brokers only: it does not service loans, collect payments for note owners, or hold trust funds.",
  };
}

export type AnnualLoanRow = {
  dealId: string;
  title: string;
  closedOn: string;
  program: string;
  propertyState: string;
  loanAmountCents: number;
  realPropertyLien: boolean;
  compensationCents: number;
  compensationFromBorrowerCents: number;
  compensationFromLenderCents: number;
};

export type AnnualActivityData = {
  form: "RE860" | "RE881";
  title: string;
  broker: BrokerIdentity;
  year: number;
  period: { from: string; to: string };
  loans: AnnualLoanRow[];
  totals: { count: number; aggregateCents: number; realPropertyCount: number; compensationCents: number; byProgram: Record<string, { count: number; aggregateCents: number }> };
  trustFunds: "none";
  servicing: "none";
};

const ANNUAL_TITLES: Record<"RE860" | "RE881", string> = {
  RE860: "Annual report data (RE 860) — VERIFY form title and fields with counsel",
  RE881: "Annual report data (RE 881) — VERIFY form title and fields with counsel",
};

export function annualActivity(form: "RE860" | "RE881", year: number, closed: ClosedLoan[], ledgers: Map<string, FeeEntry[]>, broker: BrokerIdentity): AnnualActivityData {
  const period = { from: `${year}-01-01`, to: `${year}-12-31` };
  const loans: AnnualLoanRow[] = closed
    .filter((l) => l.closedOn >= period.from && l.closedOn <= period.to)
    .sort((a, b) => a.closedOn.localeCompare(b.closedOn))
    .map((l) => {
      const fees = (ledgers.get(l.dealId) ?? []).filter((e) => e.payee === "kubera" && e.status !== "void");
      const from = (p: string) => fees.filter((e) => e.payer === p).reduce((a, e) => a + e.amountCents, 0);
      return {
        dealId: l.dealId,
        title: l.title,
        closedOn: l.closedOn,
        program: DEAL_PROGRAM_LABELS[l.program],
        propertyState: l.propertyState ?? "",
        loanAmountCents: l.loanAmountCents,
        realPropertyLien: l.collateralRealProperty,
        compensationCents: fees.reduce((a, e) => a + e.amountCents, 0),
        compensationFromBorrowerCents: from("borrower"),
        compensationFromLenderCents: from("lender"),
      };
    });
  const byProgram: Record<string, { count: number; aggregateCents: number }> = {};
  for (const l of loans) {
    const b = (byProgram[l.program] ??= { count: 0, aggregateCents: 0 });
    b.count += 1;
    b.aggregateCents += l.loanAmountCents;
  }
  return {
    form,
    title: ANNUAL_TITLES[form],
    broker,
    year,
    period,
    loans,
    totals: {
      count: loans.length,
      aggregateCents: loans.reduce((a, l) => a + l.loanAmountCents, 0),
      realPropertyCount: loans.filter((l) => l.realPropertyLien).length,
      compensationCents: loans.reduce((a, l) => a + l.compensationCents, 0),
      byProgram,
    },
    trustFunds: "none",
    servicing: "none",
  };
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const dollars = (c: number) => (c / 100).toFixed(2);

export function annualActivityCsv(d: AnnualActivityData): string {
  return toCsv(
    ["form", "year", "deal_id", "title", "closed_on", "program", "property_state", "loan_amount_usd", "real_property_lien", "broker_compensation_usd", "from_borrower_usd", "from_lender_usd"],
    d.loans.map((l) => [d.form, d.year, l.dealId, l.title, l.closedOn, l.program, l.propertyState, dollars(l.loanAmountCents), l.realPropertyLien ? "yes" : "no", dollars(l.compensationCents), dollars(l.compensationFromBorrowerCents), dollars(l.compensationFromLenderCents)]),
  );
}

export function thresholdCsv(c: ThresholdCounters): string {
  return toCsv(
    ["as_of", "window_from", "window_to", "trailing_count", "trailing_aggregate_usd", "forward_count", "forward_aggregate_usd", "servicing_payments", "threshold_met", "first_met_on", "notify_by"],
    [[c.asOf, c.trailing.from, c.trailing.to, c.trailing.count, dollars(c.trailing.aggregateCents), c.forward.count, dollars(c.forward.aggregateCents), 0, c.thresholdMet ? "yes" : "no", c.firstMetOn ?? "", c.notifyBy ?? ""]],
  );
}

/** Persistable snapshot for `dre_reporting`. */
export function thresholdSnapshot(c: ThresholdCounters, createdBy: string): Omit<DreReport, "id" | "createdAt"> {
  return {
    reportKind: "threshold_monitor",
    asOf: c.asOf,
    periodStart: c.trailing.from,
    periodEnd: c.trailing.to,
    counters: c as unknown as Record<string, unknown>,
    thresholdMet: c.thresholdMet,
    firstMetOn: c.firstMetOn,
    notifyBy: c.notifyBy,
    notifiedOn: null,
    export: null,
    createdBy,
  };
}
