// Ledger fixtures for the report tests and for fake-auth demo mode. Seven
// illustrative deals (no real borrowers) with a fee ledger built by the deal
// desk's own calculators (lib/deals/ledger.ts), so the report totals can be
// checked by hand and against the ledger itself.
//
// Dates are written for the anchor day 2026-11-04 and shifted so the same
// story fits any "now" (demo mode).

import { agencySplit, brokerFee, hardMoneyPoints, partnerSplit, sbaPackagingFee } from "@/lib/deals/ledger";
import type { FeeStatus, NewFeeEntry } from "@/lib/deals/types";
import { addDays, daysInclusive, laDate } from "./dates";
import type { ReportDeal, ReportFee, ReportInvoice, ReportLead, ReportLender, ReportOutreach, ReportingData, SourceCost, StageEntry } from "./types";

export const FIXTURE_NOW = new Date("2026-11-04T20:00:00.000Z");
const ANCHOR = "2026-11-04";

export const DEAL = {
  sunrise: "00000000-0000-4000-8000-000000000001",
  harbor: "00000000-0000-4000-8000-000000000002",
  oak: "00000000-0000-4000-8000-000000000003",
  maple: "00000000-0000-4000-8000-000000000004",
  bayview: "00000000-0000-4000-8000-000000000005",
  cedar: "00000000-0000-4000-8000-000000000006",
  delta: "00000000-0000-4000-8000-000000000007",
} as const;

export const LENDER = {
  cambridge: "00000000-0000-4000-8000-000000000301",
  harborBank: "00000000-0000-4000-8000-000000000302",
  fidelis: "00000000-0000-4000-8000-000000000303",
} as const;

