// Applies the WS-B migration to an in-process Postgres (PGlite) on top of
// minimal stand-ins for the tables and roles it references, then checks
// RLS, the append-only trigger and the column constraints.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = path.resolve(import.meta.dirname, "../../supabase/migrations/20261101000200_b_consent_and_ai_conversations.sql");
const SHA = "a".repeat(64);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create table public.leads (id uuid primary key default gen_random_uuid());
    create table public.partners (id uuid primary key default gen_random_uuid());
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  `);
  await db.exec(readFileSync(MIGRATION, "utf8"));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const insertConsent = (extra = "", values = "") =>
  db.query(
    `insert into public.consent_events (form, text_version, text_sha256, channels, email${extra}) values ('qualifier', 'qualifier-contact-2026-10-31', '${SHA}', array['phone','sms','email'], 'pat@example.com'${values}) returning id`,
  );

describe("WS-B migration", () => {
  it("enables RLS on both tables", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('consent_events', 'ai_conversations') order by relname",
    );
    expect(rows).toEqual([
      { relname: "ai_conversations", relrowsecurity: true },
      { relname: "consent_events", relrowsecurity: true },
    ]);
  });

  it("denies anon and authenticated access", async () => {
    await insertConsent();
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from public.consent_events")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.ai_conversations")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("makes consent events append-only", async () => {
    const { rows } = await insertConsent();
    const id = (rows[0] as { id: string }).id;
    await expect(db.query(`update public.consent_events set email = 'x@y.z' where id = '${id}'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`update public.consent_events set channels = array['sms'] where id = '${id}'`)).rejects.toThrow(/append-only/);
  });

  it("lets the lead FK cascade null out on deletion", async () => {
    const lead = (await db.query<{ id: string }>("insert into public.leads default values returning id")).rows[0]!.id;
    const { rows } = await insertConsent(", lead_id", `, '${lead}'`);
    await db.query(`delete from public.leads where id = '${lead}'`);
    const after = await db.query<{ lead_id: string | null }>(`select lead_id from public.consent_events where id = '${(rows[0] as { id: string }).id}'`);
    expect(after.rows[0]!.lead_id).toBeNull();
  });

  it("enforces consent column constraints", async () => {
    await expect(db.query(`insert into public.consent_events (form, text_version, text_sha256, email) values ('qualifier', 'v', 'not-a-hash', 'a@b.co')`)).rejects.toThrow();
    await expect(db.query(`insert into public.consent_events (form, text_version, text_sha256, channels, email) values ('qualifier', 'v', '${SHA}', array['fax'], 'a@b.co')`)).rejects.toThrow();
    await expect(db.query(`insert into public.consent_events (form, text_version, text_sha256) values ('qualifier', 'v', '${SHA}')`)).rejects.toThrow(/contact_present/);
    await expect(db.query(`insert into public.consent_events (event_type, form, text_version, text_sha256, email) values ('maybe', 'qualifier', 'v', '${SHA}', 'a@b.co')`)).rejects.toThrow();
  });

  it("stores conversations as a JSON array with a bounded turn count", async () => {
    const { rows } = await db.query<{ id: string; messages: unknown; turn_count: number; flagged: boolean }>(
      "insert into public.ai_conversations (ip_hash) values ('abc') returning id, messages, turn_count, flagged",
    );
    expect(rows[0]).toMatchObject({ messages: [], turn_count: 0, flagged: false });
    await expect(db.query(`update public.ai_conversations set messages = '{}'::jsonb where id = '${rows[0]!.id}'`)).rejects.toThrow();
    await expect(db.query(`update public.ai_conversations set turn_count = 51 where id = '${rows[0]!.id}'`)).rejects.toThrow();
  });

  it("has no funds or draw columns", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name in ('consent_events', 'ai_conversations')",
    );
    for (const { column_name } of rows) expect(column_name).not.toMatch(/disbursement|escrow_balance|trust_account|draw_amount/);
  });
});
