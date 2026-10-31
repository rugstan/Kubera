import { describe, expect, it } from "vitest";
import { GuardError } from "./store";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import type { ApprovalRecord } from "@/lib/approvals/types";
import { MemoryReauthStore, ReauthService } from "@/lib/agents/core/reauth";
import { canonicalManifest, checkOutreachApproval, lockPackageVersion, manifestDigest, markOutreachSent, outreachApprovalKey, outreachMessage, recordLenderResponse, sendPackageToLender, withdrawOutreach, type LenderMailer } from "./packages";
import { hashShareToken, resolveShareLink, tokenMatches } from "./share-links";
import { docs, lenderInput, newDeal, setup } from "./test-fixtures";

const base = "https://kuberacommercial.com";

function mailer(): LenderMailer & { sent: { to: string; text: string; idempotencyKey: string }[] } {
  const sent: { to: string; text: string; idempotencyKey: string }[] = [];
  return { sent, async send(m) { sent.push(m); return { messageId: `msg_${sent.length}` }; } };
}

async function world(gateDefault: "approved" | "pending" | "rejected" | "expired" = "approved") {
  const ctx = setup(gateDefault);
  const deal = await newDeal(ctx.store, ctx.now);
  const lender = await ctx.store.insertLender(lenderInput(), "broker:ana", ctx.now());
  const other = await ctx.store.insertLender(lenderInput({ name: "Greystone", contactEmail: "desk@greystone.example" }), "broker:ana", ctx.now());
  return { ...ctx, deal, lender, other };
}

describe("package manifests", () => {
  it("canonicalizes order so the digest does not depend on upload order", () => {
    const a = docs(3);
    expect(manifestDigest(a)).toBe(manifestDigest([...a].reverse()));
    expect(canonicalManifest([...a].reverse()).map((d) => d.documentId)).toEqual(["doc-1", "doc-2", "doc-3"]);
    expect(manifestDigest(a)).not.toBe(manifestDigest(docs(3, "b")));
  });

  it("rejects empty, duplicate and malformed manifests", () => {
    expect(() => canonicalManifest([])).toThrow(/at least one/);
    const [d] = docs(1);
    expect(() => canonicalManifest([d!, d!])).toThrow(/twice/);
    expect(() => canonicalManifest([{ ...d!, sha256: "nope" }])).toThrow(/sha256/);
  });
});

