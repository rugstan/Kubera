// Applies every migration to PGlite and checks the WS-AB tables: RLS,
// insert-only triggers, chain linkage, autonomy history and re-auth proofs.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, custodyViolations, listMigrations } from "../../../scripts/test-migrations.ts";
import { MemoryAgentEventStore, toRow, type AgentEvent } from "./events";

const TABLES = ["agent_events", "agent_task_autonomy", "approval_reauthentications"];
const BROKER = "11111111-1111-4111-8111-111111111111";
let db: PGlite;
let approvalId: string;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    revoke all on public.agent_events, public.agent_task_autonomy, public.approval_reauthentications from anon, authenticated;
  `);
  await db.query(`insert into auth.users (id, email) values ($1, 'dana@kuberacommercial.com')`, [BROKER]);
  const a = await db.query<{ id: string }>(
    `insert into public.approvals (kind, idempotency_key, summary, payload, payload_sha256, requested_by, expires_at)
     values ('lender_submission', 'agent:lenders.submit_package:k1', 'Submit', '{}'::jsonb, repeat('b', 64), 'agent:lenders.matching@1.0.0', now() + interval '1 day')
     returning id`,
  );
  approvalId = a.rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const COLS = Object.keys(toRow({} as AgentEvent));

async function insertEvent(e: AgentEvent) {
  const row = toRow(e) as Record<string, unknown>;
  const values = COLS.map((c) => row[c]);
  const params = COLS.map((_, i) => `$${i + 1}`).join(", ");
  return db.query(`insert into public.agent_events (${COLS.join(", ")}) values (${params})`, values);
}

describe("WS-AB migration", () => {
  it("enables RLS and denies the API roles", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname = any($1) and relkind = 'r' order by relname`,
      [TABLES],
    );
    expect(rows.map((r) => r.relname)).toEqual([...TABLES].sort());
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const t of TABLES) await expect(db.query(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("accepts a chain built by the app and refuses forks, gaps and edits", async () => {
    const store = new MemoryAgentEventStore();
    for (let i = 0; i < 3; i++) {
      await store.append({ eventType: "tool.executed", agent: "outreach.chaser", approvalId, approverId: BROKER, approverDre: "01234567", reasonCodes: ["approval.pending", "tool.read_executed"], externalMessageIds: [`m${i}`], detail: { i } });
    }
    const rows = store.all();
    for (const r of rows) await insertEvent(r);

    // A second row claiming seq 2 (a fork) and a row skipping ahead are refused.
    await expect(insertEvent({ ...rows[1]!, id: crypto.randomUUID() })).rejects.toThrow();
    await expect(insertEvent({ ...rows[2]!, id: crypto.randomUUID(), seq: 5 })).rejects.toThrow(/head is seq 3/);
    await expect(insertEvent({ ...rows[0]!, id: crypto.randomUUID(), chain: "agent:fresh", seq: 2 })).rejects.toThrow(/starts at seq 1/);

    // Insert-only.
    await expect(db.query(`update public.agent_events set detail = '{}'::jsonb where seq = 2`)).rejects.toThrow(/insert-only/);
    await expect(db.query(`delete from public.agent_events where seq = 3`)).rejects.toThrow(/insert-only/);
    await expect(db.query(`truncate public.agent_events`)).rejects.toThrow(/insert-only/);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.agent_events where chain = 'agent:outreach.chaser'`);
    expect(count.rows[0]!.n).toBe(3);
  });

  it("allows unchained rows and validates codes and shapes", async () => {
    const store = new MemoryAgentEventStore();
    const e = await store.append({ eventType: "decision.qualifier", agent: "qualifier", chain: null, reasonCodes: ["qualifier.tier.tier_3_nurture"] });
    await insertEvent(e);
    await expect(insertEvent({ ...e, id: crypto.randomUUID(), reasonCodes: ["Bad Code"] })).rejects.toThrow(/reason_codes_shape/);
    await expect(insertEvent({ ...e, id: crypto.randomUUID(), autonomy: "yolo" as never })).rejects.toThrow(/check/);
    await expect(insertEvent({ ...e, id: crypto.randomUUID(), seq: 1 })).rejects.toThrow(/chain_shape/);
  });

  it("keeps an append-only autonomy history", async () => {
    await db.query(`insert into public.agent_task_autonomy (task, level, set_by, set_by_label, set_by_dre, reason) values ('crm.note', 'automate', $1, 'Dana', '01234567', 'reviewed')`, [BROKER]);
    await expect(db.query(`insert into public.agent_task_autonomy (task, level, set_by_label, set_by_dre, reason) values ('crm.note', 'turbo', 'Dana', '01234567', 'x')`)).rejects.toThrow(/check/);
    await expect(db.query(`insert into public.agent_task_autonomy (task, level, set_by_label, set_by_dre, reason) values ('crm.note', 'assist', 'Dana', '123', 'x')`)).rejects.toThrow(/check/);
    await expect(db.query(`update public.agent_task_autonomy set level = 'audit'`)).rejects.toThrow(/append-only/);
  });

  it("records re-authentication proofs that cannot be changed", async () => {
    await db.query(
      `insert into public.approval_reauthentications (approval_id, user_id, user_dre, method, verified_at, payload_sha256) values ($1, $2, '01234567', 'totp', now(), repeat('b', 64))`,
      [approvalId, BROKER],
    );
    await expect(
      db.query(`insert into public.approval_reauthentications (approval_id, user_id, user_dre, method, verified_at, payload_sha256) values ($1, $2, '01234567', 'sms', now(), repeat('b', 64))`, [approvalId, BROKER]),
    ).rejects.toThrow(/check/);
    await expect(
      db.query(`insert into public.approval_reauthentications (approval_id, user_id, user_dre, method, verified_at, payload_sha256) values ($1, $2, '01234567', 'totp', now() + interval '1 hour', repeat('b', 64))`, [approvalId, BROKER]),
    ).rejects.toThrow(/fresh/);
    await expect(db.query(`delete from public.approval_reauthentications`)).rejects.toThrow(/append-only/);
  });

  it("adds no funds or draw columns", async () => {
    expect(await custodyViolations(db)).toEqual([]);
  });
});
