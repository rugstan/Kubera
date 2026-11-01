import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, custodyViolations, lintMigrationNames, lintWorkstreamSlots, listMigrations, runMigrationTests } from "./test-migrations.ts";

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kubera-migrations-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
  return dir;
}

describe("migration harness", () => {
  it("applies every real migration to PGlite and keeps RLS on every public table", async () => {
    const report = await runMigrationTests();
    expect(report.problems).toEqual([]);
    expect(report.applied).toContain("20261031000000_init.sql");
    expect(report.publicTables).toEqual(expect.arrayContaining(["leads", "partners", "documents", "kb_chunks"]));
  }, 60_000);

  it("applies the CRM retry columns to leads and partners", async () => {
    const db = await createStubbedDb();
    try {
      await applyMigrations(db, listMigrations());
      const cols = await db.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public' and column_name in ('crm_attempts', 'crm_last_attempt_at')`,
      );
      const key = (r: { table_name: string; column_name: string }) => `${r.table_name}.${r.column_name}`;
      expect(cols.rows.map(key).sort()).toEqual([
        "leads.crm_attempts",
        "leads.crm_last_attempt_at",
        "partners.crm_attempts",
        "partners.crm_last_attempt_at",
      ]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("installs the no-custody guard and finds no funds or draw columns", async () => {
    const db = await createStubbedDb();
    try {
      await applyMigrations(db, listMigrations());
      const fn = await db.query<{ ok: boolean }>(`select to_regprocedure('public.custody_column_violations()') is not null as ok`);
      expect(fn.rows[0]?.ok).toBe(true);
      expect(await custodyViolations(db)).toEqual([]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("reports a public table that forgot to enable RLS", async () => {
    const dir = fixtureDir({
      "20261101009900_bad.sql": "create table public.oops (id int primary key);",
      "20261101009800_good.sql": "create table public.fine (id int primary key); alter table public.fine enable row level security;",
    });
    const report = await runMigrationTests(dir);
    expect(report.tablesWithoutRls).toEqual(["oops"]);
    expect(report.problems).toEqual(["public.oops: row level security is not enabled"]);
  }, 60_000);

  it("names the failing migration when SQL is invalid", async () => {
    const dir = fixtureDir({ "20261101009900_broken.sql": "create tabel nope (id int);" });
    await expect(runMigrationTests(dir)).rejects.toThrow(/20261101009900_broken\.sql failed/);
  }, 60_000);

  it("lints migration file names", () => {
    expect(
      lintMigrationNames([
        { name: "20261101050000_ok_name.sql", timestamp: "20261101050000" },
        { name: "20261101050000_dupe.sql", timestamp: "20261101050000" },
        { name: "init.sql", timestamp: "" },
        { name: "20261101060000_BadCase.sql", timestamp: "" },
      ]),
    ).toEqual([
      "20261101050000_dupe.sql: duplicate timestamp 20261101050000",
      "init.sql: must match <14-digit timestamp>_<snake_case>.sql",
      "20261101060000_BadCase.sql: must match <14-digit timestamp>_<snake_case>.sql",
    ]);
  });

  it("rejects workstream migrations outside the phase/slot pattern, with an allowlist for the legacy files", () => {
    const f = (name: string) => ({ name, timestamp: name.slice(0, 14) });
    expect(
      lintWorkstreamSlots([
        f("20261031000000_init.sql"),
        f("20261101000500_e_ok.sql"),
        f("20261105000100_p_ok.sql"),
        f("20261105005700_int_r1_fix.sql"),
        f("20261101050000_e_crm_retry.sql"),
        f("20261101050100_e_crm_progress.sql"),
        f("20261105010000_p_growth.sql"),
        f("20261101050200_e_new.sql"),
        f("20261105000000_p_slot_zero.sql"),
        f("20261106000100_x_phase_six.sql"),
      ]),
    ).toEqual([
      expect.stringContaining("20261101050200_e_new.sql"),
      expect.stringContaining("20261105000000_p_slot_zero.sql"),
      expect.stringContaining("20261106000100_x_phase_six.sql"),
    ]);
  });

  it("passes the slot check for every real migration", () => {
    expect(lintWorkstreamSlots(listMigrations())).toEqual([]);
  });
});
