// Applies every migration to PGlite (with the Supabase stubs) and checks the
// WS-M tables: RLS, approval shape of credit boxes, one box per registration,
// quote review shape, one quote per mail message, and the audit trigger.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "../../../scripts/test-migrations.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

async function lender(): Promise<string> {
  return (await one<{ id: string }>(`insert into public.lender_panel (name, category, programs, updated_by) values ('Cambridge', 'STATE_BANK', '{HUD_232}', 'broker:ana') returning id`)).id;
}
async function partner(): Promise<string> {
  return (await one<{ id: string }>(`insert into public.partners (partner_type, organization, email, profile) values ('LENDER', 'Pacific', 'l@p.example', '{}') returning id`)).id;
}
async function deal(): Promise<string> {
  return (await one<{ id: string }>(`insert into public.deals (title, program, stage, stage_template_version, updated_by) values ('Deal', 'HUD_232', 'intake', 1, 'broker:ana') returning id`)).id;
}

describe("WS-M migration", () => {
  it("enables RLS and denies the API roles", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname in ('credit_boxes', 'quotes')`);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const t of ["credit_boxes", "quotes"]) await expect(db.query(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("holds an approved box to a lender, programs and a review", async () => {
    const p = await partner();
    await expect(db.query(`insert into public.credit_boxes (source, status, label) values ('staff', 'pending_review', 'x')`)).rejects.toThrow(/credit_boxes_owner/);
    await expect(db.query(`insert into public.credit_boxes (partner_id, source, status, label, programs) values ($1, 'partner_registration', 'approved', 'x', '{HUD_232}')`, [p])).rejects.toThrow(/credit_boxes_approved_shape/);
    const l = await lender();
    const id = (
      await one<{ id: string }>(`insert into public.credit_boxes (lender_id, partner_id, source, status, label, programs, updated_by) values ($1, $2, 'partner_registration', 'pending_review', 'x', '{HUD_232}', 'broker:ana') returning id`, [l, p])
    ).id;
    await expect(db.query(`insert into public.credit_boxes (partner_id, source, status, label) values ($1, 'partner_registration', 'pending_review', 'dup')`, [p])).rejects.toThrow(/credit_boxes_partner_registration_uidx/);
    await expect(db.query(`update public.credit_boxes set status = 'approved' where id = $1`, [id])).rejects.toThrow(/credit_boxes_approved_shape/);
    await db.query(`update public.credit_boxes set status = 'approved', reviewed_at = now(), reviewed_by = 'broker:lee', updated_by = 'broker:lee' where id = $1`, [id]);
    await expect(db.query(`update public.credit_boxes set status = 'rejected' where id = $1`, [id])).rejects.toThrow(/credit_boxes_rejected_reason/);
    await expect(db.query(`insert into public.credit_boxes (lender_id, source, status, label, asset_classes) values ($1, 'staff', 'pending_review', 'x', '{CASINO}')`, [l])).rejects.toThrow(/check constraint/);
    const audit = await db.query<{ action: string; actor: string }>(`select action, actor from public.audit_log where table_name = 'credit_boxes' and row_id = $1 order by id`, [id]);
    expect(audit.rows.map((r) => [r.action, r.actor])).toEqual([
      ["INSERT", "broker:ana"],
      ["UPDATE", "broker:lee"],
    ]);
  });

  it("keeps unreviewed low-confidence quotes out of use and one quote per mail message", async () => {
    const d = await deal();
    const base = `insert into public.quotes (deal_id, lender_name, source, status, terms, parser, received_at, idempotency_key, low_confidence_fields, mail_message_id)`;
    await expect(db.query(`${base} values ($1, 'X', 'email_parse', 'active', '{}', 'rules', now(), 'k1', '{ratePct}', null)`, [d])).rejects.toThrow(/quotes_review_shape/);
    const q = (await one<{ id: string }>(`${base} values ($1, 'X', 'email_parse', 'needs_review', '{}', 'rules', now(), 'k2', '{ratePct}', null) returning id`, [d])).id;
    await db.query(`update public.quotes set status = 'declined' where id = $1`, [q]);
    await db.query(`update public.quotes set status = 'active', reviewed_at = now(), reviewed_by = 'broker:ana' where id = $1`, [q]);
    await expect(db.query(`${base} values ($1, 'X', 'email_parse', 'needs_review', '{}', 'rules', now(), 'k2', '{}', null)`, [d])).rejects.toThrow(/duplicate key/);
    await expect(db.query(`${base} values ($1, 'X', 'staff', 'bogus', '{}', 'staff', now(), 'k3', '{}', null)`, [d])).rejects.toThrow(/check constraint/);
  });
});
