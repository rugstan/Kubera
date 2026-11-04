import type { DealDeskStore } from "@/lib/deals/store";
import { emptyData, type ReportingData, type ReportingSource, type StageEntry, type SourceCost, type ReportLead } from "./types";

/** A fixed snapshot (tests, demo data). */
export function memoryReportingSource(data: Partial<ReportingData>): ReportingSource {
  return { load: async () => ({ ...emptyData(), ...structuredClone(data) }) };
}

/**
 * Reads the deal desk through its store interface. That store keeps no history
 * of stage values, leads or marketing spend, so those come from the caller;
 * everything else (deals, the fee ledger, invoices, outreach, lenders) is read
 * from the store exactly as the deal desk wrote it. Used by the ledger
 * reconciliation tests; production reads in bulk (supabase.ts).
 */
export function storeReportingSource(store: DealDeskStore, extras: { stageEntries?: StageEntry[]; leads?: ReportLead[]; costs?: SourceCost[] } = {}): ReportingSource {
  return {
    async load() {
      const [deals, lenders] = await Promise.all([store.listDeals({ limit: 10_000 }), store.listLenders()]);
      const perDeal = await Promise.all(
        deals.map(async (d) => ({ fees: await store.listFeeEntries(d.id), invoices: await store.listInvoices(d.id), outreach: await store.listOutreach(d.id) })),
      );
      return {
        deals: deals.map((d) => ({
          id: d.id,
          title: d.title,
          program: d.program,
          stage: d.stage,
          status: d.status,
          loanAmountCents: d.loanAmountCents,
          leadId: d.leadId,
          createdAt: d.createdAt,
          stageEnteredAt: d.stageEnteredAt,
          closedOn: d.closedOn,
        })),
        stageEntries: extras.stageEntries ?? [],
        fees: perDeal.flatMap((p) =>
          p.fees.map((f) => ({
            id: f.id,
            dealId: f.dealId,
            entryKind: f.entryKind,
            payer: f.payer,
            payee: f.payee,
            status: f.status,
            amountCents: f.amountCents,
            earnedOn: f.earnedOn,
            createdAt: f.createdAt,
            invoiceId: f.invoiceId,
          })),
        ),
        invoices: perDeal.flatMap((p) => p.invoices.map((i) => ({ id: i.id, dealId: i.dealId, number: i.number, status: i.status, totalCents: i.totalCents, lines: i.lines.map((l) => ({ feeEntryId: l.feeEntryId, amountCents: l.amountCents })) }))),
        outreach: perDeal.flatMap((p) => p.outreach.map((o) => ({ id: o.id, dealId: o.dealId, lenderId: o.lenderId, status: o.status, createdAt: o.createdAt, updatedAt: o.updatedAt, sentAt: o.sentAt }))),
        lenders: lenders.map((l) => ({ id: l.id, name: l.name, category: l.category, brokerFriendly: l.brokerFriendly })),
        leads: extras.leads ?? [],
        costs: extras.costs ?? [],
      };
    },
  };
}
