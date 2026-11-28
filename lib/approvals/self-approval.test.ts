// S5: a lender submission sent with an override reason needs a second
// person. The requester cannot approve it, unless they are the designated
// officer (a small firm), and then the decision records that it was
// self-approved. Without an override the queue's rules are unchanged.

import { describe, expect, it } from "vitest";
import { MemoryReauthStore, ReauthService } from "@/lib/agents/core/reauth";
import { queueApprovalGate } from "./gate";
import { ApprovalService } from "./service";
import { MemoryApprovalStore } from "./store";
import { SELF_APPROVED_NOTE, isSelfApproval, needsSeparateApprover, type Approver } from "./types";

const T0 = new Date("2026-11-20T17:00:00Z");
const ANA = "00000000-0000-4000-8000-0000000000b1";
const LEE = "00000000-0000-4000-8000-0000000000b2";
const ana: Approver = { userId: ANA, label: "Ana Broker", dreLicense: "01234567", email: "ana@corin.test" };
const anaOfficer: Approver = { ...ana, designatedOfficer: true };
const lee: Approver = { userId: LEE, label: "Lee Broker", dreLicense: "01234568", email: "lee@corin.test" };

function world() {
  const proofs = new MemoryReauthStore();
  const service = new ApprovalService(new MemoryApprovalStore(), () => T0, {}, proofs);
  const reauth = new ReauthService(proofs, () => T0);
  const request = (n: number, payload: Record<string, unknown>, by: { requestedBy: string; requestedByUser?: string } = { requestedBy: "staff:ana@corin.test", requestedByUser: ANA }) =>
    service.request({ kind: "lender_submission", idempotencyKey: `lender_submission:test:00000${n}`, summary: "Send the package", templateId: "lender_package_submission_v2", payload: { dealId: "d", lenderId: "l", ...payload }, ...by });
  const approve = async (id: string, who: Approver) => {
    const approval = (await service.get(id))!;
    await reauth.record({ approval, user: { userId: who.userId, dreLicense: who.dreLicense }, factor: { method: "totp", verifiedAt: T0 } });
    return service.approve(id, who);
  };
  return { service, request, approve };
}

describe("self-approval of an override", () => {
  it.each([
    ["a readiness reason", { overrideReason: "The T-12 arrives Friday; the lender asked now", readinessMissing: ["docs.t12"] }],
    ["a lender override reason", { lenderOverrideReason: "Their desk confirmed a CA exception by phone", fitExceptions: ["CA is outside your recorded states (NV)"] }],
  ])("is refused with %s, and allowed to another broker", async (_label, payload) => {
    const w = world();
    const { record } = await w.request(1, payload);
    expect(record.requestedByUser).toBe(ANA);
    expect(await w.approve(record.id, ana)).toMatchObject({ ok: false, reason: "self_approval" });
    expect((await w.service.get(record.id))!.status).toBe("pending");
    const ok = await w.approve(record.id, lee);
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.record.decisionReason).toBeNull();
  });

  it("is allowed to the designated officer, and recorded as self-approved", async () => {
    const w = world();
    const { record } = await w.request(2, { overrideReason: "The T-12 arrives Friday; the lender asked now" });
    const r = await w.approve(record.id, anaOfficer);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.record.decisionReason).toBe(SELF_APPROVED_NOTE);
  });

  it("matches the requester by sign-in email when the request carries no user id", async () => {
    const w = world();
    const { record } = await w.request(3, { overrideReason: "The T-12 arrives Friday; the lender asked now" }, { requestedBy: "staff:ana@corin.test" });
    expect(record.requestedByUser).toBeNull();
    expect(await w.approve(record.id, { ...ana, email: "ANA@corin.test" })).toMatchObject({ ok: false, reason: "self_approval" });
  });

  it("leaves a submission with no override reason to the usual rules", async () => {
    const w = world();
    const { record } = await w.request(4, { overrideReason: null, lenderOverrideReason: null, readinessMissing: [] });
    expect(needsSeparateApprover(record)).toBe(false);
    expect(await w.approve(record.id, ana)).toMatchObject({ ok: true });
  });

  it("the queue gate records who requested, so the check has something to compare", async () => {
    const service = new ApprovalService(new MemoryApprovalStore(), () => T0);
    const gate = queueApprovalGate(service);
    await gate.request({ kind: "lender_submission", idempotencyKey: "lender_submission:test:000010", summary: "s", payload: { overrideReason: "x".repeat(25) }, requestedBy: "staff:ana@corin.test", requestedByUser: ANA });
    const r = (await service.getByKey("lender_submission:test:000010"))!;
    expect(r.requestedByUser).toBe(ANA);
    expect(isSelfApproval(r, ana)).toBe(true);
    expect(isSelfApproval(r, lee)).toBe(false);
    // A non-UUID id (an agent's) is not passed through.
    await gate.request({ kind: "lender_submission", idempotencyKey: "lender_submission:test:000011", summary: "s", payload: {}, requestedBy: "agent:x", requestedByUser: "agent" });
    expect((await service.getByKey("lender_submission:test:000011"))!.requestedByUser).toBeNull();
  });
});
