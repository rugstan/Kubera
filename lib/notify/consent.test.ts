import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { consentAllows, consentState, SupabaseConsentReader, smsConsentEvent, type ConsentRecord } from "./consent";
import { SupabaseNotifyStore } from "./store";

const rec = (over: Partial<ConsentRecord> & { at: string }): ConsentRecord => ({
  id: over.id ?? over.at,
  eventType: over.eventType ?? "granted",
  form: over.form ?? "qualifier",
  channels: over.channels ?? ["phone", "sms", "email", "autodialer"],
  occurredAt: over.at,
  leadId: over.leadId ?? null,
  partnerId: over.partnerId ?? null,
});

describe("consentState", () => {
  it("is none without records", () => expect(consentState([], "sms")).toEqual({ state: "none" }));

  it("takes the latest event that covers the channel", () => {
    const records = [rec({ at: "2026-11-01T10:00:00Z" }), rec({ at: "2026-11-02T10:00:00Z", eventType: "revoked", channels: ["sms", "autodialer"], id: "stop" })];
    expect(consentState(records, "sms")).toMatchObject({ state: "revoked", eventId: "stop" });
    expect(consentState(records, "email").state).toBe("granted");
  });

  it("is order-independent and lets a revocation win a timestamp tie", () => {
    const grant = rec({ at: "2026-11-02T10:00:00Z", id: "g" });
    const revoke = rec({ at: "2026-11-02T10:00:00Z", eventType: "revoked", id: "r" });
    expect(consentState([grant, revoke], "sms").state).toBe("revoked");
    expect(consentState([revoke, grant], "sms").state).toBe("revoked");
  });

  it("ignores events for other channels and newsletter forms for email", () => {
    expect(consentState([rec({ at: "2026-11-01T10:00:00Z", channels: ["email"] })], "sms").state).toBe("none");
    expect(consentState([rec({ at: "2026-11-01T10:00:00Z", form: "newsletter", channels: ["email"] })], "email").state).toBe("none");
  });

  it("keeps the lead link from an earlier row when the STOP row has none", () => {
    const records = [rec({ at: "2026-11-01T10:00:00Z", leadId: "lead-1" }), rec({ at: "2026-11-02T10:00:00Z", eventType: "revoked" })];
    expect(consentState(records, "sms")).toMatchObject({ state: "revoked", leadId: "lead-1" });
  });

  it("maps states to policies", () => {
    expect(consentAllows("required", { state: "granted" })).toBe(true);
    expect(consentAllows("required", { state: "none" })).toBe(false);
    expect(consentAllows("required", { state: "revoked" })).toBe(false);
    expect(consentAllows("not_revoked", { state: "none" })).toBe(true);
    expect(consentAllows("not_revoked", { state: "revoked" })).toBe(false);
    expect(consentAllows("none", { state: "revoked" })).toBe(true);
  });
});

describe("ledger rows for STOP and START", () => {
  const change = { phone: "+14155550100", leadId: "lead-1", now: new Date("2026-11-03T20:00:00Z"), source: "msg_1" };

  it("builds a revocation that covers texts and automated contact but not email", () => {
    const e = smsConsentEvent("revoked", change);
    expect(e).toMatchObject({ eventType: "revoked", form: "sms", phone: "+14155550100", email: null, channels: ["sms", "autodialer"], leadId: "lead-1", page: "sms:msg_1" });
    expect(e.textSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses different pinned wording for START", () => {
    const stop = smsConsentEvent("revoked", change);
    const start = smsConsentEvent("granted", change);
    expect(start.textVersion).not.toBe(stop.textVersion);
    expect(start.textSha256).not.toBe(stop.textSha256);
  });
});

// A minimal stand-in for the supabase-js query builder.
function builder(result: { data?: unknown; error?: { message: string; code?: string } | null }, log: string[] = []) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "eq", "in", "order", "limit", "not", "gte"]) {
    b[m] = (...args: unknown[]) => {
      log.push(`${m}(${args.map((a) => (typeof a === "object" ? "{}" : String(a))).join(",")})`);
      return b;
    };
  }
  b.single = async () => ({ data: result.data ?? null, error: result.error ?? null });
  b.maybeSingle = async () => ({ data: result.data ?? null, error: result.error ?? null });
  b.then = (resolve: (v: unknown) => void) => resolve({ data: result.data ?? null, error: result.error ?? null });
  return b;
}

describe("Supabase adapters", () => {
  it("reads consent history by phone for texts and by lower-cased email for email", async () => {
    const log: string[] = [];
    const db = { from: () => builder({ data: [{ id: "c1", event_type: "granted", form: "qualifier", channels: ["sms"], occurred_at: "2026-11-01T00:00:00Z", lead_id: "l1", partner_id: null }] }, log) } as unknown as SupabaseClient;
    const reader = new SupabaseConsentReader(db);
    const rows = await reader.history("sms", { phone: "+14155550100" });
    expect(rows).toEqual([{ id: "c1", eventType: "granted", form: "qualifier", channels: ["sms"], occurredAt: "2026-11-01T00:00:00Z", leadId: "l1", partnerId: null }]);
    expect(log).toContain("eq(phone,+14155550100)");
    await reader.history("email", { email: "Pat@Example.com" });
    expect(log).toContain("eq(email,pat@example.com)");
    expect(await reader.history("sms", {})).toEqual([]);
  });

  it("surfaces a ledger read error so the send fails closed", async () => {
    const db = { from: () => builder({ error: { message: "boom" } }) } as unknown as SupabaseClient;
    await expect(new SupabaseConsentReader(db).history("sms", { phone: "+14155550100" })).rejects.toThrow(/consent lookup failed/);
  });

  it("returns the existing row when the idempotency key is already taken", async () => {
    const existing = { id: "n1", created_at: "2026-11-03T00:00:00Z", channel: "sms", template_id: "t", template_version: 1, audience: "staff", recipient: "+1", status: "sent", idempotency_key: "k", attempts: 1, metadata: {} };
    let call = 0;
    const db = {
      from: () => {
        call += 1;
        return call === 1 ? builder({ error: { message: "duplicate key", code: "23505" } }) : builder({ data: existing });
      },
    } as unknown as SupabaseClient;
    const out = await new SupabaseNotifyStore(db).claim({ channel: "sms", templateId: "t", templateVersion: 1, audience: "staff", recipient: "+1", idempotencyKey: "k" });
    expect(out.fresh).toBe(false);
    expect(out.row).toMatchObject({ id: "n1", status: "sent", idempotencyKey: "k" });
  });
});
