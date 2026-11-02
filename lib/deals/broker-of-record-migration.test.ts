// Applies every migration to PGlite and writes the deal desk's loan-level
// broker-of-record row (lib/deals/broker-of-record.ts → brokerOfRecordRow)
// into public.broker_of_record, so every column the row builder emits exists
// (20261105036100_int_r3_broker_of_record_file.sql) and reads back the same.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brokerOfRecordRow } from "@/lib/disclosures/broker-of-record";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";
import { loanBrokerOfRecordFromRow } from "./rows";
import { fullElements } from "./test-fixtures";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function insert(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cols = Object.keys(row);
  const values = cols.map((c) => (row[c] !== null && typeof row[c] === "object" && !Array.isArray(row[c]) ? JSON.stringify(row[c]) : c === "negotiation_log" ? JSON.stringify(row[c]) : row[c]));
  const res = await db.query<Record<string, unknown>>(`insert into public.broker_of_record (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, values);
  return res.rows[0]!;
}

describe("broker_of_record loan file columns", () => {
  it("stores the lender's charges, the effective rate and the names on the loan documents", async () => {
    const deal = (await db.query<{ id: string }>(`insert into public.deals (name, program, stage) values ('Maple', 'HARD_MONEY', 'intake') returning id`)).rows[0]!.id;
    const row = brokerOfRecordRow({
      recordKind: "loan",
      dealId: deal,
      lender: { name: "Pacific Bridge Partners LLC", category: "PRIVATE_NON_EXEMPT" },
      collateral: { realPropertyLien: true, equityPledgeOrUccOnly: false, apn: "001-002-003", lienPosition: 1 },
      noteRatePct: 9.5,
      fedDiscountRatePct: 4.5,
      lenderCharges: { lenderPointsPct: 1, termMonths: 6 },
      elements: fullElements,
      transactionDate: "2026-11-20",
      deedBeneficiaryName: "Corin Commercial, Inc.",
      originatorName: "Pacific Bridge Partners LLC",
    });
    const stored = await insert(row);
    expect(stored).toMatchObject({ gate_status: "blocked", names_corin_as_beneficiary: true, names_corin_as_originator: false, charges_term_months: 6 });
    expect(Number(stored.effective_rate_pct)).toBe(11.5);
    const loan = loanBrokerOfRecordFromRow(stored);
    expect(loan).toMatchObject({ noteRatePct: 9.5, lenderCharges: { lenderPointsPct: 1, termMonths: 6 }, deedBeneficiaryName: "Corin Commercial, Inc.", transactionDate: "2026-11-20" });
  });
});
