import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseOutreachStore } from "./supabase-store";
import { SupabaseVoiceConsentStore } from "./voice/consent";
import { SupabaseVoiceStore } from "./voice/store";

/** Records PostgREST builder calls and answers each terminal call with the next queued result. */
function recorder(results: { data: unknown; error: unknown }[]) {
  const calls: [string, ...unknown[]][] = [];
  const next = () => results.shift() ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "update", "insert", "eq", "in", "is", "gte", "order", "limit"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.single = async () => next();
  builder.maybeSingle = async () => next();
  builder.then = (resolve: (v: unknown) => void) => resolve(next());
  const db = { from: (t: string) => (calls.push(["from", t]), builder) } as unknown as SupabaseClient;
  return { db, calls };
}

const msgRow = {
  id: "m1",
  created_at: "2026-11-04T17:00:00Z",
  updated_at: "2026-11-04T17:00:00Z",
  kind: "document_reminder",
  channel: "email",
  template_id: "document_reminder_email",
  template_version: 1,
  audience: "borrower",
  recipient: "pat@example.com",
  status: "queued",
  reason_code: null,
  idempotency_key: "k1",
  lead_id: null,
  deal_id: "d1",
  subject_key: "docs:d1",
  sequence: 2,
  approval_id: null,
  consent_event_id: null,
  provider: null,
  provider_message_id: null,
  attempts: 0,
  error: null,
  metadata: { renderData: { a: 1 } },
  sent_at: null,
};

describe("supabase outreach store", () => {
  it("claims a message and maps the row", async () => {
    const { db, calls } = recorder([{ data: msgRow, error: null }]);
    const out = await new SupabaseOutreachStore(db).claim({ kind: "document_reminder", channel: "email", templateId: "document_reminder_email", templateVersion: 1, audience: "borrower", recipient: "pat@example.com", idempotencyKey: "k1", dealId: "d1", subjectKey: "docs:d1", sequence: 2, metadata: { renderData: { a: 1 } } });
    expect(out.fresh).toBe(true);
    expect(out.row).toMatchObject({ id: "m1", dealId: "d1", subjectKey: "docs:d1", sequence: 2, status: "queued", metadata: { renderData: { a: 1 } } });
    const insert = calls.find((c) => c[0] === "insert")?.[1] as Record<string, unknown>;
    expect(insert).toMatchObject({ idempotency_key: "k1", deal_id: "d1", sequence: 2 });
  });

  it("returns the existing row on a duplicate idempotency key", async () => {
    const { db } = recorder([
      { data: null, error: { code: "23505", message: "duplicate" } },
      { data: { ...msgRow, status: "sent" }, error: null },
    ]);
    const out = await new SupabaseOutreachStore(db).claim({ kind: "document_reminder", channel: "email", templateId: "t", templateVersion: 1, audience: "borrower", recipient: "a@b.co", idempotencyKey: "k1" });
    expect(out).toMatchObject({ fresh: false, row: { status: "sent" } });
  });

  it("throws on other insert errors", async () => {
    const { db } = recorder([{ data: null, error: { code: "42501", message: "denied" } }]);
    await expect(new SupabaseOutreachStore(db).claim({ kind: "vendor_nudge", channel: "email", templateId: "t", templateVersion: 1, audience: "vendor", recipient: "a@b.co", idempotencyKey: "k2" })).rejects.toThrow(/denied/);
  });

  it("reopens only rows in the expected statuses", async () => {
    const { db, calls } = recorder([{ data: [], error: null }]);
    expect(await new SupabaseOutreachStore(db).reopen("m1", ["pending_approval"])).toBeNull();
    expect(calls).toContainEqual(["in", "status", ["pending_approval"]]);
  });

  it("lists a series by deal, kind and subject, treating null as IS NULL", async () => {
    const { db, calls } = recorder([{ data: [msgRow], error: null }]);
    const rows = await new SupabaseOutreachStore(db).listSeries({ kind: "document_reminder", dealId: null, subjectKey: "docs:d1" });
    expect(rows).toHaveLength(1);
    expect(calls).toContainEqual(["is", "deal_id", null]);
    expect(calls).toContainEqual(["eq", "subject_key", "docs:d1"]);
    expect(calls).toContainEqual(["eq", "kind", "document_reminder"]);
  });

  it("maps an update patch to columns and truncates long errors", async () => {
    const { db, calls } = recorder([{ data: { ...msgRow, status: "failed" }, error: null }]);
    await new SupabaseOutreachStore(db).update("m1", { status: "failed", reasonCode: "send_failed", error: "x".repeat(2000), providerMessageId: "p1" });
    const set = calls.find((c) => c[0] === "update")?.[1] as Record<string, unknown>;
    expect(set).toMatchObject({ status: "failed", reason_code: "send_failed", provider_message_id: "p1" });
    expect((set.error as string).length).toBe(1000);
  });

  it("finds retryable rows for a kind since a time", async () => {
    const { db, calls } = recorder([{ data: [msgRow], error: null }]);
    await new SupabaseOutreachStore(db).listRetryable("speed_to_lead", new Date("2026-11-04T00:00:00Z"));
    expect(calls).toContainEqual(["in", "status", ["pending_approval", "deferred_quiet_hours"]]);
  });
});

