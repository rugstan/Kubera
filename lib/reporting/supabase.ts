import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeeEntryKind, FeePayee, FeePayer, FeeStatus, OutreachStatus } from "@/lib/deals/types";
import type { ReportDeal, ReportFee, ReportInvoice, ReportLead, ReportLender, ReportOutreach, ReportingData, ReportingSource, SourceCost, StageEntry } from "./types";

// Production reporting source: bulk reads with the service role (RLS denies the
// API roles on these tables). Read-only. Rows are mapped by the pure functions
// below, which the tests cover.

const PAGE = 1_000;

type Result<T> = { data: T[] | null; error: { message: string } | null };

async function fetchAll<T>(what: string, page: (from: number, to: number) => PromiseLike<Result<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`reporting ${what}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type DealRow = {
  id: string;
  title: string | null;
  name: string | null;
  program: string | null;
  stage: string;
  status: string;
  loan_amount_cents: number | string | null;
  loan_amount_usd: number | string | null;
  lead_id: string | null;
  created_at: string;
  stage_entered_at: string | null;
  closed_on: string | null;
};

export function mapDeal(r: DealRow): ReportDeal {
  const cents = r.loan_amount_cents !== null ? num(r.loan_amount_cents) : r.loan_amount_usd !== null ? Math.round(num(r.loan_amount_usd) * 100) : null;
  return {
    id: r.id,
    title: r.title ?? r.name ?? "Untitled deal",
    program: r.program,
    stage: r.stage,
    status: r.status,
    loanAmountCents: cents,
    leadId: r.lead_id,
    createdAt: r.created_at,
    stageEnteredAt: r.stage_entered_at,
    closedOn: r.closed_on,
  };
}

export type AuditRow = { row_id: string; occurred_at: string; action: string; new_row: Record<string, unknown> | null };

/** Stage entries from the deals audit trail: the INSERT and every update that changed `stage`. */
export function mapStageEntry(r: AuditRow): StageEntry | null {
  const stage = r.new_row?.stage;
  return typeof stage === "string" && stage ? { dealId: r.row_id, stage, at: r.occurred_at } : null;
}

export type FeeRow = {
  id: string;
  deal_id: string;
  entry_kind: FeeEntryKind;
  payer: FeePayer;
  payee: FeePayee;
  status: FeeStatus;
  amount_cents: number | string;
  earned_on: string | null;
  created_at: string;
  invoice_id: string | null;
};

export const mapFee = (r: FeeRow): ReportFee => ({
  id: r.id,
  dealId: r.deal_id,
  entryKind: r.entry_kind,
  payer: r.payer,
  payee: r.payee,
  status: r.status,
  amountCents: num(r.amount_cents),
  earnedOn: r.earned_on,
  createdAt: r.created_at,
  invoiceId: r.invoice_id,
});

export type InvoiceRow = { id: string; deal_id: string; number: string; status: ReportInvoice["status"]; total_cents: number | string; lines: { feeEntryId?: string; amountCents?: number | string }[] | null };

export const mapInvoice = (r: InvoiceRow): ReportInvoice => ({
  id: r.id,
  dealId: r.deal_id,
  number: r.number,
  status: r.status,
  totalCents: num(r.total_cents),
  lines: (r.lines ?? []).map((l) => ({ feeEntryId: String(l.feeEntryId ?? ""), amountCents: num(l.amountCents) })),
});

export type OutreachRow = { id: string; deal_id: string; lender_id: string; status: OutreachStatus; created_at: string; updated_at: string; sent_at: string | null };

export const mapOutreach = (r: OutreachRow): ReportOutreach => ({ id: r.id, dealId: r.deal_id, lenderId: r.lender_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, sentAt: r.sent_at });

export type CostRow = { source: string; period_start: string; period_end: string; spend_cents: number | string };

export const mapCost = (r: CostRow): SourceCost => ({ source: r.source, periodStart: r.period_start, periodEnd: r.period_end, spendCents: num(r.spend_cents) });

export class SupabaseReportingSource implements ReportingSource {
  constructor(private readonly db: SupabaseClient) {}

  async load(): Promise<ReportingData> {
    const db = this.db;
    const [deals, audit, fees, invoices, outreach, lenders, leads, costs] = await Promise.all([
      fetchAll<DealRow>("deals", (a, b) =>
        db.from("deals").select("id, title, name, program, stage, status, loan_amount_cents, loan_amount_usd, lead_id, created_at, stage_entered_at, closed_on").order("created_at").range(a, b),
      ),
      // INSERT rows carry the first stage; UPDATE rows that touched `stage` carry each move.
      fetchAll<AuditRow>("audit_log", (a, b) =>
        db.from("audit_log").select("row_id, occurred_at, action, new_row").eq("table_name", "deals").or("action.eq.INSERT,changed.cs.{stage}").order("id").range(a, b),
      ),
      fetchAll<FeeRow>("fee_ledger", (a, b) => db.from("fee_ledger").select("id, deal_id, entry_kind, payer, payee, status, amount_cents, earned_on, created_at, invoice_id").order("created_at").range(a, b)),
      fetchAll<InvoiceRow>("invoices", (a, b) => db.from("invoices").select("id, deal_id, number, status, total_cents, lines").order("created_at").range(a, b)),
      fetchAll<OutreachRow>("lender_outreach", (a, b) => db.from("lender_outreach").select("id, deal_id, lender_id, status, created_at, updated_at, sent_at").order("created_at").range(a, b)),
      fetchAll<{ id: string; name: string; category: string; broker_friendly: boolean }>("lender_panel", (a, b) => db.from("lender_panel").select("id, name, category, broker_friendly").order("name").range(a, b)),
      fetchAll<{ id: string; source: string; created_at: string }>("leads", (a, b) => db.from("leads").select("id, source, created_at").order("created_at").range(a, b)),
      fetchAll<CostRow>("lead_source_costs", (a, b) => db.from("lead_source_costs").select("source, period_start, period_end, spend_cents").order("period_start").range(a, b)),
    ]);
    return {
      deals: deals.map(mapDeal),
      stageEntries: audit.map(mapStageEntry).filter((e): e is StageEntry => e !== null),
      fees: fees.map(mapFee),
      invoices: invoices.map(mapInvoice),
      outreach: outreach.map(mapOutreach),
      lenders: lenders.map((l): ReportLender => ({ id: l.id, name: l.name, category: l.category, brokerFriendly: l.broker_friendly })),
      leads: leads.map((l): ReportLead => ({ id: l.id, source: l.source, createdAt: l.created_at })),
      costs: costs.map(mapCost),
    };
  }
}
