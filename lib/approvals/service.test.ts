import { describe, expect, it, vi } from "vitest";
import { queueApprovalGate } from "./gate";
import { payloadHash, stableStringify } from "./hash";
import { ApprovalConflictError, ApprovalNotFoundError, ApprovalService, type ApprovalRequest } from "./service";
import { MemoryApprovalStore } from "./store";
import type { Approver } from "./types";

const T0 = new Date("2026-11-03T17:00:00Z");
const broker: Approver = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };

function setup() {
  let now = T0;
  const store = new MemoryApprovalStore();
  const service = new ApprovalService(store, () => now);
  return { store, service, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

const req = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  kind: "email",
  idempotencyKey: "email:document-request:deal-1:v1",
  summary: "Email the borrower a document request",
  payload: { to: "borrower@example.com", items: ["T12"] },
  requestedBy: "agent:document-chaser",
  ttlMinutes: 60,
  ...over,
});

describe("hashing", () => {
  it("hashes payloads independent of key order", () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});

describe("ApprovalService.request", () => {
  it("queues a pending approval with an expiry", async () => {
    const { service } = setup();
    const { record, created } = await service.request(req());
    expect(created).toBe(true);
    expect(record).toMatchObject({ status: "pending", kind: "email", autoApproved: false, expiresAt: "2026-11-03T18:00:00.000Z" });
  });

  it("is idempotent: the same key returns the same approval", async () => {
    const { service, store } = setup();
    const a = await service.request(req());
    const b = await service.request(req({ payload: { items: ["T12"], to: "borrower@example.com" } }));
    expect(b.created).toBe(false);
    expect(b.record.id).toBe(a.record.id);
    expect(store.all()).toHaveLength(1);
  });

  it("refuses to reuse a key for different content", async () => {
    const { service } = setup();
    await service.request(req());
    await expect(service.request(req({ payload: { to: "someone-else@example.com" } }))).rejects.toBeInstanceOf(ApprovalConflictError);
    await expect(service.request(req({ kind: "sms" }))).rejects.toBeInstanceOf(ApprovalConflictError);
  });

  it("validates input", async () => {
    const { service } = setup();
    await expect(service.request(req({ kind: "Email!" }))).rejects.toThrow();
    await expect(service.request(req({ idempotencyKey: "short" }))).rejects.toThrow();
    await expect(service.request(req({ ttlMinutes: 0 }))).rejects.toThrow();
    await expect(service.request(req({ summary: " " }))).rejects.toThrow();
  });

  it("auto-approves only an active pre-approved template of the same kind with the same body", async () => {
    const { service, store } = setup();
    const body = "a".repeat(64);
    store.addTemplate({ templateId: "tier1-lead-alert", kind: "sms", description: "Tier-1 lead alert to the broker", bodySha256: body, approvedBy: broker.userId, approvedByDre: "01234567", approvedAt: T0.toISOString(), revokedAt: null });
    store.addTemplate({ templateId: "old", kind: "sms", description: "Revoked", bodySha256: body, approvedBy: broker.userId, approvedByDre: "01234567", approvedAt: T0.toISOString(), revokedAt: T0.toISOString() });

    const auto = await service.request(req({ kind: "sms", idempotencyKey: "sms:tier1:lead-1", templateId: "tier1-lead-alert", templateBodySha256: body }));
    expect(auto.record).toMatchObject({ status: "approved", autoApproved: true, decidedByDre: "01234567", decidedByLabel: expect.stringContaining("tier1-lead-alert") });

    const changedBody = await service.request(req({ kind: "sms", idempotencyKey: "sms:tier1:lead-2", templateId: "tier1-lead-alert", templateBodySha256: "b".repeat(64) }));
    expect(changedBody.record.status).toBe("pending");
    const noHash = await service.request(req({ kind: "sms", idempotencyKey: "sms:tier1:lead-3", templateId: "tier1-lead-alert" }));
    expect(noHash.record.status).toBe("pending");
    const wrongKind = await service.request(req({ kind: "email", idempotencyKey: "email:tier1:lead-4", templateId: "tier1-lead-alert", templateBodySha256: body }));
    expect(wrongKind.record.status).toBe("pending");
    const revoked = await service.request(req({ kind: "sms", idempotencyKey: "sms:tier1:lead-5", templateId: "old", templateBodySha256: body }));
    expect(revoked.record.status).toBe("pending");
  });
});

describe("ApprovalService decisions", () => {
  it("approves a pending request and records the licensed approver", async () => {
    const { service } = setup();
    const { record } = await service.request(req());
    const r = await service.approve(record.id, broker);
    expect(r).toMatchObject({ ok: true, record: { status: "approved", decidedBy: broker.userId, decidedByDre: "01234567", decidedAt: T0.toISOString() } });
  });

  it("needs a DRE license number to approve", async () => {
    const { service } = setup();
    const { record } = await service.request(req());
    expect(await service.approve(record.id, { ...broker, dreLicense: null })).toMatchObject({ ok: false, reason: "invalid_approver" });
    expect(await service.approve(record.id, { ...broker, dreLicense: "123" })).toMatchObject({ ok: false, reason: "invalid_approver" });
    expect((await service.get(record.id))?.status).toBe("pending");
  });

  it("rejects with a reason; decisions are final", async () => {
    const { service } = setup();
    const { record } = await service.request(req());
    expect(await service.reject(record.id, broker, "  ")).toMatchObject({ ok: false, reason: "reason_required" });
    expect(await service.reject(record.id, broker, "Wrong borrower contact")).toMatchObject({ ok: true, record: { status: "rejected", decisionReason: "Wrong borrower contact" } });
    expect(await service.approve(record.id, broker)).toMatchObject({ ok: false, reason: "already_decided", record: { status: "rejected" } });
    expect(await service.cancel(record.id, broker)).toMatchObject({ ok: false, reason: "already_decided" });
  });

  it("expires on timeout and never approves afterwards", async () => {
    const { service, advance } = setup();
    const { record } = await service.request(req());
    advance(60 * 60_000);
    const r = await service.approve(record.id, broker);
    expect(r).toMatchObject({ ok: false, reason: "expired", record: { status: "expired", decidedByLabel: "system:expiry" } });
    expect((await service.get(record.id))?.status).toBe("expired");
    // The same key keeps answering "expired"; a send needs a fresh request.
    expect((await service.request(req())).record.status).toBe("expired");
  });

  it("sweeps due approvals in bulk and lists effective statuses", async () => {
    const { service, advance } = setup();
    await service.request(req({ idempotencyKey: "email:a:000001", ttlMinutes: 10 }));
    await service.request(req({ idempotencyKey: "email:b:000002", ttlMinutes: 120 }));
    advance(30 * 60_000);
    expect(await service.list({ status: "pending" })).toHaveLength(1);
    expect(await service.list({ status: "expired" })).toHaveLength(1);
    expect(await service.expireDue()).toHaveLength(0);
  });

  it("throws for unknown approvals", async () => {
    const { service } = setup();
    await expect(service.approve("00000000-0000-4000-8000-000000000000", broker)).rejects.toBeInstanceOf(ApprovalNotFoundError);
  });
});

describe("execution", () => {
  it("runs the send exactly once for an approved request", async () => {
    const { service } = setup();
    const { record } = await service.request(req());
    await service.approve(record.id, broker);
    const send = vi.fn(async () => "resend:msg_123");
    const first = await service.executeOnce(record.id, send);
    const second = await service.executeOnce(record.id, send);
    expect(first).toMatchObject({ status: "executed", executionRef: "resend:msg_123" });
    expect(second).toMatchObject({ status: "already_executed", record: { executionRef: "resend:msg_123" } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never sends pending, rejected or expired approvals", async () => {
    const { service, advance } = setup();
    const send = vi.fn(async () => undefined);
    const pending = (await service.request(req({ idempotencyKey: "email:p:000001" }))).record;
    const rejected = (await service.request(req({ idempotencyKey: "email:r:000002" }))).record;
    await service.reject(rejected.id, broker, "No");
    const expired = (await service.request(req({ idempotencyKey: "email:e:000003", ttlMinutes: 1 }))).record;
    advance(2 * 60_000);
    for (const id of [pending.id, rejected.id, expired.id]) expect((await service.executeOnce(id, send)).status).toBe("not_approved");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not resend after a crash mid-send (at most once)", async () => {
    const { service } = setup();
    const { record } = await service.request(req());
    await service.approve(record.id, broker);
    await expect(service.executeOnce(record.id, async () => Promise.reject(new Error("provider down")))).rejects.toThrow("provider down");
    const send = vi.fn(async () => undefined);
    expect((await service.executeOnce(record.id, send)).status).toBe("already_executed");
    expect(send).not.toHaveBeenCalled();
  });

  it("lets only one of two concurrent executors send", async () => {
    const { service } = setup();
    const { record } = await service.request(req());
    await service.approve(record.id, broker);
    const send = vi.fn(async () => undefined);
    const results = await Promise.all([service.executeOnce(record.id, send), service.executeOnce(record.id, send)]);
    expect(results.map((r) => r.status).sort()).toEqual(["already_executed", "executed"]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("queueApprovalGate", () => {
  const action = {
    kind: "esign_send" as const,
    idempotencyKey: "esign_send:mlds:disc-1:v1",
    summary: "Send the MLDS for signature",
    payload: { disclosureId: "disc-1" },
    requestedBy: "system:disclosures",
  };

  it("answers pending until a broker approves, then approved exactly once", async () => {
    const { service } = setup();
    const gate = queueApprovalGate(service);
    const first = await gate.request(action);
    expect(first).toMatchObject({ status: "pending", approvalId: expect.any(String) });
    expect(await gate.request(action)).toMatchObject({ status: "pending", approvalId: first.status === "pending" ? first.approvalId : "" });

    await service.approve(first.status === "pending" ? first.approvalId! : "", broker);
    const approved = await gate.request(action);
    expect(approved).toMatchObject({ status: "approved", decidedBy: "Pat Broker" });
    // A duplicate request after the send was handed out does not send again.
    expect(await gate.request(action)).toMatchObject({ status: "rejected", reason: "already_executed" });
  });

  it("maps rejected, cancelled and expired decisions to non-sending answers", async () => {
    const { service, advance } = setup();
    const gate = queueApprovalGate(service, { ttlMinutes: 5 });
    const a = await gate.request({ ...action, idempotencyKey: "esign_send:a:000001" });
    await service.reject(a.status === "pending" ? a.approvalId! : "", broker, "Wrong template");
    expect(await gate.request({ ...action, idempotencyKey: "esign_send:a:000001" })).toMatchObject({ status: "rejected", reason: "Wrong template" });

    const c = await gate.request({ ...action, idempotencyKey: "esign_send:c:000003" });
    await service.cancel(c.status === "pending" ? c.approvalId! : "", broker);
    expect(await gate.request({ ...action, idempotencyKey: "esign_send:c:000003" })).toMatchObject({ status: "rejected", reason: "cancelled" });

    await gate.request({ ...action, idempotencyKey: "esign_send:e:000002" });
    advance(6 * 60_000);
    expect(await gate.request({ ...action, idempotencyKey: "esign_send:e:000002" })).toMatchObject({ status: "expired" });
  });
});

describe("ApprovalService decision hook", () => {
  it("reports every decision and expiry once, and a failing hook never blocks the decision", async () => {
    let now = T0;
    const seen: string[] = [];
    const service = new ApprovalService(new MemoryApprovalStore(), () => now, {
      onDecided: async (records) => {
        seen.push(...records.map((r) => `${r.idempotencyKey}:${r.status}`));
      },
    });
    const a = await service.request(req({ idempotencyKey: "email:hook-a" }));
    await service.request(req({ idempotencyKey: "email:hook-b" }));
    expect((await service.approve(a.record.id, broker)).ok).toBe(true);
    expect((await service.approve(a.record.id, broker)).ok).toBe(false);
    now = new Date(T0.getTime() + 2 * 3_600_000);
    await service.expireDue();
    await service.expireDue();
    expect(seen).toEqual(["email:hook-a:approved", "email:hook-b:expired"]);

    const failing = new ApprovalService(new MemoryApprovalStore(), () => T0, { onDecided: () => Promise.reject(new Error("inngest down")) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = await failing.request(req({ idempotencyKey: "email:hook-c" }));
    expect((await failing.reject(c.record.id, broker, "Wrong borrower")).ok).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
