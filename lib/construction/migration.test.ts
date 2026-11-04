// Applies every migration (including WS-AA's) to PGlite and checks RLS, the
// constraints that back the approval-gate and no-custody rules, and the
// append-only audit trail.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, custodyViolations, listMigrations } from "../../scripts/test-migrations.ts";

let db: PGlite;
let projectId: string;

const TABLES = [
  "construction_projects",
  "construction_reports",
  "construction_contractor_checks",
  "construction_conversions",
  "construction_leaseup_snapshots",
  "construction_takeouts",
  "construction_events",
];

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
  const res = await db.query<{ id: string }>(
    `insert into public.construction_projects (name, program, asset_type, state) values ('Harbor View', 'BANK_CONSTRUCTION', 'MULTIFAMILY', 'CA') returning id`,
  );
  projectId = res.rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const insertReport = (type: string, extra = "") =>
  db.query(`insert into public.construction_reports (project_id, report_type${extra ? ", " + extra.split("|")[0] : ""}) values ('${projectId}', '${type}'${extra ? ", " + extra.split("|")[1] : ""})`);

describe("WS-AA migration", () => {
  it("enables RLS on every construction table and denies anon and authenticated", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname = any($1) order by relname`,
      [TABLES],
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from public.construction_projects")).rejects.toThrow(/permission denied|row-level security/);
      await db.exec("reset role");
    }
  });

  it("has no funds or draw columns", async () => {
    expect(await custodyViolations(db)).toEqual([]);
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name like 'construction\\_%'`,
    );
    expect(rows.map((r) => r.column_name).join(" ")).not.toMatch(/draw|disburs|escrow|trust_account|lien|funds/i);
  });

  it("allows one live report per type per project, and a replacement after cancelling", async () => {
    await insertReport("phase_i");
    await expect(insertReport("phase_i")).rejects.toThrow(/duplicate key/);
    await db.exec(`update public.construction_reports set status = 'cancelled' where project_id = '${projectId}' and report_type = 'phase_i'`);
    await insertReport("phase_i");
  });

  it("refuses to mark a report ordered without an approval id", async () => {
    await insertReport("pcna");
    await expect(
      db.exec(`update public.construction_reports set status = 'ordered', ordered_at = now() where project_id = '${projectId}' and report_type = 'pcna'`),
    ).rejects.toThrow(/construction_reports_ordered_has_approval/);
    await db.exec(
      `update public.construction_reports set status = 'ordered', ordered_at = now(), approval_id = 'appr_1' where project_id = '${projectId}' and report_type = 'pcna'`,
    );
  });

  it("rejects unknown statuses, report types and programs", async () => {
    await expect(insertReport("appraisal")).rejects.toThrow(/check constraint/);
    await expect(db.exec(`update public.construction_reports set status = 'funded' where project_id = '${projectId}'`)).rejects.toThrow(/check constraint/);
    await expect(db.exec(`insert into public.construction_projects (name, program, asset_type) values ('x', 'MAGIC', 'HOTEL')`)).rejects.toThrow(/check constraint/);
  });

  it("keeps one conversion per project and the cost certification tied to the HUD path", async () => {
    await db.exec(`insert into public.construction_conversions (project_id) values ('${projectId}')`);
    await expect(db.exec(`insert into public.construction_conversions (project_id) values ('${projectId}')`)).rejects.toThrow(/duplicate key/);
    await expect(db.exec(`update public.construction_conversions set hud_cost_cert_status = 'submitted' where project_id = '${projectId}'`)).rejects.toThrow(
      /construction_conversions_cert_path/,
    );
    await db.exec(`update public.construction_conversions set takeout_path = 'hud_conversion', hud_cost_cert_status = 'submitted' where project_id = '${projectId}'`);
    await expect(db.exec(`update public.construction_conversions set payoff_status = 'payoff_confirmed' where project_id = '${projectId}'`)).rejects.toThrow(
      /construction_conversions_payoff_confirmed/,
    );
  });

  it("keeps lease-up snapshots coherent and one per date", async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.construction_conversions where project_id = '${projectId}'`);
    const cid = rows[0]!.id;
    await db.exec(`insert into public.construction_leaseup_snapshots (conversion_id, as_of, units_leased, units_occupied) values ('${cid}', '2026-10-01', 50, 40)`);
    await expect(
      db.exec(`insert into public.construction_leaseup_snapshots (conversion_id, as_of, units_leased, units_occupied) values ('${cid}', '2026-10-01', 50, 40)`),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      db.exec(`insert into public.construction_leaseup_snapshots (conversion_id, as_of, units_leased, units_occupied) values ('${cid}', '2026-10-02', 10, 40)`),
    ).rejects.toThrow(/construction_leaseup_occupied_within_leased/);
  });

  it("allows one take-out per conversion and requires a deal id once the deal is created", async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.construction_conversions where project_id = '${projectId}'`);
    const cid = rows[0]!.id;
    await db.exec(`insert into public.construction_takeouts (conversion_id, reasons) values ('${cid}', array['stabilized_occupancy'])`);
    await expect(db.exec(`insert into public.construction_takeouts (conversion_id) values ('${cid}')`)).rejects.toThrow(/duplicate key/);
    await expect(db.exec(`update public.construction_takeouts set status = 'deal_created' where conversion_id = '${cid}'`)).rejects.toThrow(/construction_takeouts_deal_created/);
    await expect(db.exec(`update public.construction_takeouts set reasons = array['because'] where conversion_id = '${cid}'`)).rejects.toThrow(/check constraint/);
  });

  it("only records a clear license check when there are no issues", async () => {
    await expect(
      db.exec(
        `insert into public.construction_contractor_checks (project_id, license_number, status, issues, checked_by) values ('${projectId}', '1234567', 'clear', array['no_bond_on_file'], 'a')`,
      ),
    ).rejects.toThrow(/construction_checks_issues_status/);
    await expect(
      db.exec(`insert into public.construction_contractor_checks (project_id, license_number, status, checked_by) values ('${projectId}', 'ABC', 'clear', 'a')`),
    ).rejects.toThrow(/check constraint/);
  });

  it("makes the audit trail append-only", async () => {
    await db.exec(`insert into public.construction_events (project_id, event_type, actor) values ('${projectId}', 'project_created', 'a')`);
    await expect(db.exec(`update public.construction_events set actor = 'b' where project_id = '${projectId}'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`delete from public.construction_events where project_id = '${projectId}'`)).rejects.toThrow(/append-only/);
  });

  it("deletes a project's history with the project", async () => {
    await db.exec(`delete from public.construction_projects where id = '${projectId}'`);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.construction_events where project_id = '${projectId}'`);
    expect(rows[0]!.n).toBe(0);
  });
});
