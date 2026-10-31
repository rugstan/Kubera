import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { SupabaseReportingSource, mapCost, mapDeal, mapFee, mapInvoice, mapOutreach, mapStageEntry } = await import("./supabase");
const { buildReports } = await import("./build");
const { reportingFixture, FIXTURE_NOW } = await import("./fixtures");

describe("row mapping", () => {
  it("maps a deal, preferring WS-T's columns and falling back to WS-I's", () => {
    const base = { id: "d1", program: "HUD_232", stage: "intake", status: "active", lead_id: null, created_at: "2026-10-01T00:00:00Z", stage_entered_at: "2026-10-01T00:00:00Z", closed_on: null };
    expect(mapDeal({ ...base, title: "T", name: "N", loan_amount_cents: "125000000", loan_amount_usd: 1_250_000 })).toMatchObject({ title: "T", loanAmountCents: 125_000_000 });
    expect(mapDeal({ ...base, title: null, name: "N", loan_amount_cents: null, loan_amount_usd: "1250000.5" })).toMatchObject({ title: "N", loanAmountCents: 125_000_050 });
    expect(mapDeal({ ...base, title: null, name: null, loan_amount_cents: null, loan_amount_usd: null })).toMatchObject({ title: "Untitled deal", loanAmountCents: null });
  });

  it("reads stage entries from audit rows and skips rows without a stage", () => {
    expect(mapStageEntry({ row_id: "d1", occurred_at: "t", action: "INSERT", new_row: { stage: "intake" } })).toEqual({ dealId: "d1", stage: "intake", at: "t" });
    expect(mapStageEntry({ row_id: "d1", occurred_at: "t", action: "UPDATE", new_row: { title: "x" } })).toBeNull();
    expect(mapStageEntry({ row_id: "d1", occurred_at: "t", action: "UPDATE", new_row: null })).toBeNull();
  });

  it("converts numeric strings from bigint columns", () => {
    expect(mapFee({ id: "f", deal_id: "d", entry_kind: "broker_fee", payer: "borrower", payee: "kubera", status: "earned", amount_cents: "12500000", earned_on: "2026-10-15", created_at: "t", invoice_id: null }).amountCents).toBe(12_500_000);
    expect(mapInvoice({ id: "i", deal_id: "d", number: "KC-1", status: "issued", total_cents: "100", lines: [{ feeEntryId: "f", amountCents: "100" }] }).lines).toEqual([{ feeEntryId: "f", amountCents: 100 }]);
    expect(mapInvoice({ id: "i", deal_id: "d", number: "KC-1", status: "draft", total_cents: 0, lines: null }).lines).toEqual([]);
    expect(mapOutreach({ id: "o", deal_id: "d", lender_id: "l", status: "sent", created_at: "a", updated_at: "b", sent_at: null })).toMatchObject({ dealId: "d", lenderId: "l", sentAt: null });
    expect(mapCost({ source: "s", period_start: "2026-10-01", period_end: "2026-10-31", spend_cents: "5000" }).spendCents).toBe(5_000);
  });
});