describe("package lock and version on send", () => {
  it("locks version 1 on the first send, reuses it for the same documents, and versions a changed set", async () => {
    const { store, gate, now, deal, lender, other } = await world();
    const m = mailer();
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, { dealId: deal.id, lenderId: lender.id, items: docs(3), actor: "broker:ana" });
    expect(first.pkg).toMatchObject({ version: 1, status: "locked", lockedBy: "broker:ana" });
    expect(first.outreach.status).toBe("sent");
    expect(first.outreach.packageVersion).toBe(1);

    // Same documents to another lender: same locked version, new share link.
    const second = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, { dealId: deal.id, lenderId: other.id, items: [...docs(3)].reverse(), actor: "broker:ana" });
    expect(second.pkg.id).toBe(first.pkg.id);

    // A new rent roll: version 2; version 1 stays exactly as the first lender saw it.
    const changed = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, { dealId: deal.id, lenderId: lender.id, items: docs(4), actor: "broker:ana" });
    expect(changed.pkg.version).toBe(2);
    const v1 = await store.getPackage(first.pkg.id);
    expect(v1!.manifest).toHaveLength(3);
    expect(v1!.manifestSha256).toBe(first.pkg.manifestSha256);
    await expect(store.lockPackage(first.pkg.id, "x", now())).rejects.toBeInstanceOf(GuardError);
    expect((await store.listPackages(deal.id)).map((p) => p.version)).toEqual([1, 2]);
  });

  it("goes through the approval gate with one idempotency key per lender and version, and sends once", async () => {
    const { store, gate, now, deal, lender } = await world();
    const m = mailer();
    const input = { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana" };
    await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, input);
    await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, input);
    expect(gate.requests).toHaveLength(1);
    expect(gate.requests[0]).toMatchObject({ kind: "lender_submission", idempotencyKey: outreachApprovalKey(deal.id, lender.id, 1), templateId: "lender_package_submission_v1" });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.to).toBe("dana@lender.example");
    expect(m.sent[0]!.text).toMatch(/broker, not the lender/);
  });

  it("sends nothing and mints no link while approval is pending, rejected or expired", async () => {
    for (const status of ["pending", "rejected", "expired"] as const) {
      const { store, gate, now, deal, lender } = await world(status);
      const m = mailer();
      const r = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana" });
      expect(r.outreach.status).toBe(status === "pending" ? "pending_approval" : status);
      expect(r.outreach.shareLinkId).toBeNull();
      expect(r.shareUrl).toBeUndefined();
      expect(m.sent).toHaveLength(0);
      expect(store.links.size).toBe(0);
      // The version is still locked: what was submitted for approval cannot change.
      expect(r.pkg.status).toBe("locked");
    }
  });

  it("re-checks a pending approval and sends after a broker approves", async () => {
    const { store, gate, now, deal, lender } = await world("pending");
    const m = mailer();
    const input = { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana" };
    await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, input);
    gate.decide(outreachApprovalKey(deal.id, lender.id, 1), { status: "approved", approvalId: "appr_1", decidedBy: "broker:lee", decidedAt: now() });
    const r = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, input);
    expect(r.outreach).toMatchObject({ status: "sent", approvedBy: "broker:lee" });
    expect(m.sent).toHaveLength(1);
    expect(store.outreach.size).toBe(1);
  });

  it("without a mailer returns the share URL once and waits for the broker to mark it sent", async () => {
    const { store, gate, now, deal, lender } = await world();
    const r = await sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" });
    expect(r.outreach.status).toBe("approved");
    expect(r.shareUrl).toMatch(/^https:\/\/kuberacommercial\.com\/api\/deals\/share\/[A-Za-z0-9_-]{43}$/);
    const token = r.shareUrl!.split("/").pop()!;
    const link = [...store.links.values()][0]!;
    expect(link.tokenHash).toBe(hashShareToken(token));
    expect(JSON.stringify([...store.links.values()])).not.toContain(token);
    expect(tokenMatches(token, link.tokenHash)).toBe(true);
    const sent = await markOutreachSent(store, r.outreach.id, "broker:ana", now(), "zoho:abc");
    expect(sent.status).toBe("sent");
    await expect(markOutreachSent(store, r.outreach.id, "broker:ana", now())).rejects.toThrow(/Only approved/);
  });

  it("blocks a stale lender unless staff acknowledge it, and lenders without appetite for the program", async () => {
    const { store, gate, now, deal } = await world();
    const stale = await store.insertLender(lenderInput({ name: "Old Bank", verifiedAt: "2025-01-01T00:00:00.000Z" }), "a", now());
    await expect(sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: stale.id, items: docs(1), actor: "a" })).rejects.toMatchObject({ reason: "stale_lender" });
    expect(gate.requests).toHaveLength(0);
    const ok = await sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: stale.id, items: docs(1), actor: "a", allowStaleLender: true });
    expect(ok.outreach.staleLenderOverride).toBe(true);
    expect(gate.requests[0]!.payload.staleLenderOverride).toBe(true);

    const cmbs = await store.insertLender(lenderInput({ name: "CMBS only", programs: ["HOTEL_CMBS"] }), "a", now());
    await expect(sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: cmbs.id, items: docs(1), actor: "a" })).rejects.toMatchObject({ reason: "lender_program" });
  });
});