const callRow = {
  id: "c1",
  created_at: "2026-11-04T17:00:00Z",
  updated_at: "2026-11-04T17:00:00Z",
  idempotency_key: "call:1",
  mode: "ai_voice",
  to_number: "+14155550100",
  from_number: "+13105550188",
  status: "dialing",
  block_reason: null,
  script_id: "document_followup",
  script_version: 1,
  body_text: "Hi",
  record_requested: true,
  ai_disclosed_at: null,
  recording_disclosed_at: null,
  recording_started_at: null,
  recording_stopped_at: null,
  recording_id: null,
  lead_id: null,
  deal_id: null,
  approval_id: "appr_1",
  consent_event_ids: ["e1"],
  ai_voice_consent_id: "ai1",
  call_control_id: "cc1",
  call_session_id: null,
  handoff_number: null,
  hangup_cause: null,
  error: null,
  ended_at: null,
};

describe("supabase voice store", () => {
  it("maps a call row", async () => {
    const { db } = recorder([{ data: callRow, error: null }]);
    expect(await new SupabaseVoiceStore(db).get("c1")).toMatchObject({ id: "c1", mode: "ai_voice", status: "dialing", recordRequested: true, consentEventIds: ["e1"], bodyText: "Hi", callControlId: "cc1" });
  });

  it("transitions only from the expected statuses and maps camelCase patches to columns", async () => {
    const { db, calls } = recorder([{ data: [], error: null }]);
    const out = await new SupabaseVoiceStore(db).transition("c1", ["dialing"], { status: "announcing", recordingDisclosedAt: "2026-11-04T17:01:00Z" });
    expect(out).toBeNull();
    expect(calls).toContainEqual(["update", { status: "announcing", recording_disclosed_at: "2026-11-04T17:01:00Z" }]);
    expect(calls).toContainEqual(["in", "status", ["dialing"]]);
  });

  it("claims a call and returns the existing row on a duplicate key", async () => {
    const { db } = recorder([
      { data: null, error: { code: "23505", message: "dup" } },
      { data: callRow, error: null },
    ]);
    const out = await new SupabaseVoiceStore(db).claim({ idempotencyKey: "call:1", mode: "ai_voice", toNumber: "+14155550100", scriptId: "document_followup", scriptVersion: 1, recordRequested: true });
    expect(out.fresh).toBe(false);
  });
});

describe("supabase AI-voice consent store", () => {
  it("records and reads consent events", async () => {
    const stored = { id: "v1", event_type: "granted", kind: "ai_voice", phone: "+14155550100", lead_id: null, text_version: "ai-voice-2026-11-04", text_sha256: "a".repeat(64), page: "/express", occurred_at: "2026-11-04T17:00:00Z" };
    const { db, calls } = recorder([
      { data: stored, error: null },
      { data: [stored], error: null },
    ]);
    const store = new SupabaseVoiceConsentStore(db);
    const e = await store.record({ eventType: "granted", kind: "ai_voice", phone: "+14155550100", leadId: null, textVersion: "ai-voice-2026-11-04", textSha256: "a".repeat(64), page: "/express", occurredAt: "2026-11-04T17:00:00Z" });
    expect(e).toMatchObject({ id: "v1", eventType: "granted" });
    expect(await store.history("+14155550100")).toHaveLength(1);
    expect(calls).toContainEqual(["eq", "phone", "+14155550100"]);
  });
});
