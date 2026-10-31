// Applies every migration to PGlite (with the Supabase stubs) and checks the
// WS-Y tables: RLS, the legal-hold delete guard, and request constraints.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    revoke all on public.privacy_requests, public.privacy_preferences, public.retention_runs from anon, authenticated;
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0]!;
const newLead = async (extra = "") =>
  (await one<{ id: string }>(`insert into public.leads (source, contact, intake, decision, engine, latency_ms${extra ? ", legal_hold, legal_hold_reason, legal_hold_set_at" : ""})
    values ('express', '{"email":"pat@example.com"}', '{"loanAmount":1}', '{}', 'rules', 1${extra}) returning id`)).id;

function request(overrides: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    request_type: "'access'",
    status: "'pending_verification'",
    subject_email: "'pat@example.com'",
    acknowledge_by: "'2026-12-08'",
    due_at: "'2027-01-04'",
    dedupe_key: `'${"k".repeat(20)}${Math.random().toString(36).slice(2, 12)}'`,
    ...overrides,
  };
  return db.query(`insert into public.privacy_requests (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")}) returning id`);
}

describe("WS-Y migration", () => {
  it("enables RLS on the new tables and denies the API roles", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('privacy_requests', 'privacy_preferences', 'retention_runs') order by relname",
    );
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    expect(rows).toHaveLength(3);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from public.privacy_requests")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.privacy_preferences")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("adds legal-hold columns to every table the retention engine deletes from", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'legal_hold' order by table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual(["ai_conversations", "consent_events", "documents", "leads", "partners", "privacy_requests"]);
  });

  it("refuses to delete a held lead, and a lead whose document is held", async () => {
    const held = await newLead(", true, 'Litigation hold', now()");
    await expect(db.query(`delete from public.leads where id = '${held}'`)).rejects.toThrow(/legal hold/);

    const parent = await newLead();
    await db.query(`insert into public.documents (lead_id, kind, storage_path, file_name, content_type, legal_hold, legal_hold_reason, legal_hold_set_at)
      values ('${parent}', 'T12', '${parent}/T12/a.pdf', 'a.pdf', 'application/pdf', true, 'Subpoena', now())`);
    await expect(db.query(`delete from public.leads where id = '${parent}'`)).rejects.toThrow(/legal hold/);

    await db.query(`update public.documents set legal_hold = false where lead_id = '${parent}'`);
    await db.query(`delete from public.leads where id = '${parent}'`);
    expect((await db.query(`select 1 from public.documents where lead_id = '${parent}'`)).rows).toHaveLength(0);
  });

  it("requires a reason and timestamp to place a hold", async () => {
    const id = await newLead();
    await expect(db.query(`update public.leads set legal_hold = true where id = '${id}'`)).rejects.toThrow(/legal_hold_reason_present/);
  });

  it("lets a legal hold be set on an otherwise append-only consent record", async () => {
    const { id } = await one<{ id: string }>(
      `insert into public.consent_events (form, text_version, text_sha256, email) values ('qualifier', 'v1', '${"a".repeat(64)}', 'pat@example.com') returning id`,
    );
    await db.query(`update public.consent_events set legal_hold = true, legal_hold_reason = 'TCPA claim', legal_hold_set_at = now() where id = '${id}'`);
    await expect(db.query(`delete from public.consent_events where id = '${id}'`)).rejects.toThrow(/legal hold/);
    await expect(db.query(`update public.consent_events set email = 'x@y.z' where id = '${id}'`)).rejects.toThrow(/append-only/);
  });

  it("enforces privacy request constraints", async () => {
    await request();
    await expect(request({ subject_email: "'Pat@Example.com'" })).rejects.toThrow();
    await expect(request({ status: "'verified'" })).rejects.toThrow(/verified_status/);
    await expect(request({ status: "'completed'" })).rejects.toThrow(/closed_has_time/);
    await expect(request({ status: "'denied'", completed_at: "now()" })).rejects.toThrow(/denied_has_reason/);
    await expect(request({ relationship: "'authorized_agent'" })).rejects.toThrow(/agent_named/);
    await expect(request({ queue: "'sales'" })).rejects.toThrow();
    await expect(request({ request_type: "'erase'" })).rejects.toThrow();
    await expect(request({ acknowledge_by: "'2027-02-01'" })).rejects.toThrow(/due_order/);
    await expect(request({ verified_at: "now()" })).rejects.toThrow(/verified_has_method/);
    const key = `'${"d".repeat(24)}'`;
    await request({ dedupe_key: key });
    await expect(request({ dedupe_key: key })).rejects.toThrow(/duplicate key/);
    const ok = await request({ status: "'verified'", verified_at: "now()", verification_method: "'staff_match'" });
    expect(ok.rows).toHaveLength(1);
  });

  it("nulls the lead link on a request when the lead is deleted", async () => {
    const lead = await newLead();
    const { rows } = await request({ lead_id: `'${lead}'` });
    await db.query(`delete from public.leads where id = '${lead}'`);
    const after = await one<{ lead_id: string | null }>(`select lead_id from public.privacy_requests where id = '${(rows[0] as { id: string }).id}'`);
    expect(after.lead_id).toBeNull();
  });

  it("stores preferences keyed by lower-case email", async () => {
    await db.query(`insert into public.privacy_preferences (subject_email, human_review_only, ai_processing_opt_out) values ('pat@example.com', true, true)`);
    await expect(db.query(`insert into public.privacy_preferences (subject_email) values ('PAT@example.com')`)).rejects.toThrow();
  });
});