describe("checking a pending submission", () => {
  const broker = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };

  async function queued() {
    const w = await world();
    const proofs = new MemoryReauthStore();
    const service = new ApprovalService(new MemoryApprovalStore(), w.now, {}, proofs);
    const reauth = new ReauthService(proofs, w.now);
    /** The broker's step-up (fresh TOTP) then the approval, as the approvals page does. */
    const approve = async (id: string) => {
      const record = (await service.get(id)) as ApprovalRecord;
      await reauth.record({ approval: record, user: { userId: broker.userId, dreLicense: broker.dreLicense }, factor: { method: "totp", verifiedAt: w.now() } });
      return service.approve(id, broker);
    };
    return { ...w, service, proofs, approve, gate: queueApprovalGate(service) };
  }

  it("refuses to approve a lender submission without the broker's step-up, and never sends it", async () => {
    const { store, gate, service, now, deal, lender } = await queued();
    const m = mailer();
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, { dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" });
    const approval = (await service.getByKey(first.outreach.approvalKey))!;
    expect(approval.kind).toBe("lender_submission");
    const denied = await service.approve(approval.id, broker);
    expect(denied).toMatchObject({ ok: false, reason: "reauth_required" });
    const r = await checkOutreachApproval({ store, gate, now, baseUrl: base, mailer: m }, first.outreach.id, "a");
    expect(r.outreach.status).toBe("pending_approval");
    expect(r.shareUrl).toBeUndefined();
    expect(m.sent).toHaveLength(0);
    expect(store.links.size).toBe(0);
  });

  it("does not send an approved lender submission that has no step-up proof", async () => {
    // An approval row marked approved some other way (a direct store write, a
    // legacy row): the gate still refuses to hand out "approved".
    const w = await world();
    const approvals = new MemoryApprovalStore();
    const service = new ApprovalService(approvals, w.now, {}, new MemoryReauthStore());
    const gate = queueApprovalGate(service);
    const m = mailer();
    const first = await sendPackageToLender({ store: w.store, gate, now: w.now, baseUrl: base, mailer: m }, { dealId: w.deal.id, lenderId: w.lender.id, items: docs(1), actor: "broker:ana" });
    const pending = (await service.getByKey(first.outreach.approvalKey))!;
    await approvals.decide(pending.id, { status: "approved", decidedBy: broker.userId, decidedByLabel: broker.label, decidedByDre: broker.dreLicense, decisionReason: null }, w.now());
    expect((await service.get(pending.id))!.status).toBe("approved");

    const r = await checkOutreachApproval({ store: w.store, gate, now: w.now, baseUrl: base, mailer: m }, first.outreach.id, "a");
    expect(r.outreach.status).toBe("pending_approval");
    expect(m.sent).toHaveLength(0);
    expect(w.store.links.size).toBe(0);
    expect((await service.get(pending.id))!.executedAt).toBeNull();
    expect(await service.claimExecution(pending.id)).toBeNull();

    // Without any proof store the queue fails closed as well.
    const closed = new ApprovalService(approvals, w.now);
    expect(await closed.reauthCheck((await closed.get(pending.id))!)).toMatchObject({ ok: false, reason: "no_proof" });
  });

  it("mints the share link once a broker approves, without re-submitting the package", async () => {
    const { store, gate, service, approve, now, deal, lender } = await queued();
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana", note: "Rush, please" });
    expect(first.outreach.status).toBe("pending_approval");
    expect(outreachMessage(first)).toMatch(/Check approval/);
    const approval = (await service.getByKey(first.outreach.approvalKey))!;
    expect(approval.summary).toContain("note: Rush, please");
    expect(approval.payload).not.toHaveProperty("note");

    // Still pending: nothing changes.
    expect((await checkOutreachApproval({ store, gate, now, baseUrl: base }, first.outreach.id, "a")).outreach.status).toBe("pending_approval");

    // A re-send with another note reuses the same approval instead of conflicting.
    const again = await sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana", note: "Different note" });
    expect(again.outreach.id).toBe(first.outreach.id);

    expect(await approve(approval.id)).toMatchObject({ ok: true });
    const packagesBefore = (await store.listPackages(deal.id)).length;
    const r = await checkOutreachApproval({ store, gate, now, baseUrl: base }, first.outreach.id, "broker:ana");
    expect(r.outreach).toMatchObject({ status: "approved", approvalId: approval.id });
    expect(r.shareUrl).toMatch(/\/api\/deals\/share\//);
    expect((await store.listPackages(deal.id)).length).toBe(packagesBefore);
    expect(store.links.size).toBe(1);
    // Checking again does nothing more (the approval was used by the link).
    const later = await checkOutreachApproval({ store, gate, now, baseUrl: base }, first.outreach.id, "broker:ana");
    expect(later.shareUrl).toBeUndefined();
    expect(store.links.size).toBe(1);
  });

  it("emails the lender on approval when a mailer is configured", async () => {
    const { store, gate, service, approve, now, deal, lender } = await queued();
    const m = mailer();
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m }, { dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" });
    expect(await approve((await service.getByKey(first.outreach.approvalKey))!.id)).toMatchObject({ ok: true });
    const r = await checkOutreachApproval({ store, gate, now, baseUrl: base, mailer: m }, first.outreach.id, "a");
    expect(r.outreach.status).toBe("sent");
    expect(m.sent).toHaveLength(1);
  });

  it("shows a rejected or expired approval on the submission", async () => {
    const { store, gate, service, now, clock, deal, lender, other } = await queued();
    const a = await sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "a" });
    await service.reject((await service.getByKey(a.outreach.approvalKey))!.id, broker, "Not this lender");
    const rejected = await checkOutreachApproval({ store, gate, now, baseUrl: base }, a.outreach.id, "a");
    expect(rejected.outreach).toMatchObject({ status: "rejected", responseNote: "Not this lender" });
    expect(outreachMessage(rejected)).toMatch(/rejected/);

    const b = await sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: other.id, items: docs(1), actor: "a" });
    clock.advance(25 * 60 * 60 * 1000);
    const expired = await checkOutreachApproval({ store, gate, now, baseUrl: base }, b.outreach.id, "a");
    expect(expired.outreach.status).toBe("expired");
    expect(store.links.size).toBe(0);
  });

  it("explains a changed lender contact instead of failing generically", async () => {
    const { store, gate, now, deal, lender } = await queued();
    const a = await sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "a" });
    await store.updateLender(lender.id, { contactEmail: "new@cambridge.example" }, "a", now());
    await expect(checkOutreachApproval({ store, gate, now, baseUrl: base }, a.outreach.id, "a")).rejects.toThrow(/contact email changed/);
  });
});