/** Fake PostgREST client: every table answers its rows, honoring .range(). */
function fakeDb(tables: Record<string, unknown[]>) {
  const calls: { table: string; ops: [string, unknown[]][] }[] = [];
  const db = {
    from(table: string) {
      const call = { table, ops: [] as [string, unknown[]][] };
      calls.push(call);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") {
              const range = call.ops.find(([op]) => op === "range")?.[1] as [number, number] | undefined;
              const rows = tables[table] ?? [];
              return (resolve: (v: unknown) => void) => resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null });
            }
            return (...args: unknown[]) => {
              call.ops.push([prop, args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("SupabaseReportingSource", () => {
  it("pages through every table and reads stage history from the audit log", async () => {
    const fees = Array.from({ length: 2_300 }, (_, i) => ({ id: `f${i}`, deal_id: "d1", entry_kind: "broker_fee", payer: "borrower", payee: "kubera", status: "settled", amount_cents: 100, earned_on: "2026-10-15", created_at: "2026-10-15T00:00:00Z", invoice_id: null }));
    const { db, calls } = fakeDb({
      deals: [{ id: "d1", title: "A", name: "A", program: "HUD_232", stage: "intake", status: "active", loan_amount_cents: 100, loan_amount_usd: 1, lead_id: null, created_at: "2026-10-01T00:00:00Z", stage_entered_at: null, closed_on: null }],
      audit_log: [
        { row_id: "d1", occurred_at: "2026-10-01T00:00:00Z", action: "INSERT", new_row: { stage: "intake" } },
        { row_id: "d1", occurred_at: "2026-10-02T00:00:00Z", action: "UPDATE", new_row: { stage: "engaged" } },
      ],
      fee_ledger: fees,
      lender_panel: [{ id: "l1", name: "Bank", category: "STATE_BANK", broker_friendly: true }],
      leads: [{ id: "x", source: "express_qualifier", created_at: "2026-10-01T00:00:00Z" }],
    });
    const loaded = await new SupabaseReportingSource(db).load();
    expect(loaded.fees).toHaveLength(2_300);
    expect(loaded.stageEntries.map((e) => e.stage)).toEqual(["intake", "engaged"]);
    expect(loaded.lenders).toEqual([{ id: "l1", name: "Bank", category: "STATE_BANK", brokerFriendly: true }]);
    expect(loaded.leads[0]!.source).toBe("express_qualifier");

    const audit = calls.find((c) => c.table === "audit_log")!;
    expect(audit.ops).toContainEqual(["eq", ["table_name", "deals"]]);
    expect(audit.ops).toContainEqual(["or", ["action.eq.INSERT,changed.cs.{stage}"]]);
    // Three pages of up to 1,000 rows for the ledger.
    expect(calls.filter((c) => c.table === "fee_ledger")).toHaveLength(3);
  });

  it("is read-only", async () => {
    const { db, calls } = fakeDb({});
    await new SupabaseReportingSource(db).load();
    const writes = ["insert", "update", "upsert", "delete"];
    expect(calls.flatMap((c) => c.ops.map(([op]) => op)).filter((op) => writes.includes(op))).toEqual([]);
  });

  it("raises a database error with the table name", async () => {
    const db = {
      from: () => {
        const b: Record<string, unknown> = new Proxy({}, { get: (_t, p: string) => (p === "then" ? (r: (v: unknown) => void) => r({ data: null, error: { message: "permission denied" } }) : () => b) });
        return b;
      },
    } as unknown as SupabaseClient;
    await expect(new SupabaseReportingSource(db).load()).rejects.toThrow(/reporting .*permission denied/);
  });

  it("round-trips the fixture through database-shaped rows into the same report", async () => {
    const f = reportingFixture();
    const { db } = fakeDb({
      deals: f.deals.map((d) => ({ id: d.id, title: d.title, name: d.title, program: d.program, stage: d.stage, status: d.status, loan_amount_cents: d.loanAmountCents, loan_amount_usd: null, lead_id: d.leadId, created_at: d.createdAt, stage_entered_at: d.stageEnteredAt, closed_on: d.closedOn })),
      audit_log: f.stageEntries.map((e) => ({ row_id: e.dealId, occurred_at: e.at, action: "UPDATE", new_row: { stage: e.stage } })),
      fee_ledger: f.fees.map((x) => ({ id: x.id, deal_id: x.dealId, entry_kind: x.entryKind, payer: x.payer, payee: x.payee, status: x.status, amount_cents: x.amountCents, earned_on: x.earnedOn, created_at: x.createdAt, invoice_id: x.invoiceId })),
      invoices: f.invoices.map((i) => ({ id: i.id, deal_id: i.dealId, number: i.number, status: i.status, total_cents: i.totalCents, lines: i.lines })),
      lender_outreach: f.outreach.map((o) => ({ id: o.id, deal_id: o.dealId, lender_id: o.lenderId, status: o.status, created_at: o.createdAt, updated_at: o.updatedAt, sent_at: o.sentAt })),
      lender_panel: f.lenders.map((l) => ({ id: l.id, name: l.name, category: l.category, broker_friendly: l.brokerFriendly })),
      leads: f.leads.map((l) => ({ id: l.id, source: l.source, created_at: l.createdAt })),
      lead_source_costs: f.costs.map((c) => ({ source: c.source, period_start: c.periodStart, period_end: c.periodEnd, spend_cents: c.spendCents })),
    });
    const loaded = await new SupabaseReportingSource(db).load();
    expect(buildReports(loaded, { range: "90d", now: FIXTURE_NOW })).toEqual(buildReports(f, { range: "90d", now: FIXTURE_NOW }));
  });
});
