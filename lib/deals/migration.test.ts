// Applies every migration to PGlite (with the Supabase stubs) and checks the
// WS-T deal-desk guards: RLS, the trigger-written append-only audit log, term
// locks, frozen ledger entries, locked package versions and share-link access.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";

let db: PGlite;

const T_TABLES = ["stage_templates", "lender_panel", "deal_packages", "share_links", "lender_outreach", "fee_ledger", "invoices", "deal_modifications", "sba_form159", "dre_reporting", "audit_log"];

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const sha = (c: string) => c.repeat(64);

async function deal(extra = ""): Promise<string> {
  return (await one<{ id: string }>(`insert into public.deals (title, program, stage, stage_template_version, loan_amount_cents, updated_by${extra ? `, ${extra.split("=")[0]}` : ""})
    values ('Test deal', 'HUD_232', 'intake', 1, 100000000, 'broker:ana'${extra ? `, ${extra.split("=")[1]}` : ""}) returning id`)).id;
}

async function lender(): Promise<string> {
  return (await one<{ id: string }>(`insert into public.lender_panel (name, category, programs, updated_by) values ('Cambridge', 'STATE_BANK', '{HUD_232}', 'broker:ana') returning id`)).id;
}

describe("WS-T migration", () => {
  it("enables RLS on every deal-desk table and denies the API roles", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname = any($1::text[])`, [[...T_TABLES, "deals"]]);
    expect(rows).toHaveLength(T_TABLES.length + 1);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const t of ["fee_ledger", "share_links", "audit_log"]) await expect(db.query(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("writes an audit row for every insert and update, with the actor and changed columns", async () => {
    const id = await deal();
    await db.query(`update public.deals set stage = 'engaged', updated_by = 'broker:lee' where id = $1`, [id]);
    const { rows } = await db.query<{ action: string; actor: string; changed: string[]; deal_id: string }>(`select action, actor, changed, deal_id from public.audit_log where table_name = 'deals' and row_id = $1 order by id`, [id]);
    expect(rows.map((r) => r.action)).toEqual(["INSERT", "UPDATE"]);
    expect(rows[0]!.actor).toBe("broker:ana");
    expect(rows[1]).toMatchObject({ actor: "broker:lee", deal_id: id });
    expect(rows[1]!.changed).toEqual(["stage", "updated_by"]);
  });

  it("keeps audit_log append-only", async () => {
    await deal();
    await expect(db.query(`update public.audit_log set actor = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.audit_log`)).rejects.toThrow(/append-only/);
    await expect(db.query(`truncate public.audit_log`)).rejects.toThrow(/append-only/);
  });

  it("locks economic terms after term-sheet acceptance unless a new modification reference comes with the change", async () => {
    const id = await deal();
    await db.query(`update public.deals set term_sheet_accepted_at = now(), locked_terms = '{"noteRatePct": 6}' where id = $1`, [id]);
    await expect(db.query(`update public.deals set loan_amount_cents = 1 where id = $1`, [id])).rejects.toThrow(/locked/);
    await expect(db.query(`update public.deals set locked_terms = '{"noteRatePct": 7}' where id = $1`, [id])).rejects.toThrow(/locked/);
    await db.query(`update public.deals set title = 'Renamed' where id = $1`, [id]);
    await db.query(`update public.deals set loan_amount_cents = 2, lock_override_ref = 'mod-1' where id = $1`, [id]);
    await expect(db.query(`update public.deals set loan_amount_cents = 3 where id = $1`, [id])).rejects.toThrow(/locked/);
  });

  it("freezes invoiced ledger entries and never deletes them", async () => {
    const id = await deal();
    const fee = (await one<{ id: string }>(`insert into public.fee_ledger (deal_id, entry_kind, payer, payee, basis, amount_cents, status, description, idempotency_key)
      values ($1, 'broker_fee', 'borrower', 'kubera', 'flat', 100000, 'earned', 'Broker fee', $2) returning id`, [id, `k-${id}`])).id;
    await expect(db.query(`insert into public.fee_ledger (deal_id, entry_kind, payer, payee, basis, amount_cents, status, description, idempotency_key)
      values ($1, 'broker_fee', 'kubera', 'kubera', 'flat', 1, 'earned', 'bad', $2)`, [id, `bad-${id}`])).rejects.toThrow(/fee_ledger_party_shape/);
    await db.query(`update public.fee_ledger set status = 'invoiced' where id = $1`, [fee]);
    await expect(db.query(`update public.fee_ledger set amount_cents = 5 where id = $1`, [fee])).rejects.toThrow(/cannot change amount/);
    await expect(db.query(`delete from public.fee_ledger where id = $1`, [fee])).rejects.toThrow(/never deleted/);
    await db.query(`update public.fee_ledger set status = 'settled' where id = $1`, [fee]);
    await expect(db.query(`update public.fee_ledger set status = 'earned' where id = $1`, [fee])).rejects.toThrow(/final/);
    await expect(db.query(`update public.fee_ledger set status = 'void' where id = $1`, [fee])).rejects.toThrow(/final/);
  });

  it("makes locked package versions immutable and serves share links only while valid", async () => {
    const id = await deal();
    const l = await lender();
    const pkg = (await one<{ id: string }>(`insert into public.deal_packages (deal_id, version, status, manifest, manifest_sha256, locked_at, locked_by)
      values ($1, 1, 'locked', '[]', $2, now(), 'broker:ana') returning id`, [id, sha("a")])).id;
    await expect(db.query(`update public.deal_packages set manifest = '[{"x":1}]' where id = $1`, [pkg])).rejects.toThrow(/locked/);
    await expect(db.query(`delete from public.deal_packages where id = $1`, [pkg])).rejects.toThrow(/locked/);
    await expect(db.query(`insert into public.deal_packages (deal_id, version, status, manifest, manifest_sha256) values ($1, 2, 'locked', '[]', $2)`, [id, sha("b")])).rejects.toThrow(/deal_packages_locked_shape/);

    await expect(db.query(`insert into public.share_links (deal_id, lender_id, package_id, package_version, token_hash, created_by, expires_at)
      values ($1, $2, $3, 1, $4, 'broker:ana', now() + interval '31 days')`, [id, l, pkg, sha("c")])).rejects.toThrow(/share_links_expiry/);
    await db.query(`insert into public.share_links (deal_id, lender_id, package_id, package_version, token_hash, created_by, expires_at)
      values ($1, $2, $3, 1, $4, 'broker:ana', now() + interval '7 days')`, [id, l, pkg, sha("d")]);
    const hit = await db.query<{ access_count: number }>(`select access_count from public.record_share_link_access($1)`, [sha("d")]);
    expect(hit.rows[0]!.access_count).toBe(1);
    await db.query(`update public.share_links set revoked_at = now(), revoked_by = 'broker:ana' where token_hash = $1`, [sha("d")]);
    expect((await db.query(`select * from public.record_share_link_access($1)`, [sha("d")])).rows).toHaveLength(0);
  });

  it("requires sent outreach to carry its share link, and published stage templates are immutable", async () => {
    const id = await deal();
    const l = await lender();
    const pkg = (await one<{ id: string }>(`insert into public.deal_packages (deal_id, version, status, manifest, manifest_sha256, locked_at, locked_by) values ($1, 1, 'locked', '[]', $2, now(), 'a') returning id`, [id, sha("e")])).id;
    await expect(db.query(`insert into public.lender_outreach (deal_id, lender_id, package_id, package_version, status, approval_key, requested_by, sent_at)
      values ($1, $2, $3, 1, 'sent', 'k1', 'a', now())`, [id, l, pkg])).rejects.toThrow(/lender_outreach_sent_shape/);
    await db.query(`insert into public.stage_templates (program, version, name, stages, events, digest) values ('HUD_232', 1, 'HUD', '[]', '[]', $1)`, [sha("f")]);
    await expect(db.query(`update public.stage_templates set name = 'x'`)).rejects.toThrow(/immutable/);
  });

  it("keeps WS-I's name / loan_amount_usd and the deal desk's title / loan_amount_cents in step", async () => {
    const id = await deal();
    expect(await one(`select name, title, loan_amount_usd::float8 as usd from public.deals where id = $1`, [id])).toEqual({ name: "Test deal", title: "Test deal", usd: 1000000 });
    await db.query(`update public.deals set name = 'Pipeline rename', loan_amount_usd = 2500000 where id = $1`, [id]);
    expect(await one(`select title, loan_amount_cents::int8::text as cents from public.deals where id = $1`, [id])).toEqual({ title: "Pipeline rename", cents: "250000000" });
    const fromPipeline = (await one<{ id: string }>(`insert into public.deals (name, loan_amount_usd) values ('From pipeline', 12.34) returning id`)).id;
    expect(await one(`select title, loan_amount_cents::int8::text as cents, stage from public.deals where id = $1`, [fromPipeline])).toEqual({ title: "From pipeline", cents: "1234", stage: "intake" });
  });

  it("has no funds or draw columns (no-custody guard)", async () => {
    const { rows } = await db.query(`select * from public.custody_column_violations()`);
    expect(rows).toEqual([]);
    await expect(db.exec(`alter table public.fee_ledger add column escrow_balance numeric`)).rejects.toThrow(/No-custody guard/);
  });
});