describe("share links", () => {
  async function linked() {
    const w = await world();
    const r = await sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base }, { dealId: w.deal.id, lenderId: w.lender.id, items: docs(2), actor: "broker:ana", ttlDays: 7 });
    return { ...w, r, token: r.shareUrl!.split("/").pop()! };
  }

  it("serves the locked version it was issued for, counts accesses, and expires", async () => {
    const { store, gate, now, clock, deal, lender, r, token } = await linked();
    const ok = await resolveShareLink(store, token, now());
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") throw new Error();
    expect(ok.pkg.version).toBe(1);
    expect(ok.link.accessCount).toBe(1);
    expect(ok.newerVersionAvailable).toBe(false);

    await sendPackageToLender({ store, gate, now, baseUrl: base }, { dealId: deal.id, lenderId: lender.id, items: docs(3), actor: "broker:ana" });
    const again = await resolveShareLink(store, token, now());
    expect(again).toMatchObject({ status: "ok", newerVersionAvailable: true, pkg: { version: 1 } });

    clock.advance(7 * 86_400_000 + 1);
    expect((await resolveShareLink(store, token, now())).status).toBe("expired");
    expect(store.links.get(r.outreach.shareLinkId!)!.accessCount).toBe(2);
  });

  it("is revoked when the submission is withdrawn, and rejects malformed or unknown tokens", async () => {
    const { store, now, r, token } = await linked();
    await withdrawOutreach(store, r.outreach.id, "Borrower paused the refinance", "broker:ana", now());
    expect((await resolveShareLink(store, token, now())).status).toBe("revoked");
    expect((await resolveShareLink(store, "short", now())).status).toBe("not_found");
    expect((await resolveShareLink(store, "A".repeat(43), now())).status).toBe("not_found");
  });

  it("caps the lifetime at 30 days", async () => {
    const w = await world();
    const r = await sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base }, { dealId: w.deal.id, lenderId: w.lender.id, items: docs(1), actor: "a", ttlDays: 365 });
    const link = w.store.links.get(r.outreach.shareLinkId!)!;
    expect(Date.parse(link.expiresAt) - w.now().getTime()).toBe(30 * 86_400_000);
  });

  it("records lender responses only on sent submissions", async () => {
    const { store, now, r } = await linked();
    await expect(recordLenderResponse(store, r.outreach.id, { status: "declined" }, "a", now())).rejects.toThrow(/sent submission/);
    await markOutreachSent(store, r.outreach.id, "a", now());
    await expect(recordLenderResponse(store, r.outreach.id, { status: "term_sheet" }, "a", now())).rejects.toThrow(/vault reference/);
    const ts = await recordLenderResponse(store, r.outreach.id, { status: "term_sheet", termSheetRef: "vault://ts/v1.pdf" }, "a", now());
    expect(ts).toMatchObject({ status: "term_sheet", termSheetRef: "vault://ts/v1.pdf" });
  });
});

describe("lockPackageVersion", () => {
  it("never mutates a locked version", async () => {
    const { store, now, deal } = await world();
    const a = await lockPackageVersion(store, deal.id, docs(2), "a", now());
    const b = await lockPackageVersion(store, deal.id, docs(2), "a", now());
    expect(b.created).toBe(false);
    expect(b.pkg.id).toBe(a.pkg.id);
    const c = await lockPackageVersion(store, deal.id, docs(2, "c"), "a", now());
    expect(c.pkg.version).toBe(2);
    // Going back to the v1 documents after v2 makes a new v3 (latest wins; history is append-only).
    const d = await lockPackageVersion(store, deal.id, docs(2), "a", now());
    expect(d.pkg.version).toBe(3);
  });
});
