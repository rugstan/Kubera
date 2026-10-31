// Applies every migration to PGlite and checks the WS-Q tables: RLS, keys and
// constraints, and the conditional link to deals.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";

const MINE = "20261103000600_q_workflows_mail.sql";
let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    revoke all on public.agent_runs, public.workflow_effects, public.mail_messages from anon, authenticated;
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

function mail(overrides: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    mailbox: "'deals'",
    provider: "'zoho'",
    provider_message_id: `'${Math.random().toString(36).slice(2)}'`,
    folder_id: "'inbox'",
    from_address: "'pat@example.com'",
    received_at: "now()",
    category: "'new_inquiry'",
    classifier_source: "'model'",
    confidence: "0.91",
    route_method: "'none'",
    queue: "'deal-desk'",
    status: "'processed'",
    ...overrides,
  };
  return db.query(`insert into public.mail_messages (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")}) returning id`);
}

describe("WS-Q migration", () => {
  it("enables RLS and denies the API roles", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('agent_runs', 'workflow_effects', 'mail_messages') order by relname",
    );
    expect(rows.map((r) => r.relname)).toEqual(["agent_runs", "mail_messages", "workflow_effects"]);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const t of ["agent_runs", "workflow_effects", "mail_messages"]) await expect(db.query(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("stores one row per mailbox message", async () => {
    await mail({ provider_message_id: "'m-1'" });
    await expect(mail({ provider_message_id: "'m-1'" })).rejects.toThrow(/duplicate key/);
    await expect(mail({ provider_message_id: "'m-1'", mailbox: "'docs'", queue: "'documents'" })).resolves.toBeTruthy();
  });

  it("enforces the review, category and sealed-body rules", async () => {
    await expect(mail({ status: "'needs_review'" })).rejects.toThrow(/mail_messages_review_has_reason/);
    await expect(mail({ status: "'needs_review'", review_reasons: "array['low_confidence']" })).resolves.toBeTruthy();
    await expect(mail({ category: "'wire_request'" })).rejects.toThrow(/check constraint/);
    await expect(mail({ mailbox: "'compliance'" })).rejects.toThrow(/check constraint/);
    await expect(mail({ body_encrypted: "'plaintext'" })).rejects.toThrow(/check constraint/);
    await expect(mail({ body_encrypted: "'pii1.1.x.y.z'", body_restricted: "false" })).rejects.toThrow(/mail_messages_restricted_body_sealed/);
    await expect(mail({ internet_message_id: "'UPPER@X'" })).rejects.toThrow(/check constraint/);
  });

  it("keys agent runs and effects for idempotency", async () => {
    await db.query("insert into public.agent_runs (workflow, idempotency_key) values ('inbound-mail', 'mail:deals:abc')");
    await expect(db.query("insert into public.agent_runs (workflow, idempotency_key) values ('inbound-mail', 'mail:deals:abc')")).rejects.toThrow(/duplicate key/);
    await expect(db.query("insert into public.agent_runs (workflow, status) values ('inbound-mail', 'succeeded')")).rejects.toThrow(/agent_runs_finished/);
    await db.query("insert into public.workflow_effects (idempotency_key, workflow, status, started_at) values ('outbound:email:1', 'outbound-action', 'in_progress', now())");
    await expect(db.query("insert into public.workflow_effects (idempotency_key, workflow, status, started_at) values ('outbound:email:1', 'outbound-action', 'in_progress', now())")).rejects.toThrow(/duplicate key/);
    await expect(db.query("update public.workflow_effects set status = 'completed' where idempotency_key = 'outbound:email:1'")).rejects.toThrow(/workflow_effects_completed_has_time/);
  });

  it("links deal_id to deals when the deals table exists", async () => {
    const other = await createStubbedDb();
    try {
      const files = listMigrations();
      const before = files.filter((f) => f.name < MINE);
      await applyMigrations(other, before);
      await other.exec("create table if not exists public.deals (id uuid primary key default gen_random_uuid())");
      await applyMigrations(other, files.filter((f) => f.name === MINE));
      const { rows } = await other.query<{ conname: string }>("select conname from pg_constraint where conname in ('agent_runs_deal_fk', 'mail_messages_deal_fk') order by conname");
      expect(rows.map((r) => r.conname)).toEqual(["agent_runs_deal_fk", "mail_messages_deal_fk"]);
    } finally {
      await other.close();
    }
  }, 60_000);
});
