// Applies the WS-P migration (on top of the consent ledger it references) to an
// in-process Postgres (PGlite) and checks RLS, the constraints and the
// updated_at trigger.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../supabase/migrations");
const CONSENT = path.join(MIGRATIONS, "20261101000200_b_consent_and_ai_conversations.sql");
const GROWTH = path.join(MIGRATIONS, "20261105010000_p_growth.sql");

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
  await db.exec(readFileSync(CONSENT, "utf8"));
  await db.exec(readFileSync(GROWTH, "utf8"));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const insert = (email: string, extra = "") =>
  db.query(`insert into public.newsletter_subscribers (email, consent_text_version${extra ? `, ${extra.split("=")[0]}` : ""}) values ('${email}', 'newsletter-signup-2026-11-05'${extra ? `, ${extra.split("=")[1]}` : ""}) returning id`);

describe("WS-P migration", () => {
  it("enables RLS and denies anon and authenticated access", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'newsletter_subscribers'");
    expect(rows[0]!.relrowsecurity).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from public.newsletter_subscribers")).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into public.newsletter_subscribers (email, consent_text_version) values ('x@y.z', 'v')")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("starts every subscriber as pending and keeps one row per address", async () => {
    const { rows } = await insert("pat@example.com");
    const row = await db.query<{ status: string; confirmation_count: number }>(`select status, confirmation_count from public.newsletter_subscribers where id = '${(rows[0] as { id: string }).id}'`);
    expect(row.rows[0]).toEqual({ status: "pending", confirmation_count: 0 });
    await expect(insert("pat@example.com")).rejects.toThrow(/duplicate key|unique/i);
  });

  it("requires lower-case addresses and a known status", async () => {
    await expect(insert("Pat@Example.com")).rejects.toThrow(/check constraint/i);
    await expect(insert("a@example.com", "status='bogus'")).rejects.toThrow(/check constraint/i);
  });

  it("requires a timestamp for confirmed and unsubscribed rows", async () => {
    await expect(insert("c@example.com", "status='confirmed'")).rejects.toThrow(/newsletter_confirmed_has_timestamp/);
    await expect(insert("u@example.com", "status='unsubscribed'")).rejects.toThrow(/newsletter_unsubscribed_has_timestamp/);
    await expect(db.query("insert into public.newsletter_subscribers (email, consent_text_version, status, confirmed_at) values ('ok@example.com', 'v', 'confirmed', now())")).resolves.toBeDefined();
  });

  it("links consent events and nulls the link when the event is removed", async () => {
    const event = await db.query<{ id: string }>(
      `insert into public.consent_events (form, text_version, text_sha256, channels, email) values ('newsletter', 'newsletter-signup-2026-11-05', '${"a".repeat(64)}', array['email'], 'link@example.com') returning id`,
    );
    const eventId = event.rows[0]!.id;
    const sub = await db.query<{ id: string }>(`insert into public.newsletter_subscribers (email, consent_text_version, signup_consent_event_id) values ('link@example.com', 'v', '${eventId}') returning id`);
    await db.query(`delete from public.consent_events where id = '${eventId}'`);
    const after = await db.query<{ signup_consent_event_id: string | null }>(`select signup_consent_event_id from public.newsletter_subscribers where id = '${sub.rows[0]!.id}'`);
    expect(after.rows[0]!.signup_consent_event_id).toBeNull();
  });

  it("refreshes updated_at on update", async () => {
    const { rows } = await db.query<{ id: string }>("insert into public.newsletter_subscribers (email, consent_text_version, updated_at) values ('t@example.com', 'v', '2020-01-01') returning id");
    await db.query(`update public.newsletter_subscribers set audience_error = 'x' where id = '${rows[0]!.id}'`);
    const after = await db.query<{ updated_at: string }>(`select updated_at from public.newsletter_subscribers where id = '${rows[0]!.id}'`);
    expect(new Date(after.rows[0]!.updated_at).getFullYear()).toBeGreaterThan(2020);
  });
});
