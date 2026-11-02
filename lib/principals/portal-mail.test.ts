// The portal invitation: the approval request never carries the link or its
// token, and a broker's approval sends the Resend portal_invite email (through
// lib/notify) with a fresh link, once.
import { describe, expect, it } from "vitest";
import { executeApproved } from "@/lib/approvals/executors";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import { FakeApprovalGate, type ApprovalGate } from "@/lib/compliance/approval-gate";
import { Notifier } from "@/lib/notify/service";
import { makeHarness } from "@/lib/notify/testing";
import { issuePortalInvite, redeemPortalLink } from "./portal";
import { isPortalInviteApproval, portalInviteExecutor, sendApprovedPortalInvite } from "./portal-mail";
import { MemoryPortalInviteStore } from "./store";
import { DEAL_ID } from "./test-fixtures";

const NOW = new Date("2026-11-03T20:00:00Z");
const broker = { userId: "u-broker", label: "Ana Ruiz", dreLicense: "01234567" };

function rig() {
  const h = makeHarness({ now: NOW });
  const invites = new MemoryPortalInviteStore();
  const notifier = (gate: ApprovalGate) => new Notifier({ email: h.email, sms: h.sms, store: h.store, consent: h.consent, gate, preApproved: new Set(), now: () => NOW });
  const mail = { invites, notifier, origin: "https://corincommercial.com", now: () => NOW };
  const store = new MemoryApprovalStore();
  const service: ApprovalService = new ApprovalService(store, () => NOW, {
    onDecided: async (records) => {
      await executeApproved(service, records, [{ name: "portal_invite", matches: isPortalInviteApproval, run: portalInviteExecutor(mail) }]);
    },
  });
  return { h, invites, mail, store, service, gate: queueApprovalGate(service) };
}

const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

describe("portal invitation email", () => {
  it("keeps the link and its token out of the approval request", async () => {
    const { invites, store, gate } = rig();
    const issued = await issuePortalInvite(invites, { dealId: DEAL_ID, principalId: null, email: "pat@example.com", issuedBy: "broker@k.com", origin: "https://corincommercial.com", now: NOW }, { gate });
    expect(issued.email).toBe("pending");
    const [approval] = await store.list({ status: "pending" });
    expect(approval).toBeDefined();
    const serialized = JSON.stringify(approval);
    expect(serialized).not.toContain(tokenOf(issued.url));
    expect(serialized).not.toContain("/portal/access");
    expect(approval!.payload).toEqual({ to: "pat@example.com", dealId: DEAL_ID, principalId: null, inviteId: issued.invite.id, expiresAt: issued.invite.expiresAt });
  });

  it("sends the email with a fresh link when a broker approves, exactly once", async () => {
    const { h, invites, service, gate } = rig();
    const issued = await issuePortalInvite(invites, { dealId: DEAL_ID, principalId: null, email: "pat@example.com", issuedBy: "broker@k.com", origin: "https://corincommercial.com", now: NOW }, { gate });
    expect(h.email.sent).toHaveLength(0);
    const approvalId = issued.approval && "approvalId" in issued.approval ? issued.approval.approvalId! : "";

    const decided = await service.approve(approvalId, broker);
    expect(decided.ok).toBe(true);
    expect(h.email.sent).toHaveLength(1);
    const mail = h.email.sent[0]!;
    expect(mail.to).toBe("pat@example.com");
    const link = mail.text.match(/https:\/\/corincommercial\.com\/portal\/access\?token=[A-Za-z0-9_%-]+/)?.[0];
    expect(link).toBeTruthy();
    const emailed = decodeURIComponent(tokenOf(link!));
    expect(emailed).not.toBe(tokenOf(issued.url));

    // Exactly one live link: the copied one stops working, the emailed one redeems.
    await expect(redeemPortalLink(invites, tokenOf(issued.url), NOW)).rejects.toMatchObject({ code: "invalid" });
    expect(await redeemPortalLink(invites, emailed, NOW)).toMatchObject({ inviteId: issued.invite.id, email: "pat@example.com" });

    // The approval is executed; a replayed decision hook sends nothing more.
    const record = (await service.get(approvalId))!;
    expect(record.executedAt).not.toBeNull();
    expect(record.executionRef).toMatch(/^notify:sent/);
    await executeApproved(service, [record], [{ name: "portal_invite", matches: isPortalInviteApproval, run: portalInviteExecutor(rig().mail) }]);
    expect(h.email.sent).toHaveLength(1);
  });

  it("sends nothing on rejection, and nothing for a link that was used or revoked meanwhile", async () => {
    const { h, invites, service, gate, mail } = rig();
    const a = await issuePortalInvite(invites, { dealId: DEAL_ID, principalId: null, email: "pat@example.com", issuedBy: "b", origin: "https://k.test", now: NOW }, { gate });
    await service.reject((a.approval as { approvalId: string }).approvalId, broker, "Wrong contact");
    expect(h.email.sent).toHaveLength(0);

    const b = await issuePortalInvite(invites, { dealId: DEAL_ID, principalId: null, email: "pat@example.com", issuedBy: "b", origin: "https://k.test", now: NOW }, { gate });
    await invites.revoke(b.invite.id, NOW);
    expect(await sendApprovedPortalInvite(mail, { inviteId: b.invite.id, approval: { id: "ap", decidedBy: "u", decidedAt: NOW.toISOString() }, requestedBy: "b" })).toMatchObject({ status: "skipped" });
    expect(h.email.sent).toHaveLength(0);
  });

  it("an email that cannot go out leaves the original link working", async () => {
    const { invites, mail } = rig();
    const issued = await issuePortalInvite(invites, { dealId: DEAL_ID, principalId: null, email: "pat@example.com", issuedBy: "b", origin: "https://k.test", now: NOW }, { gate: new FakeApprovalGate("pending") });
    const noEmail = { ...mail, notifier: (g: ApprovalGate) => new Notifier({ email: null, sms: null, store: makeHarness().store, consent: makeHarness().consent, gate: g, preApproved: new Set(), now: () => NOW }) };
    expect(await sendApprovedPortalInvite(noEmail, { inviteId: issued.invite.id, approval: { id: "ap", decidedBy: "u", decidedAt: NOW.toISOString() }, requestedBy: "b" })).toMatchObject({ status: "not_sent" });
    expect(await redeemPortalLink(invites, tokenOf(issued.url), NOW)).toMatchObject({ inviteId: issued.invite.id });
  });
});
