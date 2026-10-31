// WS-L migration on PGlite: RLS, the review-queue and source constraints, the
// one-live-extraction rule, append-only events, immutable versioned spreads,
// cascades with the vault document, and the no-custody guard.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, custodyViolations, listMigrations } from "../../../scripts/test-migrations.ts";

let db: PGlite;
let leadId: string;
let docId: string;
let dealId: string;

const TABLES = ["document_extractions", "document_extraction_events", "construction_budgets", "spreads"];

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
  leadId = (
    await db.query<{ id: string }>(
      `insert into public.leads (source, contact, intake, decision, engine, latency_ms) values ('website', '{}', '{}', '{}', 'rules', 1) returning id`,
    )
  ).rows[0]!.id;
  docId = (
    await db.query<{ id: string }>(
      `insert into public.documents (lead_id, kind, storage_path, file_name, content_type) values ($1, 'T12', $2, 't12.csv', 'text/csv') returning id`,
      [leadId, `${leadId}/t12.csv`],
    )
  ).rows[0]!.id;
  dealId = (await db.query<{ id: string }>(`insert into public.deals (name, lead_id) values ('Sunset Gardens', $1) returning id`, [leadId])).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const insertExtraction = (cols: Record<string, unknown>) => {
  const all: Record<string, unknown> = { source_type: "vault_document", document_id: docId, lead_id: leadId, doc_type: "T12", source_format: "csv", engine: "rules", status: "extracted", ...cols };
  const keys = Object.keys(all);
  return db.query<{ id: string }>(
    `insert into public.document_extractions (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    keys.map((k) => all[k]),
  );
};

describe("WS-L migration", () => {
  it("enables RLS on every table and denies anon and authenticated", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname = any($1)`, [TABLES]);
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const t of TABLES) await expect(db.query(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("has no funds or draw columns", async () => {
    expect(await custodyViolations(db)).toEqual([]);
    const { rows } = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = any($1)`, [TABLES]);
    expect(rows.map((r) => r.column_name).join(" ")).not.toMatch(/draw|disburs|escrow|trust_account|funds/i);
  });

  it("enforces the source, type and review-queue rules", async () => {
    await expect(insertExtraction({ document_id: null })).rejects.toThrow(/document_extractions_source/);
    await expect(insertExtraction({ doc_type: null })).rejects.toThrow(/document_extractions_typed/);
    await insertExtraction({ doc_type: null, status: "failed", error: "unclassified" });
    await expect(insertExtraction({ status: "needs_review", doc_type: "PFS" })).rejects.toThrow(/document_extractions_review_queue/);
    await expect(insertExtraction({ status: "approved", doc_type: "RENT_ROLL" })).rejects.toThrow(/document_extractions_reviewed/);
    await expect(insertExtraction({ doc_type: "W2" })).rejects.toThrow(/check constraint/);
    await expect(insertExtraction({ overall_confidence: 1.5, doc_type: "STR" })).rejects.toThrow(/check constraint/);
  });

  it("keeps one live extraction per document and type; superseded runs make room", async () => {
    const first = (await insertExtraction({ doc_type: "CENSUS" })).rows[0]!.id;
    await expect(insertExtraction({ doc_type: "CENSUS" })).rejects.toThrow(/duplicate key/);
    await db.query(`update public.document_extractions set status = 'superseded' where id = $1`, [first]);
    const second = (await insertExtraction({ doc_type: "CENSUS", status: "needs_review", low_confidence_fields: ["asOfDate"] })).rows[0]!.id;
    await db.query(`update public.document_extractions set superseded_by = $1 where id = $2`, [second, first]);
  });

  it("makes extraction events append-only", async () => {
    const id = (await insertExtraction({ doc_type: "STR" })).rows[0]!.id;
    await db.query(`insert into public.document_extraction_events (extraction_id, event_type, actor) values ($1, 'extracted', 'document-agent')`, [id]);
    await expect(db.exec(`update public.document_extraction_events set actor = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`delete from public.document_extraction_events`)).rejects.toThrow(/append-only/);
    await expect(db.query(`insert into public.document_extraction_events (extraction_id, event_type, actor) values ($1, 'paid', 'a')`, [id])).rejects.toThrow(/check constraint/);
  });

  it("keeps construction budgets coherent", async () => {
    const id = (await insertExtraction({ doc_type: "CONSTRUCTION_BUDGET" })).rows[0]!.id;
    await expect(
      db.query(`insert into public.construction_budgets (extraction_id, land_cost, hard_costs, total_cost) values ($1, 1000000, 5000000, 4000000)`, [id]),
    ).rejects.toThrow(/construction_budgets_total_covers_parts/);
    await db.query(`insert into public.construction_budgets (extraction_id, deal_id, land_cost, hard_costs, total_cost, line_items) values ($1, $2, 1000000, 5000000, 6000000, '[]')`, [id, dealId]);
    await expect(db.query(`insert into public.construction_budgets (extraction_id, line_items) values ($1, '{}')`, [id])).rejects.toThrow();
  });

  it("versions spreads and refuses edits", async () => {
    const ins = (version: number, profile: string | null = "AGENCY") =>
      db.query(`insert into public.spreads (deal_id, kind, version, lender_profile, results, created_by) values ($1, 'operating_statement', $2, $3, '{}', 'analyst')`, [dealId, version, profile]);
    await ins(1);
    await ins(2);
    await ins(1, "HUD");
    await expect(ins(2)).rejects.toThrow(/duplicate key/);
    await expect(db.exec(`update public.spreads set flags = '{x}'`)).rejects.toThrow(/immutable/);
    await expect(db.exec(`insert into public.spreads (kind, version, results, created_by) values ('quotes', 1, '{}', 'a')`)).rejects.toThrow(/spreads_subject/);
    await expect(db.query(`insert into public.spreads (deal_id, kind, version, lender_profile, results, created_by) values ($1, 'quotes', 1, 'lowercase', '{}', 'a')`, [dealId])).rejects.toThrow(/check constraint/);
  });

  it("deletes extractions, their events and budgets with the vault document, and spreads with the lead", async () => {
    await db.query(`delete from public.documents where id = $1`, [docId]);
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.document_extractions where document_id = $1`, [docId]);
    expect(left.rows[0]!.n).toBe(0);
    const ev = await db.query<{ n: number }>(`select count(*)::int as n from public.document_extraction_events`);
    expect(ev.rows[0]!.n).toBe(0);
    const budgets = await db.query<{ n: number }>(`select count(*)::int as n from public.construction_budgets`);
    expect(budgets.rows[0]!.n).toBe(0);
    await db.query(`insert into public.spreads (lead_id, kind, version, results, created_by) values ($1, 'rent_roll', 1, '{}', 'a')`, [leadId]);
    await db.query(`delete from public.deals where id = $1`, [dealId]);
    await db.query(`delete from public.leads where id = $1`, [leadId]);
    const spreads = await db.query<{ n: number }>(`select count(*)::int as n from public.spreads`);
    expect(spreads.rows[0]!.n).toBe(0);
  });
});
