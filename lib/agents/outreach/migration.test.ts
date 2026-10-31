// Applies the full migration set (including WS-R's outreach tables) to PGlite
// and checks RLS, role access and the constraints the chasers rely on.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "@/scripts/test-migrations";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const message = (key: string, extra = "") =>
  db.query(
    `insert into public.outreach_messages (kind, channel, template_id, template_version, audience, recipient, idempotency_key${extra ? `, ${extra.split("=")[0]}` : ""})
     values ('document_reminder', 'email', 'document_reminder_email', 1, 'borrower', 'pat@example.com', '${key}'${extra ? `, ${extra.split("=")[1]}` : ""}) returning id`,
  );

const call = (key: string, cols = "", vals = "") =>
  db.query(
    `insert into public.outreach_voice_calls (idempotency_key, mode, to_number, script_id, script_version${cols ? `, ${cols}` : ""})
     values ('${key}', 'human_assisted', '+14155550100', 'human_bridge', 1${vals ? `, ${vals}` : ""}) returning id`,
  );

describe("WS-R migration", () => {
  it("sits in the Phase 3 slot 05 position", () => {
    expect(listMigrations().some((m) => m.name === "20261104000500_r_outreach.sql")).toBe(true);
  });

  it("enables RLS on all three tables", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('outreach_messages', 'outreach_voice_calls', 'outreach_voice_consents') order by relname",
    );
    expect(rows).toEqual([
      { relname: "outreach_messages", relrowsecurity: true },
      { relname: "outreach_voice_calls", relrowsecurity: true },
      { relname: "outreach_voice_consents", relrowsecurity: true },
    ]);
  });

  it("denies anon and authenticated access", async () => {
    await db.exec("grant select, insert, update, delete on public.outreach_messages, public.outreach_voice_calls, public.outreach_voice_consents to anon, authenticated");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      expect((await db.query("select * from public.outreach_messages")).rows).toEqual([]);
      await expect(db.query("insert into public.outreach_voice_consents (event_type, phone, text_version, text_sha256) values ('granted', '+14155550100', 'v', '" + "a".repeat(64) + "')")).rejects.toThrow(/row-level security|permission denied/);
      await db.exec("reset role");
    }
  });

  it("enforces a unique idempotency key on messages and calls", async () => {
    await message("dup-key");
    await expect(message("dup-key")).rejects.toThrow(/duplicate key|unique/);
    await call("call-dup");
    await expect(call("call-dup")).rejects.toThrow(/duplicate key|unique/);
  });

  it("rejects unknown kinds, channels, statuses, audiences and reason codes", async () => {
    await expect(db.query("insert into public.outreach_messages (kind, channel, template_id, template_version, audience, recipient, idempotency_key) values ('spam', 'email', 't', 1, 'borrower', 'a@b.c', 'bad1')")).rejects.toThrow(/check/);
    await expect(db.query("insert into public.outreach_messages (kind, channel, template_id, template_version, audience, recipient, idempotency_key) values ('vendor_nudge', 'fax', 't', 1, 'vendor', 'a@b.c', 'bad2')")).rejects.toThrow(/check/);
    await expect(message("bad3", "status='sent_twice'")).rejects.toThrow(/check/);
    await expect(db.query("insert into public.outreach_messages (kind, channel, template_id, template_version, audience, recipient, idempotency_key) values ('vendor_nudge', 'email', 't', 1, 'staff', 'a@b.c', 'bad4')")).rejects.toThrow(/check/);
    await expect(message("bad5", "reason_code='because'")).rejects.toThrow(/check/);
  });

  it("keeps updated_at current", async () => {
    const { rows } = await message("touch-key");
    const id = (rows[0] as { id: string }).id;
    await db.exec(`update public.outreach_messages set created_at = now() - interval '1 day', updated_at = now() - interval '1 day' where id = '${id}'`);
    await db.exec(`update public.outreach_messages set status = 'sent' where id = '${id}'`);
    const after = await db.query<{ fresh: boolean }>(`select updated_at > now() - interval '1 minute' as fresh from public.outreach_messages where id = '${id}'`);
    expect(after.rows[0]?.fresh).toBe(true);
  });

  it("a recording cannot start before its disclosure, or without one", async () => {
    await expect(call("rec-1", "recording_started_at", "now()")).rejects.toThrow(/record_after_disclosure|check/);
    await expect(call("rec-2", "recording_started_at, recording_disclosed_at", "now() - interval '1 minute', now()")).rejects.toThrow(/record_after_disclosure|check/);
    await call("rec-3", "recording_started_at, recording_disclosed_at", "now(), now() - interval '1 minute'");
  });

  it("an AI-voice call past the planning stage must carry its AI-voice consent", async () => {
    await expect(
      db.query("insert into public.outreach_voice_calls (idempotency_key, mode, to_number, script_id, script_version, status) values ('ai-1', 'ai_voice', '+14155550100', 'document_followup', 1, 'dialing')"),
    ).rejects.toThrow(/ai_needs_consent|check/);
    await db.exec("insert into public.outreach_voice_calls (idempotency_key, mode, to_number, script_id, script_version, status) values ('ai-2', 'ai_voice', '+14155550100', 'document_followup', 1, 'blocked')");
    const consent = await db.query<{ id: string }>(`insert into public.outreach_voice_consents (event_type, phone, text_version, text_sha256) values ('granted', '+14155550100', 'ai-voice-2026-11-04', '${"b".repeat(64)}') returning id`);
    await db.exec(`insert into public.outreach_voice_calls (idempotency_key, mode, to_number, script_id, script_version, status, ai_voice_consent_id) values ('ai-3', 'ai_voice', '+14155550100', 'document_followup', 1, 'dialing', '${consent.rows[0]?.id}')`);
  });

  it("AI-voice consent rows are append-only", async () => {
    const { rows } = await db.query<{ id: string }>(`insert into public.outreach_voice_consents (event_type, phone, text_version, text_sha256) values ('granted', '+14155550111', 'v1', '${"c".repeat(64)}') returning id`);
    const id = rows[0]?.id;
    await expect(db.exec(`update public.outreach_voice_consents set event_type = 'revoked' where id = '${id}'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`update public.outreach_voice_consents set phone = '+14155550999' where id = '${id}'`)).rejects.toThrow(/append-only/);
    // A revocation is a new row.
    await db.exec(`insert into public.outreach_voice_consents (event_type, phone, text_version, text_sha256) values ('revoked', '+14155550111', 'v1', '${"c".repeat(64)}')`);
  });

  it("rejects a malformed consent hash and a non-AI consent kind", async () => {
    await expect(db.exec("insert into public.outreach_voice_consents (event_type, phone, text_version, text_sha256) values ('granted', '+14155550100', 'v', 'abc')")).rejects.toThrow(/check/);
    await expect(db.exec(`insert into public.outreach_voice_consents (event_type, kind, phone, text_version, text_sha256) values ('granted', 'sms', '+14155550100', 'v', '${"a".repeat(64)}')`)).rejects.toThrow(/check/);
  });

  it("has no funds or draw columns", async () => {
    const { rows } = await db.query("select * from public.custody_column_violations()");
    expect(rows).toEqual([]);
  });
});
