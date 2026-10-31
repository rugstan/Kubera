import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fromRow, supabaseApprovalStore, toInsertRow, type ApprovalRow } from "./supabase-store";
import type { NewApproval } from "./store";

const row: ApprovalRow = {
  id: "a1",
  created_at: "2026-11-03T17:00:00Z",
  kind: "email",
  idempotency_key: "email:x:000001",
  summary: "Send it",
  template_id: null,
  payload: { to: "x@example.com" },
  payload_sha256: "a".repeat(64),
  requested_by: "agent:test",
  requested_by_user: null,
  deal_id: null,
  lead_id: null,
  status: "pending",
  expires_at: "2026-11-03T18:00:00Z",
  decided_at: null,
  decided_by: null,
  decided_by_label: null,
  decided_by_dre: null,
  decision_reason: null,
  auto_approved: false,
  executed_at: null,
  execution_ref: null,
};

/** Records the PostgREST builder calls and answers with `result`. */
function recorder(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "update", "upsert", "insert", "eq", "gt", "is", "not", "in", "order", "limit"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  const rpc = vi.fn(async () => result);
  const db = { from: (t: string) => (calls.push(["from", t]), builder), rpc } as unknown as SupabaseClient;
  return { db, calls, rpc };
}

describe("supabase approval store", () => {
  it("maps rows both ways", () => {
    const rec = fromRow(row);
    expect(rec).toMatchObject({ id: "a1", idempotencyKey: "email:x:000001", status: "pending", payload: { to: "x@example.com" } });
    expect(fromRow({ ...row, status: "weird", payload: null })).toMatchObject({ status: "pending", payload: {} });
    const insert = toInsertRow(rec as unknown as NewApproval, new Date("2026-11-03T17:00:00Z"));
    expect(insert).toMatchObject({ idempotency_key: "email:x:000001", status: "pending", created_at: "2026-11-03T17:00:00.000Z" });
  });

  it("decides only pending rows, and approvals only before expiry", async () => {
    const { db, calls } = recorder({ data: [{ ...row, status: "approved" }], error: null });
    const store = supabaseApprovalStore(db);
    const now = new Date("2026-11-03T17:30:00Z");
    const r = await store.decide("a1", { status: "approved", decidedBy: "u1", decidedByLabel: "Pat", decidedByDre: "01234567", decisionReason: null }, now);
    expect(r?.status).toBe("approved");
    expect(calls).toContainEqual(["eq", "status", "pending"]);
    expect(calls).toContainEqual(["gt", "expires_at", now.toISOString()]);
  });

  it("treats the guard trigger's expiry refusal as 'not decided'", async () => {
    const { db } = recorder({ data: null, error: { message: "approval a1 expired at 2026-11-03" } });
    const store = supabaseApprovalStore(db);
    expect(await store.decide("a1", { status: "approved", decidedBy: "u1", decidedByLabel: "Pat", decidedByDre: "01234567", decisionReason: null }, new Date())).toBeNull();
  });

  it("claims execution conditionally and sweeps expiry on the database clock", async () => {
    const { db, calls, rpc } = recorder({ data: [], error: null });
    const store = supabaseApprovalStore(db);
    expect(await store.claimExecution("a1", new Date())).toBeNull();
    expect(calls).toContainEqual(["eq", "status", "approved"]);
    expect(calls).toContainEqual(["is", "executed_at", null]);
    await store.expireDue(new Date());
    expect(rpc).toHaveBeenCalledWith("expire_due_approvals");
  });

  it("returns the existing row when the idempotency key was taken", async () => {
    let n = 0;
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "upsert", "eq"]) builder[m] = () => builder;
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    builder.maybeSingle = async () => ({ data: row, error: null });
    const db = { from: () => (n++, builder) } as unknown as SupabaseClient;
    const { record, created } = await supabaseApprovalStore(db).insertIfAbsent(fromRow(row) as unknown as NewApproval, new Date());
    expect(created).toBe(false);
    expect(record.id).toBe("a1");
    expect(n).toBe(2);
  });
});