export function reportingFixture(now: Date = FIXTURE_NOW): ReportingData {
  const shift = daysInclusive(ANCHOR, laDate(now)) - 1;
  const day = (date: string) => addDays(date, shift);
  /** Timestamp at 17:00 UTC on a fixture date, so day differences are whole numbers. */
  const t = (date: string, hhmm = "17:00") => `${day(date)}T${hhmm}:00.000Z`;

  const deal = (id: string, title: string, program: string, loanDollars: number, stage: string, status: string, created: string, entered: string, extra: Partial<ReportDeal> = {}): ReportDeal => ({
    id,
    title,
    program,
    stage,
    status,
    loanAmountCents: loanDollars * 100,
    leadId: null,
    createdAt: t(created),
    stageEnteredAt: t(entered),
    closedOn: null,
    ...extra,
  });

  const deals: ReportDeal[] = [
    deal(DEAL.sunrise, "Sunrise Assisted Living refinance (illustrative)", "HUD_232", 12_500_000, "closed", "won", "2026-08-10", "2026-10-15", { leadId: leadId(1), closedOn: day("2026-10-15") }),
    deal(DEAL.harbor, "Harbor Inn SBA 504 (illustrative)", "SBA_504", 9_200_000, "lender_underwriting", "active", "2026-09-20", "2026-10-22", { leadId: leadId(2) }),
    deal(DEAL.oak, "Oak Terrace Apartments (illustrative)", "AGENCY", 6_400_000, "term_sheet", "active", "2026-10-05", "2026-10-30", { leadId: leadId(3) }),
    deal(DEAL.maple, "Maple Street fix-and-flip (illustrative)", "HARD_MONEY", 780_000, "closed", "won", "2026-09-01", "2026-09-12", { leadId: leadId(4), closedOn: day("2026-09-12") }),
    deal(DEAL.bayview, "Bayview bridge (illustrative)", "PRIVATE_BRIDGE", 3_000_000, "underwriting", "active", "2026-10-20", "2026-10-30"),
    deal(DEAL.cedar, "Cedar Hotel PIP bridge (illustrative)", "PIP_BRIDGE", 4_500_000, "lost", "lost", "2026-08-15", "2026-10-01", { leadId: leadId(5) }),
    deal(DEAL.delta, "Delta Care 223(f) (illustrative)", "HUD_232", 8_000_000, "firm_commitment", "active", "2026-08-12", "2026-10-28", { leadId: leadId(6) }),
  ];

  // Each row: [deal, stage, date]. The deal entered the stage that day.
  const moves: [string, string, string][] = [
    ...path(DEAL.sunrise, [["intake", "2026-08-10"], ["engaged", "2026-08-12"], ["packaging", "2026-08-20"], ["lender_outreach", "2026-08-30"], ["term_sheet", "2026-09-15"], ["application", "2026-09-25"], ["third_party_reports", "2026-10-01"], ["hud_review", "2026-10-08"], ["firm_commitment", "2026-10-12"], ["closing", "2026-10-14"], ["closed", "2026-10-15"]]),
    ...path(DEAL.harbor, [["intake", "2026-09-20"], ["engaged", "2026-09-22"], ["packaging", "2026-09-26"], ["lender_outreach", "2026-10-03"], ["term_sheet", "2026-10-10"], ["application", "2026-10-15"], ["lender_underwriting", "2026-10-22"]]),
    ...path(DEAL.oak, [["intake", "2026-10-05"], ["engaged", "2026-10-07"], ["packaging", "2026-10-12"], ["lender_outreach", "2026-10-20"], ["term_sheet", "2026-10-30"]]),
    ...path(DEAL.maple, [["intake", "2026-09-01"], ["engaged", "2026-09-02"], ["packaging", "2026-09-03"], ["lender_outreach", "2026-09-05"], ["term_sheet", "2026-09-07"], ["underwriting", "2026-09-09"], ["closing", "2026-09-11"], ["closed", "2026-09-12"]]),
    ...path(DEAL.bayview, [["intake", "2026-10-20"], ["engaged", "2026-10-21"], ["packaging", "2026-10-23"], ["lender_outreach", "2026-10-26"], ["term_sheet", "2026-10-28"], ["underwriting", "2026-10-30"]]),
    ...path(DEAL.cedar, [["intake", "2026-08-15"], ["engaged", "2026-08-20"], ["packaging", "2026-09-01"], ["lender_outreach", "2026-09-15"], ["lost", "2026-10-01"]]),
    ...path(DEAL.delta, [["intake", "2026-08-12"], ["engaged", "2026-08-14"], ["packaging", "2026-08-24"], ["lender_outreach", "2026-09-08"], ["term_sheet", "2026-09-22"], ["application", "2026-10-02"], ["third_party_reports", "2026-10-12"], ["hud_review", "2026-10-20"], ["firm_commitment", "2026-10-28"]]),
  ];
  const stageEntries: StageEntry[] = moves.map(([dealId, stage, date]) => ({ dealId, stage, at: t(date) }));

  // --- Fee ledger, from the deal desk's calculators ----------------------------------------------
  const fees: ReportFee[] = [];
  const addFee = (e: NewFeeEntry, status: FeeStatus, earnedOn: string | null, extra: { invoiceId?: string } = {}): string => {
    const id = feeId(fees.length + 1);
    fees.push({
      id,
      dealId: e.dealId,
      entryKind: e.entryKind,
      payer: e.payer,
      payee: e.payee,
      status,
      amountCents: e.amountCents,
      earnedOn: earnedOn ? day(earnedOn) : null,
      createdAt: t(earnedOn ?? "2026-10-01"),
      invoiceId: extra.invoiceId ?? null,
    });
    return id;
  };
  const inv = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;

  // Sunrise: 1% broker fee (invoiced to the borrower, settled at closing), lender-paid $20,000, 25% co-broker share.
  const sunriseFee = addFee(brokerFee({ dealId: DEAL.sunrise, loanAmountCents: 1_250_000_000, pct: 1 }), "settled", "2026-10-15", { invoiceId: inv(1) });
  addFee(brokerFee({ dealId: DEAL.sunrise, loanAmountCents: 1_250_000_000, flatCents: 2_000_000, payer: "lender" }), "settled", "2026-10-15");
  addFee(partnerSplit({ dealId: DEAL.sunrise, payee: "co_broker", ofCents: 2_000_000, pct: 25, partnerName: "Pacific Capital Advisors" }), "settled", "2026-10-15");
  // Harbor Inn: SBA packaging fee invoiced; 1% broker fee still projected.
  const harborFee = addFee(sbaPackagingFee({ dealId: DEAL.harbor, flatCents: 1_500_000 }), "invoiced", "2026-10-28", { invoiceId: inv(2) });
  addFee(brokerFee({ dealId: DEAL.harbor, loanAmountCents: 920_000_000, pct: 1 }), "projected", null);
  // Oak Terrace: agency split projected (50% of a 1% origination fee) with a co-broker share.
  addFee(agencySplit({ dealId: DEAL.oak, loanAmountCents: 640_000_000, lenderOriginationPct: 1, corinSharePct: 50, lenderName: "Cambridge Realty Capital" }), "projected", null);
  addFee(partnerSplit({ dealId: DEAL.oak, payee: "co_broker", ofCents: 3_200_000, pct: 25, partnerName: "Pacific Capital Advisors" }), "projected", null);
  // Maple Street: 2 broker points and a 25% share of the lender's 2 points, both settled.
  for (const e of hardMoneyPoints({ dealId: DEAL.maple, loanAmountCents: 78_000_000, brokerPoints: 2, lenderPoints: 2, corinShareOfLenderPointsPct: 25, lenderName: "Fidelis Private Fund" })) addFee(e, "settled", "2026-09-12");
  // Bayview: 1.5% broker fee projected.
  addFee(brokerFee({ dealId: DEAL.bayview, loanAmountCents: 300_000_000, pct: 1.5 }), "projected", null);
  // Cedar: the deal was lost, so its projected fee was voided.
  addFee(brokerFee({ dealId: DEAL.cedar, loanAmountCents: 450_000_000, pct: 1 }), "void", null);
  // Delta Care: 1% fee earned, lender-paid $10,000 projected.
  addFee(brokerFee({ dealId: DEAL.delta, loanAmountCents: 800_000_000, pct: 1 }), "earned", "2026-10-30");
  addFee(brokerFee({ dealId: DEAL.delta, loanAmountCents: 800_000_000, flatCents: 1_000_000, payer: "lender" }), "projected", null);

  const invoices: ReportInvoice[] = [
    { id: inv(1), dealId: DEAL.sunrise, number: "CC-2026-0001", status: "settled", totalCents: 12_500_000, lines: [{ feeEntryId: sunriseFee, amountCents: 12_500_000 }] },
    { id: inv(2), dealId: DEAL.harbor, number: "CC-2026-0002", status: "issued", totalCents: 1_500_000, lines: [{ feeEntryId: harborFee, amountCents: 1_500_000 }] },
  ];

  // --- Lenders and outreach -------------------------------------------------------------------------
  const lenders: ReportLender[] = [
    { id: LENDER.cambridge, name: "Cambridge Realty Capital", category: "STATE_BANK", brokerFriendly: true },
    { id: LENDER.harborBank, name: "Harbor Bank", category: "NATIONAL_BANK", brokerFriendly: false },
    { id: LENDER.fidelis, name: "Fidelis Private Fund", category: "PRIVATE_NON_EXEMPT", brokerFriendly: true },
  ];
  let o = 0;
  const outreach: ReportOutreach[] = [];
  const out = (dealId: string, lenderId: string, status: ReportOutreach["status"], created: string, sent: string | null, answered: string | null) =>
    outreach.push({ id: `00000000-0000-4000-8000-0000000005${String(++o).padStart(2, "0")}`, dealId, lenderId, status, createdAt: t(created), updatedAt: t(answered ?? sent ?? created), sentAt: sent ? t(sent) : null });
  out(DEAL.sunrise, LENDER.cambridge, "term_sheet", "2026-08-30", "2026-08-31", "2026-09-10");
  out(DEAL.delta, LENDER.cambridge, "term_sheet", "2026-09-08", "2026-09-09", "2026-09-19");
  out(DEAL.oak, LENDER.cambridge, "term_sheet", "2026-10-20", "2026-10-21", "2026-10-28");
  out(DEAL.bayview, LENDER.cambridge, "declined", "2026-10-26", "2026-10-27", "2026-10-29");
  out(DEAL.harbor, LENDER.cambridge, "sent", "2026-10-03", "2026-10-04", null);
  out(DEAL.harbor, LENDER.harborBank, "term_sheet", "2026-10-03", "2026-10-04", "2026-10-12");
  out(DEAL.cedar, LENDER.harborBank, "declined", "2026-09-15", "2026-09-16", "2026-09-30");
  out(DEAL.oak, LENDER.harborBank, "rejected", "2026-10-25", null, null);
  out(DEAL.maple, LENDER.fidelis, "term_sheet", "2026-09-05", "2026-09-06", "2026-09-08");
  out(DEAL.bayview, LENDER.fidelis, "expired", "2026-10-26", null, null);

  // --- Leads and marketing spend ----------------------------------------------------------------------
  const lead = (n: number, source: string, created: string): ReportLead => ({ id: leadId(n), source, createdAt: t(created) });
  const leads: ReportLead[] = [
    lead(1, "express_qualifier", "2026-08-09"),
    lead(2, "google_ads", "2026-09-19"),
    lead(3, "express_qualifier", "2026-10-04"),
    lead(4, "partner_referral", "2026-08-30"),
    lead(5, "google_ads", "2026-08-14"),
    lead(6, "express_qualifier", "2026-08-11"),
    lead(7, "express_qualifier", "2026-10-10"),
    lead(8, "google_ads", "2026-10-11"),
    lead(9, "google_ads", "2026-10-12"),
    lead(10, "express_qualifier", "2026-10-20"),
  ];
  const costs: SourceCost[] = [
    { source: "google_ads", periodStart: day("2026-08-01"), periodEnd: day("2026-10-31"), spendCents: 300_000 },
    { source: "express_qualifier", periodStart: day("2026-10-01"), periodEnd: day("2026-10-31"), spendCents: 60_000 },
  ];

  return { deals, stageEntries, fees, invoices, outreach, lenders, leads, costs };
}

function path(dealId: string, steps: [string, string][]): [string, string, string][] {
  return steps.map(([stage, date]) => [dealId, stage, date]);
}

const leadId = (n: number) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
const feeId = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
