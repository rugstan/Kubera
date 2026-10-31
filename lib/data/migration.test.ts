// Applies every migration to PGlite (Supabase stubs included) and exercises
// the WS-Z property_facts cache table: RLS, uniqueness, constraints, upsert.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";
import { getPropertyFacts } from "./property-facts";
import { FakeDeedClient, FakeParcelClient } from "./fakes";
import { ADDRESS, DEED, PARCEL } from "./fixtures";
import { NO_CLIENTS } from "./clients";
import { toRow } from "./store-supabase";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const insert = async (key: string, expiresDeltaHours = 24) =>
  db.query(
    `insert into public.property_facts (address_key, address, facts, fetched_at, expires_at)
     values ($1, '{"line1":"x"}', '{}', now(), now() + ($2 || ' hours')::interval) returning id`,
    [key, String(expiresDeltaHours)],
  );

describe("WS-Z migration", () => {
  it("creates property_facts with RLS enabled and no access for client roles", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'property_facts'");
    expect(rows[0]?.relrowsecurity).toBe(true);
    const grants = await db.query<{ grantee: string }>(
      "select grantee from information_schema.role_table_grants where table_name = 'property_facts' and grantee in ('anon','authenticated')",
    );
    expect(grants.rows).toEqual([]);
    const policies = await db.query("select 1 from pg_policies where tablename = 'property_facts'");
    expect(policies.rows).toEqual([]);
  });

  it("keeps one row per address key and enforces key format", async () => {
    await insert("1 main st|fresno|ca|93721");
    await expect(insert("1 main st|fresno|ca|93721")).rejects.toThrow(/unique|duplicate/i);
    await expect(insert("1 MAIN ST|FRESNO|CA|93721")).rejects.toThrow(/check/i);
  });

  it("rejects a row that expires before it was fetched", async () => {
    await expect(insert("2 main st|fresno|ca|93721", -1)).rejects.toThrow(/check/i);
  });

  it("stores a real merged lookup via the Supabase row mapping and updates it in place", async () => {
    const facts = await getPropertyFacts(ADDRESS, {
      now: () => new Date("2026-10-31T00:00:00Z"),
      clients: { ...NO_CLIENTS, regrid: new FakeParcelClient().set(ADDRESS, PARCEL), attom: new FakeDeedClient().set(ADDRESS, DEED) },
    });
    const row = toRow(facts);
    const upsert = `insert into public.property_facts (address_key, address, apn, county, facts, source_status, fetched_at, expires_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (address_key) do update set facts = excluded.facts, apn = excluded.apn, expires_at = excluded.expires_at`;
    const args = [row.address_key, JSON.stringify(row.address), row.apn, row.county, JSON.stringify(row.facts), JSON.stringify(row.source_status), row.fetched_at, row.expires_at];
    await db.query(upsert, args);
    await db.query(upsert, args);
    const { rows } = await db.query<{ n: number; apn: string; yb: string }>(
      "select count(*)::int as n, max(apn) as apn, max(facts #>> '{yearBuilt,value}') as yb from public.property_facts where address_key = $1",
      [row.address_key],
    );
    expect(rows[0]).toEqual({ n: 1, apn: "5143-012-007", yb: "1972" });
  });

  it("touches updated_at on update", async () => {
    await insert("3 main st|fresno|ca|93721");
    const before = await db.query<{ updated_at: string }>("select updated_at from public.property_facts where address_key = '3 main st|fresno|ca|93721'");
    await new Promise((r) => setTimeout(r, 5));
    await db.query("update public.property_facts set apn = '1' where address_key = '3 main st|fresno|ca|93721'");
    const after = await db.query<{ updated_at: string }>("select updated_at from public.property_facts where address_key = '3 main st|fresno|ca|93721'");
    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThan(new Date(before.rows[0]!.updated_at).getTime());
  });
});
