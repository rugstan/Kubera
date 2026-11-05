// Applies every migration to PGlite and checks ai_task_models (which model each
// AI task runs on): RLS, the append-only trigger, the shape checks, and the one
// update it allows (a deleted profile nulls set_by).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, custodyViolations, listMigrations } from "../../scripts/test-migrations.ts";
import { fromRow, type TaskModelSetting } from "./model-settings";

const ADMIN = "44444444-4444-4444-8444-444444444444";
let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
  // Supabase grants the API roles on new tables by default; the migration must take that back.
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    revoke all on public.ai_task_models from anon, authenticated;
  `);
  await db.query(`insert into auth.users (id, email) values ($1, 'ops@corincommercial.com')`, [ADMIN]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const insert = (cols: Record<string, unknown>) => {
  const keys = Object.keys(cols);
  return db.query(`insert into public.ai_task_models (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(cols));
};

const row = (over: Record<string, unknown> = {}) => ({
  task: "mail.triage",
  model: "claude-sonnet-5-5",
  previous_model: "claude-haiku-5-5",
  set_by: ADMIN,
  set_by_label: "Ops Admin",
  reason: "Haiku misfiles lender replies",
  ...over,
});

describe("ai_task_models migration", () => {
  it("enables RLS and denies the API roles", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'ai_task_models' and relkind = 'r'`);
    expect(rows).toEqual([{ relrowsecurity: true }]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query(`select * from public.ai_task_models`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into public.ai_task_models (task, previous_model, set_by_label, reason) values ('mail.triage', 'x', 'x', 'x')`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("stores a choice and a return to the default, and maps rows for the app", async () => {
    const chosen = await insert(row());
    const back = await insert(row({ model: null, previous_model: "claude-sonnet-5-5", reason: "Back to the default after the test week" }));
    const setting: TaskModelSetting = fromRow(chosen.rows[0] as Parameters<typeof fromRow>[0]);
    expect(setting).toMatchObject({ task: "mail.triage", model: "claude-sonnet-5-5", previousModel: "claude-haiku-5-5", setBy: ADMIN, setByLabel: "Ops Admin", reason: "Haiku misfiles lender replies" });
    expect((back.rows[0] as { model: string | null }).model).toBeNull();
    // Newest first per task is what the store reads.
    const { rows } = await db.query<{ model: string | null }>(`select model from public.ai_task_models where task = 'mail.triage' order by id desc limit 1`);
    expect(rows[0]!.model).toBeNull();
  });

  it("checks task ids, model ids, labels and reasons", async () => {
    await expect(insert(row({ task: "Mail Triage" }))).rejects.toThrow(/check/);
    await expect(insert(row({ model: "" }))).rejects.toThrow(/check/);
    await expect(insert(row({ model: "claude sonnet" }))).rejects.toThrow(/check/);
    await expect(insert(row({ model: "m".repeat(101) }))).rejects.toThrow(/check/);
    await expect(insert(row({ previous_model: null }))).rejects.toThrow(/null/);
    await expect(insert(row({ set_by_label: "" }))).rejects.toThrow(/check/);
    await expect(insert(row({ reason: "" }))).rejects.toThrow(/check/);
    await expect(insert(row({ reason: "   " }))).rejects.toThrow(/check/);
    await expect(insert(row({ reason: "r".repeat(1001) }))).rejects.toThrow(/check/);
    await expect(insert(row({ set_by: "55555555-5555-4555-8555-555555555555" }))).rejects.toThrow(/foreign key/);
  });

  it("is append-only: no update, delete or truncate", async () => {
    await insert(row({ task: "crm.call_summary", model: "claude-opus-5-5", previous_model: "claude-sonnet-5-5" }));
    await expect(db.query(`update public.ai_task_models set model = 'claude-haiku-5-5' where task = 'crm.call_summary'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`update public.ai_task_models set set_by = null where task = 'crm.call_summary'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.ai_task_models where task = 'crm.call_summary'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`truncate public.ai_task_models`)).rejects.toThrow(/append-only/);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.ai_task_models where task = 'crm.call_summary'`);
    expect(rows[0]!.n).toBe(1);
  });

  it("keeps the history when the admin's profile is deleted (set_by becomes null)", async () => {
    const gone = "66666666-6666-4666-8666-666666666666";
    await db.query(`insert into auth.users (id, email) values ($1, 'former@corincommercial.com')`, [gone]);
    await insert(row({ task: "lenders.term_sheet", model: "claude-sonnet-5-5", previous_model: "claude-opus-5-5", set_by: gone, set_by_label: "Former Admin" }));
    await db.query(`delete from public.profiles where id = $1`, [gone]);
    const { rows } = await db.query<{ set_by: string | null; set_by_label: string; model: string }>(`select set_by, set_by_label, model from public.ai_task_models where task = 'lenders.term_sheet'`);
    expect(rows).toEqual([{ set_by: null, set_by_label: "Former Admin", model: "claude-sonnet-5-5" }]);
  });

  it("adds no funds or draw columns", async () => {
    expect(await custodyViolations(db)).toEqual([]);
  });
});
