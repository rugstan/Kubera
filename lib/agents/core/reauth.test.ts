import { describe, expect, it } from "vitest";
import type { ApprovalRecord } from "@/lib/approvals/types";
import { freshFactorFromAmr, MemoryReauthStore, REAUTH_MAX_AGE_MS, ReauthService, reauthSatisfied, requiresReauthentication, type ReauthProof } from "./reauth";

const T0 = Date.UTC(2026, 10, 4, 17, 0, 0);
const BROKER = "11111111-1111-4111-8111-111111111111";

function approval(o: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    createdAt: new Date(T0 - 3_600_000).toISOString(),
    kind: "lender_submission",
    idempotencyKey: "agent:lenders.submit_package:k",
    summary: "Submit package",
    templateId: null,
    payload: { tool: "lenders.submit_package", input: {} },
    payloadSha256: "b".repeat(64),
    requestedBy: "agent:lenders.matching@1.0.0",
    requestedByUser: null,
    dealId: null,
    leadId: null,
    status: "approved",
    expiresAt: new Date(T0 + 3_600_000).toISOString(),
    decidedAt: new Date(T0).toISOString(),
    decidedBy: BROKER,
    decidedByLabel: "Dana",
    decidedByDre: "01234567",
    decisionReason: null,
    autoApproved: false,
    executedAt: null,
    executionRef: null,
    ...o,
  };
}

const proof = (o: Partial<ReauthProof> = {}): ReauthProof => ({
  id: "p1",
  createdAt: new Date(T0).toISOString(),
  approvalId: approval().id,
  userId: BROKER,
  userDre: "01234567",
  method: "totp",
  verifiedAt: new Date(T0 - 60_000).toISOString(),
  payloadSha256: "b".repeat(64),
  sessionRef: null,
  ipHash: null,
  userAgent: null,
  ...o,
});

describe("requiresReauthentication", () => {
  it("covers MLDS, Form 159, lender submissions and fee quotes", () => {
    expect(requiresReauthentication(approval())).toBe(true);
    expect(requiresReauthentication(approval({ kind: "fee_quote" }))).toBe(true);
    expect(requiresReauthentication(approval({ kind: "esign_send", payload: { documentType: "MLDS_RE882" } }))).toBe(true);
    expect(requiresReauthentication(approval({ kind: "esign_send", payload: { input: { form: "SBA Form 159" } } }))).toBe(true);
    expect(requiresReauthentication(approval({ kind: "esign_send", templateId: "re882-traditional" }))).toBe(true);
    expect(requiresReauthentication(approval({ kind: "email", payload: { subject: "MLDS attached" } }))).toBe(false);
    expect(requiresReauthentication(approval({ kind: "sms", payload: {} }))).toBe(false);
  });
});

describe("reauthSatisfied", () => {
  it("accepts a fresh factor by the approver for this payload", () => {
    expect(reauthSatisfied(approval(), [proof()])).toMatchObject({ ok: true });
    // Confirming after the decision also counts.
    expect(reauthSatisfied(approval(), [proof({ verifiedAt: new Date(T0 + 120_000).toISOString() })]).ok).toBe(true);
  });

  it.each([
    [approval({ autoApproved: true, decidedBy: null }), [proof()], "auto_approved"],
    [approval({ status: "pending", decidedAt: null }), [proof()], "not_approved"],
    [approval(), [], "no_proof"],
    [approval(), [proof({ userId: "22222222-2222-4222-8222-222222222222" })], "wrong_user"],
    [approval(), [proof({ payloadSha256: "c".repeat(64) })], "payload_changed"],
    [approval(), [proof({ verifiedAt: new Date(T0 - REAUTH_MAX_AGE_MS - 1).toISOString() })], "stale"],
  ] as const)("refuses %#", (record, proofs, reason) => {
    expect(reauthSatisfied(record, proofs)).toEqual({ ok: false, reason });
  });
});

describe("ReauthService", () => {
  const service = (now = T0) => {
    const store = new MemoryReauthStore();
    return { store, s: new ReauthService(store, () => new Date(now)) };
  };
  const user = { userId: BROKER, dreLicense: "01234567" };

  it("records a proof bound to the approval and payload", async () => {
    const { store, s } = service();
    const p = await s.record({ approval: approval({ status: "pending", decidedAt: null, decidedBy: null }), user, factor: { method: "webauthn", verifiedAt: new Date(T0 - 1000) }, userAgent: "x".repeat(600) });
    expect(p).toMatchObject({ approvalId: approval().id, payloadSha256: "b".repeat(64), method: "webauthn" });
    expect(p.userAgent).toHaveLength(512);
    expect(store.rows).toHaveLength(1);
  });

  it("refuses stale, future, unlicensed and unnecessary step-ups", async () => {
    const { s } = service();
    await expect(s.record({ approval: approval(), user, factor: { method: "totp", verifiedAt: new Date(T0 - REAUTH_MAX_AGE_MS - 1000) } })).rejects.toThrow(/again/);
    await expect(s.record({ approval: approval(), user, factor: { method: "totp", verifiedAt: new Date(T0 + 5 * 60_000) } })).rejects.toThrow(/future/);
    await expect(s.record({ approval: approval(), user: { userId: BROKER, dreLicense: null }, factor: { method: "totp", verifiedAt: new Date(T0) } })).rejects.toThrow(/licensed/);
    await expect(s.record({ approval: approval({ kind: "sms", payload: {} }), user, factor: { method: "totp", verifiedAt: new Date(T0) } })).rejects.toThrow(/does not need/);
    await expect(s.record({ approval: approval({ status: "expired" }), user, factor: { method: "totp", verifiedAt: new Date(T0) } })).rejects.toThrow(/expired/);
  });
});

describe("freshFactorFromAmr", () => {
  it("returns the latest TOTP or passkey entry and ignores weaker methods", () => {
    const f = freshFactorFromAmr({ session_id: "s1", amr: [{ method: "otp", timestamp: 1_800_000_100 }, { method: "totp", timestamp: 1_800_000_000 }, { method: "totp", timestamp: 1_800_000_050 }] });
    expect(f).toEqual({ method: "totp", verifiedAt: new Date(1_800_000_050_000), sessionRef: "s1" });
    expect(freshFactorFromAmr({ amr: [{ method: "password", timestamp: 1 }, { method: "magiclink", timestamp: 2 }] })).toBeNull();
    expect(freshFactorFromAmr({ amr: "totp" })).toBeNull();
    expect(freshFactorFromAmr({ amr: [{ method: "passkey", timestamp: 5 }] })?.method).toBe("webauthn");
  });
});
