import { describe, expect, it } from "vitest";
import { MemoryReauthStore, ReauthService } from "@/lib/agents/core/reauth";
import type { OutboundAction } from "@/lib/compliance/approval-gate";
import { queueApprovalGate } from "./gate";
import { payloadHash } from "./hash";
import { ApprovalService } from "./service";
import { MemoryApprovalStore } from "./store";

// Step-up re-authentication is enforced by the queue itself, so every real
// send path (lender packages, MLDS, Form 159, fee quotes) gets it through the
// gate, not only agent tools.

const BROKER = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };
const t0 = new Date("2026-11-04T17:00:00.000Z");

function world() {
  let now = t0;
  const clock = () => now;
  const store = new MemoryApprovalStore();
  const proofs = new MemoryReauthStore();
  const service = new ApprovalService(store, clock, {}, proofs);
  const reauth = new ReauthService(proofs, clock);
  return { store, proofs, service, reauth, gate: queueApprovalGate(service), advance: (min: number) => (now = new Date(now.getTime() + min * 60_000)), clock };
}

const action = (kind: OutboundAction["kind"], extra: Partial<OutboundAction> = {}): OutboundAction => ({
  kind,
  idempotencyKey: `${kind}:test:000001`,
  summary: `Test ${kind}`,
  payload: { to: "someone@example.com" },
  requestedBy: "broker:ana",
  ...extra,
});

describe("step-up re-authentication on the approval queue", () => {
  it.each(["lender_submission", "mlds_send", "form159_send", "fee_quote"] as const)("%s: approve needs a fresh proof, then sends once", async (kind) => {
    const w = world();
    const first = await w.gate.request(action(kind));
    expect(first.status).toBe("pending");
    const record = (await w.service.getByKey(`${kind}:test:000001`))!;
    expect(await w.service.approve(record.id, BROKER)).toMatchObject({ ok: false, reason: "reauth_required" });
    expect(await w.gate.request(action(kind))).toMatchObject({ status: "pending" });

    await w.reauth.record({ approval: record, user: { userId: BROKER.userId, dreLicense: BROKER.dreLicense }, factor: { method: "totp", verifiedAt: w.clock() } });
    expect(await w.service.approve(record.id, BROKER)).toMatchObject({ ok: true });
    expect(await w.gate.request(action(kind))).toMatchObject({ status: "approved", approvalId: record.id });
    // Handed out once.
    expect(await w.gate.request(action(kind))).toMatchObject({ status: "rejected", reason: "already_executed" });
  });

  it("an approved lender submission without a proof never sends (gate, claim and executeOnce all refuse)", async () => {
    const w = world();
    await w.gate.request(action("lender_submission"));
    const record = (await w.service.getByKey("lender_submission:test:000001"))!;
    await w.store.decide(record.id, { status: "approved", decidedBy: BROKER.userId, decidedByLabel: BROKER.label, decidedByDre: BROKER.dreLicense, decisionReason: null }, w.clock());
    expect(await w.gate.request(action("lender_submission"))).toEqual({ status: "pending", approvalId: record.id, reason: "reauth_required" });
    expect(await w.gate.peek!(action("lender_submission"))).toMatchObject({ status: "pending", reason: "reauth_required" });
    expect(await w.service.claimExecution(record.id)).toBeNull();
    let ran = false;
    expect(await w.service.executeOnce(record.id, async () => void (ran = true))).toMatchObject({ status: "not_approved" });
    expect(ran).toBe(false);
    expect((await w.service.get(record.id))!.executedAt).toBeNull();
  });

  it("a stale second factor does not approve", async () => {
    const w = world();
    await w.gate.request(action("mlds_send"));
    const record = (await w.service.getByKey("mlds_send:test:000001"))!;
    await w.reauth.record({ approval: record, user: { userId: BROKER.userId, dreLicense: BROKER.dreLicense }, factor: { method: "totp", verifiedAt: w.clock() } });
    w.advance(30);
    expect(await w.service.approve(record.id, BROKER)).toMatchObject({ ok: false, reason: "reauth_required" });
  });

  it("never auto-approves a sensitive send, even from a pre-approved template", async () => {
    const w = world();
    const body = payloadHash({ body: "fee quote" });
    w.store.addTemplate({ templateId: "fee_quote_v1", kind: "fee_quote", description: "Fee quote", bodySha256: body, approvedBy: BROKER.userId, approvedByDre: BROKER.dreLicense, approvedAt: t0.toISOString(), revokedAt: null });
    const d = await w.gate.request(action("fee_quote", { templateId: "fee_quote_v1", payload: { to: "x@example.com", templateBodySha256: body } }));
    expect(d.status).toBe("pending");
  });

  it("other kinds are unaffected", async () => {
    const w = world();
    await w.gate.request(action("crm_update"));
    const record = (await w.service.getByKey("crm_update:test:000001"))!;
    expect(await w.service.approve(record.id, BROKER)).toMatchObject({ ok: true });
    expect(await w.gate.request(action("crm_update"))).toMatchObject({ status: "approved" });
  });
});
