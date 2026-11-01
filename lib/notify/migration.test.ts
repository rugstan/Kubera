// Applies the full migration set (including WS-J's notifications and
// sms_messages tables) to PGlite and checks RLS, role access and constraints.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "@/scripts/test-migrations";
import { NOTIFICATION_STATUSES } from "./types";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const insertNotification = (key: string, extra = "") =>
  db.query(
    `insert into public.notifications (channel, template_id, template_version, audience, recipient, idempotency_key${extra ? `, ${extra.split("=")[0]}` : ""})
     values ('sms', 'staff_tier1_sms', 1, 'staff', '+13105550111', '${key}'${extra ? `, ${extra.split("=")[1]}` : ""}) returning id`,
  );

describe("WS-J migration", () => {
  it("is in the Phase 2 slot 04 position", () => {
    expect(listMigrations().some((m) => m.name === "20261103000400_j_notifications.sql")).toBe(true);
  });

  it("enables RLS on both tables", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('notifications', 'sms_messages') order by relname",
    );
    expect(rows).toEqual([
      { relname: "notifications", relrowsecurity: true },
      { relname: "sms_messages", relrowsecurity: true },
    ]);
  });

  it("denies anon and authenticated access", async () => {
    await db.exec("grant select, insert, update, delete on public.notifications, public.sms_messages to anon, authenticated");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      // RLS with no policies: reads return nothing and writes are refused.
      expect((await db.query("select * from public.notifications")).rows).toEqual([]);
      await expect(db.query("insert into public.sms_messages (direction, from_number, to_number, body) values ('inbound', '+1', '+2', 'x')")).rejects.toThrow(/row-level security|permission denied/);
      await db.exec("reset role");
    }
  });

  it("enforces a unique idempotency key", async () => {
    await insertNotification("dup-key");
    await expect(insertNotification("dup-key")).rejects.toThrow(/duplicate key|unique/);
  });

  it("rejects unknown channels, statuses and audiences", async () => {
    await expect(db.query("insert into public.notifications (channel, template_id, template_version, audience, recipient, idempotency_key) values ('fax', 't', 1, 'staff', 'x@y.z', 'bad1')")).rejects.toThrow(/check/);
    await expect(insertNotification("bad2", "status='sent_twice'")).rejects.toThrow(/check/);
    await expect(db.query("insert into public.notifications (channel, template_id, template_version, audience, recipient, idempotency_key) values ('email', 't', 1, 'robot', 'x@y.z', 'bad3')")).rejects.toThrow(/check/);
  });

  it("accepts every status the Notifier writes, including send_unknown", async () => {
    for (const status of NOTIFICATION_STATUSES) {
      await insertNotification(`status-${status}`, `status='${status}'`);
    }
  });

  it("accepts 'undelivered' on sms_messages (carrier delivery receipts) and still rejects unknown statuses", async () => {
    await db.exec("insert into public.sms_messages (direction, from_number, to_number, body, status, provider_message_id) values ('outbound', '+13105550199', '+14155550100', 'x', 'undelivered', 'msg-undelivered')");
    await expect(db.exec("insert into public.sms_messages (direction, from_number, to_number, body, status) values ('outbound', '+13105550199', '+14155550100', 'x', 'bounced')")).rejects.toThrow(/check/);
  });

  it("keeps updated_at current", async () => {
    const { rows } = await insertNotification("touch-key");
    const id = (rows[0] as { id: string }).id;
    await db.exec(`update public.notifications set created_at = now() - interval '1 day', updated_at = now() - interval '1 day' where id = '${id}'`);
    await db.exec(`update public.notifications set status = 'sent' where id = '${id}'`);
    const after = await db.query<{ fresh: boolean }>(`select updated_at > now() - interval '1 minute' as fresh from public.notifications where id = '${id}'`);
    expect(after.rows[0]?.fresh).toBe(true);
  });

  it("recognises a redelivered provider message id", async () => {
    await db.exec("insert into public.sms_messages (direction, from_number, to_number, body, provider_message_id) values ('inbound', '+14155550100', '+13105550199', 'STOP', 'msg-1')");
    await expect(db.exec("insert into public.sms_messages (direction, from_number, to_number, body, provider_message_id) values ('inbound', '+14155550100', '+13105550199', 'STOP', 'msg-1')")).rejects.toThrow(/duplicate key|unique/);
    // Rows without a provider id (not yet sent) never collide.
    await db.exec("insert into public.sms_messages (direction, from_number, to_number, body) values ('outbound', '+13105550199', '+14155550100', 'a')");
    await db.exec("insert into public.sms_messages (direction, from_number, to_number, body) values ('outbound', '+13105550199', '+14155550100', 'b')");
  });

  it("accepts a STOP revocation in the consent ledger with form 'sms'", async () => {
    await db.exec(
      `insert into public.consent_events (event_type, form, text_version, text_sha256, channels, phone)
       values ('revoked', 'sms', 'sms-stop-keyword-2026-11-03', '${"a".repeat(64)}', array['sms','autodialer'], '+14155550100')`,
    );
  });

  it("has no funds or draw columns", async () => {
    const { rows } = await db.query("select * from public.custody_column_violations()");
    expect(rows).toEqual([]);
  });
});
