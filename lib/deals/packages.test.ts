import { describe, expect, it } from "vitest";
import { GuardError } from "./store";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import type { ApprovalRecord } from "@/lib/approvals/types";
import { MemoryReauthStore, ReauthService } from "@/lib/agents/core/reauth";
import { dealSummaryPackageItem } from "@/lib/agents/lenders/package";
import {
  LENDER_SUBMISSION_TEMPLATE_ID,
  LENDER_SUBMISSION_TEMPLATE_ID_V2,
  PackageError,
  approvedEmailForShare,
  canonicalManifest,
  checkOutreachApproval,
  lockPackageVersion,
  manifestDigest,
  markOutreachSent,
  outreachApprovalKey,
  outreachMessage,
  recordLenderResponse,
  sendPackageToLender,
  withdrawOutreach,
  type LenderMailer,
  type SendPackageInput,
} from "./packages";
import { hashShareToken, resolveShareLink, tokenMatches } from "./share-links";
import { MemoryDealHoldStore } from "@/lib/screening/store";
import { syncDealHoldStatus } from "./holds";
import { advanceDeal } from "./service";
import { emailSha256, fillEmailPlaceholders } from "./submission/email";
import { fmt } from "./submission/summary";
import type { DealSummaryRecord, SubmissionSendInput } from "./submission/types";
import { addPrimaryContact, docs, lenderInput, newDeal, noHolds, setup } from "./test-fixtures";

const base = "https://corincommercial.com";

function mailer(): LenderMailer & { sent: { to: string; text: string; idempotencyKey: string }[] } {
  const sent: { to: string; text: string; idempotencyKey: string }[] = [];
  return { sent, async send(m) { sent.push(m); return { messageId: `msg_${sent.length}` }; } };
}

async function world(gateDefault: "approved" | "pending" | "rejected" | "expired" = "approved") {
  const ctx = setup(gateDefault);
  const deal = await newDeal(ctx.store, ctx.now);
  const lender = await ctx.store.insertLender(lenderInput(), "broker:ana", ctx.now());
  const other = await ctx.store.insertLender(lenderInput({ name: "Greystone", submissionEmail: "desk@greystone.example" }), "broker:ana", ctx.now());
  return { ...ctx, deal, lender, other };
}

// ---------------------------------------------------------------------------
// Every send carries the lender-ready submission (lib/deals/submission/send.ts
// builds it): a locked deal summary, its PDF in the manifest, readiness, the
// lender fit and the exact email.

const PDF_SHA = "b".repeat(64);
/** A minimal deal_summaries store (the real one is lib/deals/submission/store.ts). */
function summaryStore(records: DealSummaryRecord[] = []) {
  const rows = new Map(records.map((r) => [r.id, r]));
  return { rows, getSummary: async (id: string) => rows.get(id) ?? null };
}

function summaryRecord(dealId: string, over: Partial<DealSummaryRecord> = {}): DealSummaryRecord {
  return {
    id: "summary-1",
    dealId,
    asOf: "2026-11-01",
    playbook: "hud_232",
    targetStage: "term_sheet",
    templateVersion: "deal-summary-v1",
    spec: {
      templateVersion: "deal-summary-v1",
      title: "Sunrise Assisted Living refi — loan request summary",
      subtitle: "Prepared November 1, 2026 by Corin Commercial, Inc. for lender review",
      asOf: "2026-11-01",
      headline: [
        { label: "Loan request", value: "$12,500,000" },
        { label: "LTV", value: "75%" },
        { label: "DSCR", value: "1.33x" },
      ],
      sections: [],
      metricNotes: [],
      openItems: ["T-12 operating statement", "Rent roll, census or STR report"],
      footer: "license",
    },
    specSha256: "a".repeat(64),
    pdfSha256: PDF_SHA,
    pdfStoragePath: `packages/${dealId}/deal-summary-${PDF_SHA.slice(0, 16)}.pdf`,
    profileVersion: 3,
    sponsorVersion: 2,
    createdBy: "broker:ana",
    createdAt: "2026-11-01T17:00:00.000Z",
    ...over,
  };
}

const EMAIL_TEXT = "Hello,\n\nCorin Commercial, Inc. is the broker on this request, not the lender.\n\nSecure link (expires {{LINK_EXPIRES}}):\n{{SHARE_LINK}}\n";

function submission(lenderId: string, over: Partial<SubmissionSendInput> = {}): SubmissionSendInput {
  return {
    targetStage: "term_sheet",
    summaryId: "summary-1",
    readiness: { missing: [], hardStops: [], score: 100 },
    fit: { lenderId, matches: ["HUD / FHA"], exceptions: [], unknown: [], staleness: { stale: false, ageDays: 33, reason: null }, score: null },
    email: { subject: "Loan request: $12,500,000 HUD 232 | Corin Commercial", text: EMAIL_TEXT, sha256: emailSha256("Loan request: $12,500,000 HUD 232 | Corin Commercial", EMAIL_TEXT) },
    ...over,
  };
}

/** Answers for any deal: summary "summary-of:<dealId>" is that deal's locked term-sheet summary. */
const anySummary = { getSummary: async (id: string) => (id.startsWith("summary-of:") ? summaryRecord(id.slice("summary-of:".length), { id }) : null) };

/** A send input made lender-ready: the deal summary PDF joins the documents and the submission is complete (nothing missing). */
function v2(input: Omit<SendPackageInput, "submission">, over: Partial<SubmissionSendInput> = {}): SendPackageInput {
  return { ...input, items: [...input.items, dealSummaryPackageItem(input.dealId, PDF_SHA)], submission: submission(input.lenderId, { summaryId: `summary-of:${input.dealId}`, ...over }) };
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
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(3), actor: "broker:ana" }));
    expect(first.pkg).toMatchObject({ version: 1, status: "locked", lockedBy: "broker:ana" });
    expect(first.outreach.status).toBe("sent");
    expect(first.outreach.packageVersion).toBe(1);

    // Same documents to another lender: same locked version, new share link.
    const second = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: other.id, items: [...docs(3)].reverse(), actor: "broker:ana" }));
    expect(second.pkg.id).toBe(first.pkg.id);

    // A new rent roll: version 2; version 1 stays exactly as the first lender saw it.
    const changed = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(4), actor: "broker:ana" }));
    expect(changed.pkg.version).toBe(2);
    const v1 = await store.getPackage(first.pkg.id);
    // Three documents and the deal summary.
    expect(v1!.manifest).toHaveLength(4);
    expect(v1!.manifestSha256).toBe(first.pkg.manifestSha256);
    await expect(store.lockPackage(first.pkg.id, "x", now())).rejects.toBeInstanceOf(GuardError);
    expect((await store.listPackages(deal.id)).map((p) => p.version)).toEqual([1, 2]);
  });

  it("goes through the approval gate with one idempotency key per lender and version, and sends once", async () => {
    const { store, gate, now, deal, lender } = await world();
    const m = mailer();
    const input = { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana" };
    await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2(input));
    await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2(input));
    expect(gate.requests).toHaveLength(1);
    expect(gate.requests[0]).toMatchObject({ kind: "lender_submission", idempotencyKey: outreachApprovalKey(deal.id, lender.id, 1), templateId: "lender_package_submission_v2" });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.to).toBe("dana@lender.example");
    expect(m.sent[0]!.text).toMatch(/is the broker on this request, not the lender/);
  });

  it("sends nothing and mints no link while approval is pending, rejected or expired", async () => {
    for (const status of ["pending", "rejected", "expired"] as const) {
      const { store, gate, now, deal, lender } = await world(status);
      const m = mailer();
      const r = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana" }));
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
    await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2(input));
    gate.decide(outreachApprovalKey(deal.id, lender.id, 1), { status: "approved", approvalId: "appr_1", decidedBy: "broker:lee", decidedAt: now() });
    const r = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2(input));
    expect(r.outreach).toMatchObject({ status: "sent", approvedBy: "broker:lee" });
    expect(m.sent).toHaveLength(1);
    expect(store.outreach.size).toBe(1);
  });

  it("without a mailer returns the share URL once and waits for the broker to mark it sent", async () => {
    const { store, gate, now, deal, lender } = await world();
    const r = await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" }));
    expect(r.outreach.status).toBe("approved");
    expect(r.shareUrl).toMatch(/^https:\/\/corincommercial\.com\/api\/deals\/share\/[A-Za-z0-9_-]{43}$/);
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
    await expect(sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: stale.id, items: docs(1), actor: "a" }))).rejects.toMatchObject({ reason: "stale_lender" });
    expect(gate.requests).toHaveLength(0);
    const ok = await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: stale.id, items: docs(1), actor: "a", allowStaleLender: true }));
    expect(ok.outreach.staleLenderOverride).toBe(true);
    expect(gate.requests[0]!.payload.staleLenderOverride).toBe(true);

    const cmbs = await store.insertLender(lenderInput({ name: "CMBS only", programs: ["HOTEL_CMBS"] }), "a", now());
    await expect(sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: cmbs.id, items: docs(1), actor: "a" }))).rejects.toMatchObject({ reason: "lender_program" });
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
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" }));
    const approval = (await service.getByKey(first.outreach.approvalKey))!;
    expect(approval.kind).toBe("lender_submission");
    const denied = await service.approve(approval.id, broker);
    expect(denied).toMatchObject({ ok: false, reason: "reauth_required" });
    const r = await checkOutreachApproval({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, first.outreach.id, "a");
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
    const first = await sendPackageToLender({ store: w.store, gate, now: w.now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.lender.id, items: docs(1), actor: "broker:ana" }));
    const pending = (await service.getByKey(first.outreach.approvalKey))!;
    await approvals.decide(pending.id, { status: "approved", decidedBy: broker.userId, decidedByLabel: broker.label, decidedByDre: broker.dreLicense, decisionReason: null }, w.now());
    expect((await service.get(pending.id))!.status).toBe("approved");

    const r = await checkOutreachApproval({ store: w.store, gate, now: w.now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, first.outreach.id, "a");
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
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana", note: "Rush, please" }));
    expect(first.outreach.status).toBe("pending_approval");
    expect(outreachMessage(first)).toMatch(/Check approval/);
    const approval = (await service.getByKey(first.outreach.approvalKey))!;
    expect(approval.summary).toContain("Note: Rush, please");
    expect(approval.payload).not.toHaveProperty("note");

    // Still pending: nothing changes.
    expect((await checkOutreachApproval({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, first.outreach.id, "a")).outreach.status).toBe("pending_approval");

    // A re-send with another note reuses the same approval instead of conflicting.
    const again = await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana", note: "Different note" }));
    expect(again.outreach.id).toBe(first.outreach.id);

    expect(await approve(approval.id)).toMatchObject({ ok: true });
    const packagesBefore = (await store.listPackages(deal.id)).length;
    const r = await checkOutreachApproval({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, first.outreach.id, "broker:ana");
    expect(r.outreach).toMatchObject({ status: "approved", approvalId: approval.id });
    expect(r.shareUrl).toMatch(/\/api\/deals\/share\//);
    expect((await store.listPackages(deal.id)).length).toBe(packagesBefore);
    expect(store.links.size).toBe(1);
    // Checking again does nothing more (the approval was used by the link).
    const later = await checkOutreachApproval({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, first.outreach.id, "broker:ana");
    expect(later.shareUrl).toBeUndefined();
    expect(store.links.size).toBe(1);
  });

  it("emails the lender on approval when a mailer is configured", async () => {
    const { store, gate, service, approve, now, deal, lender } = await queued();
    const m = mailer();
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" }));
    expect(await approve((await service.getByKey(first.outreach.approvalKey))!.id)).toMatchObject({ ok: true });
    const r = await checkOutreachApproval({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, first.outreach.id, "a");
    expect(r.outreach.status).toBe("sent");
    expect(m.sent).toHaveLength(1);
  });

  it("shows a rejected or expired approval on the submission", async () => {
    const { store, gate, service, now, clock, deal, lender, other } = await queued();
    const a = await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "a" }));
    await service.reject((await service.getByKey(a.outreach.approvalKey))!.id, broker, "Not this lender");
    const rejected = await checkOutreachApproval({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, a.outreach.id, "a");
    expect(rejected.outreach).toMatchObject({ status: "rejected", responseNote: "Not this lender" });
    expect(outreachMessage(rejected)).toMatch(/rejected/);

    const b = await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: other.id, items: docs(1), actor: "a" }));
    clock.advance(25 * 60 * 60 * 1000);
    const expired = await checkOutreachApproval({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, b.outreach.id, "a");
    expect(expired.outreach.status).toBe("expired");
    expect(store.links.size).toBe(0);
  });

  it("explains a changed lender contact instead of failing generically", async () => {
    const { store, gate, now, deal, lender } = await queued();
    const a = await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "a" }));
    await store.updateLender(lender.id, { submissionEmail: "new@cambridge.example" }, "a", now());
    await expect(checkOutreachApproval({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, a.outreach.id, "a")).rejects.toThrow(/changed after approval was requested \(recipient, summary or email text\)/);
  });

  it("explains a changed primary contact email the same way", async () => {
    const { store, gate, now, deal, lender } = await queued();
    const dana = await addPrimaryContact(store, lender.id, { fullName: "Dana Lee", email: "dana.lee@cambridge.example" });
    const a = await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "a" }));
    await store.updateLenderContact(lender.id, dana.id, dana.recordVersion, { email: "dana@new-cambridge.example" }, "a", now());
    await expect(checkOutreachApproval({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, a.outreach.id, "a")).rejects.toThrow(/changed after approval was requested \(recipient, summary or email text\)/);
  });

  it("mails the primary contact the approved text (the greeting is the email builder's)", async () => {
    const { store, gate, service, approve, now, deal, lender } = await queued();
    await addPrimaryContact(store, lender.id, { fullName: "Dana Lee", email: "dana.lee@cambridge.example" });
    const m = mailer();
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" }));
    expect((await service.getByKey(first.outreach.approvalKey))!.payload).toMatchObject({ to: "dana.lee@cambridge.example" });
    await approve((await service.getByKey(first.outreach.approvalKey))!.id);
    await checkOutreachApproval({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, first.outreach.id, "a");
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.to).toBe("dana.lee@cambridge.example");
    expect(m.sent[0]!.text.startsWith(EMAIL_TEXT.split("{{")[0]!)).toBe(true);
    expect(m.sent[0]!.text).not.toContain("{{");
  });

  it("falls back to the submission inbox without a primary contact", async () => {
    const { store, gate, service, approve, now, deal, lender } = await queued();
    const m = mailer();
    const first = await sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" }));
    await approve((await service.getByKey(first.outreach.approvalKey))!.id);
    await checkOutreachApproval({ store, gate, now, baseUrl: base, mailer: m, holds: noHolds, summaries: anySummary }, first.outreach.id, "a");
    expect(m.sent[0]!.to).toBe("dana@lender.example");
  });
});

describe("share links", () => {
  async function linked() {
    const w = await world();
    const r = await sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.lender.id, items: docs(2), actor: "broker:ana", ttlDays: 7 }));
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

    await sendPackageToLender({ store, gate, now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(3), actor: "broker:ana" }));
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
    const r = await sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, holds: noHolds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.lender.id, items: docs(1), actor: "a", ttlDays: 365 }));
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

describe("sanctions holds and settled deals", () => {
  async function held() {
    const w = await world();
    const holds = new MemoryDealHoldStore();
    const placeHold = async (reason: "sanctions_potential_match" | "sanctions_confirmed_match" = "sanctions_potential_match") => {
      await holds.open({ dealId: w.deal.id, reason, sourceKind: "screening", sourceId: `scr-${reason}`, detail: `OFAC ${reason} for Pat Owner`, createdBy: "system:screening" }, w.now());
      return syncDealHoldStatus({ store: w.store, holds, now: w.now }, w.deal.id);
    };
    return { ...w, holds, placeHold };
  }

  it("refuses to submit an on_hold or held_for_counsel deal: nothing locked, no approval asked, no link", async () => {
    for (const reason of ["sanctions_potential_match", "sanctions_confirmed_match"] as const) {
      const { store, gate, now, deal, lender, holds, placeHold } = await held();
      expect(await placeHold(reason)).toBe(reason === "sanctions_potential_match" ? "on_hold" : "held_for_counsel");
      const m = mailer();
      await expect(sendPackageToLender({ store, gate, now, baseUrl: base, mailer: m, holds, summaries: anySummary }, v2({ dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "broker:ana" }))).rejects.toMatchObject({ reason: "deal_held" });
      expect(await store.listPackages(deal.id)).toHaveLength(0);
      expect(gate.requests).toHaveLength(0);
      expect(store.links.size).toBe(0);
      expect(m.sent).toHaveLength(0);
    }
  });

  it("refuses when a hold is open even though deals.status was not updated, and fails closed when holds cannot be read", async () => {
    const { store, gate, now, deal, lender, holds } = await held();
    await holds.open({ dealId: deal.id, reason: "sanctions_potential_match", sourceKind: "screening", sourceId: "scr-1", detail: "Possible OFAC match", createdBy: "system:screening" }, now());
    expect((await store.getDeal(deal.id))!.status).toBe("active");
    const input = { dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "broker:ana" };
    await expect(sendPackageToLender({ store, gate, now, baseUrl: base, holds, summaries: anySummary }, v2(input))).rejects.toThrow(/Possible OFAC match/);
    await expect(sendPackageToLender({ store, gate, now, baseUrl: base, holds: null, summaries: anySummary }, v2(input))).rejects.toMatchObject({ reason: "deal_held" });
    const broken = { active: async () => Promise.reject(new Error("db down")) };
    await expect(sendPackageToLender({ store, gate, now, baseUrl: base, holds: broken, summaries: anySummary }, v2(input))).rejects.toMatchObject({ reason: "deal_held" });
    expect(gate.requests).toHaveLength(0);
    expect(store.links.size).toBe(0);
  });

  it("an approval that comes back after a hold was placed mints no link and sends nothing", async () => {
    const w = await held();
    const key = outreachApprovalKey(w.deal.id, w.lender.id, 1);
    w.gate.decide(key, { status: "pending", approvalId: "appr_1" });
    const m = mailer();
    const first = await sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, mailer: m, holds: w.holds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.lender.id, items: docs(1), actor: "broker:ana" }));
    expect(first.outreach.status).toBe("pending_approval");
    await w.placeHold();
    w.gate.decide(key, { status: "approved", approvalId: "appr_1", decidedBy: "broker@test", decidedAt: w.now() });
    await expect(checkOutreachApproval({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, mailer: m, holds: w.holds, summaries: anySummary }, first.outreach.id, "broker:ana")).rejects.toMatchObject({ reason: "deal_held" });
    expect(w.store.links.size).toBe(0);
    expect(m.sent).toHaveLength(0);
  });

  it("re-checks holds right before minting the link (hold placed while the approval was decided)", async () => {
    const w = await held();
    const gate = {
      peek: w.gate.peek.bind(w.gate),
      request: async (action: Parameters<typeof w.gate.request>[0]) => {
        await w.placeHold();
        return w.gate.request(action);
      },
    };
    const m = mailer();
    await expect(sendPackageToLender({ store: w.store, gate, now: w.now, baseUrl: base, mailer: m, holds: w.holds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.lender.id, items: docs(1), actor: "broker:ana" }))).rejects.toMatchObject({ reason: "deal_held" });
    expect(w.store.links.size).toBe(0);
    expect(m.sent).toHaveLength(0);
  });

  it("an existing share link stops resolving once a hold is placed", async () => {
    const w = await held();
    const r = await sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, holds: w.holds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.lender.id, items: docs(2), actor: "broker:ana" }));
    const token = r.shareUrl!.split("/").pop()!;
    expect((await resolveShareLink(w.store, token, w.now())).status).toBe("ok");
    await w.placeHold();
    const link = w.store.links.get(r.outreach.shareLinkId!)!;
    expect(link.revokedBy).toBe("system:screening");
    expect(link.revokedAt).not.toBeNull();
    expect((await resolveShareLink(w.store, token, w.now())).status).toBe("revoked");
    expect(w.store.links.get(r.outreach.shareLinkId!)!.accessCount).toBe(1);
  });

  it("a live link on a deal that is not active serves nothing even before it is revoked", async () => {
    const w = await held();
    const r = await sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, holds: w.holds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.lender.id, items: docs(1), actor: "broker:ana" }));
    const token = r.shareUrl!.split("/").pop()!;
    const deal = (await w.store.getDeal(w.deal.id))!;
    await w.store.updateDeal(deal.id, deal.recordVersion, { status: "held_for_counsel" }, "system:screening", w.now());
    expect((await resolveShareLink(w.store, token, w.now())).status).toBe("not_found");
    expect(w.store.links.get(r.outreach.shareLinkId!)!.accessCount).toBe(0);
  });

  it("withdrawing or losing the deal revokes its live share links", async () => {
    for (const event of ["withdraw", "mark_lost"]) {
      const w = await held();
      const r = await sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, holds: w.holds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.lender.id, items: docs(1), actor: "broker:ana" }));
      const token = r.shareUrl!.split("/").pop()!;
      const adv = await advanceDeal({ store: w.store, disclosures: null, now: w.now, checklist: null }, { dealId: w.deal.id, event, actor: "broker:ana" });
      expect(adv.ok).toBe(true);
      expect(w.store.links.get(r.outreach.shareLinkId!)!.revokedAt).not.toBeNull();
      expect((await resolveShareLink(w.store, token, w.now())).status).toBe("revoked");
      await expect(sendPackageToLender({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, holds: w.holds, summaries: anySummary }, v2({ dealId: w.deal.id, lenderId: w.other.id, items: docs(1), actor: "broker:ana" }))).rejects.toMatchObject({ reason: "deal_closed" });
    }
  });
});

// ---------------------------------------------------------------------------
// The lender-ready submission gate (spec 5.2 and 7.1)

describe("submission gate (v2)", () => {
  const broker = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };

  async function gated(gateDefault: "approved" | "pending" = "approved") {
    const w = await world(gateDefault);
    const summaries = summaryStore([summaryRecord(w.deal.id)]);
    const items = [...docs(2), dealSummaryPackageItem(w.deal.id, PDF_SHA)];
    const deps = (over: Partial<Parameters<typeof sendPackageToLender>[0]> = {}) => ({ store: w.store, gate: w.gate, now: w.now, baseUrl: base, holds: noHolds, summaries, ...over });
    return { ...w, summaries, items, deps };
  }

  const missing = ["docs.t12", "docs.rent_roll"];

  it("refuses not_ready without a reason: nothing locked, no gate called", async () => {
    const { store, gate, deal, lender, items, deps } = await gated();
    const err = await sendPackageToLender(deps(), { dealId: deal.id, lenderId: lender.id, items, actor: "broker:ana", submission: submission(lender.id, { readiness: { missing, hardStops: [], score: 80 } }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PackageError);
    expect(err).toMatchObject({ reason: "not_ready" });
    expect((err as Error).message).toBe("2 required items are missing for a term-sheet request: T-12 operating statement; Rent roll, census or STR report. Add them or give a reason to send anyway.");
    await expect(sendPackageToLender(deps(), { dealId: deal.id, lenderId: lender.id, items, actor: "a", submission: submission(lender.id, { readiness: { missing, hardStops: [], score: 80 }, overrideReason: "too short" }) })).rejects.toMatchObject({ reason: "not_ready" });
    expect(await store.listPackages(deal.id)).toEqual([]);
    expect(gate.requests).toHaveLength(0);
    expect(store.outreach.size).toBe(0);
  });

  it("with a reason, asks for the v2 approval and the summary and payload carry the missing items and the reason", async () => {
    const { store, gate, deal, lender, items, deps } = await gated("pending");
    const reason = "Lender asked to see the deal before the T-12 is final";
    const r = await sendPackageToLender(deps(), {
      dealId: deal.id,
      lenderId: lender.id,
      items,
      actor: "broker:ana",
      note: "Rush",
      submission: submission(lender.id, { readiness: { missing, hardStops: [], score: 80 }, overrideReason: `  ${reason}  `, fit: { ...submission(lender.id).fit, exceptions: ["LTV 75% vs 70% maximum"] } }),
    });
    expect(r.outreach.status).toBe("pending_approval");
    const req = gate.requests[0]!;
    expect(req.templateId).toBe(LENDER_SUBMISSION_TEMPLATE_ID_V2);
    expect(req.summary).toBe(
      `Send "Sunrise Assisted Living refi" (HUD 232 senior housing, term-sheet request) package v1 to Cambridge Realty Capital: $12,500,000, LTV 75%, DSCR 1.33x. Missing: T-12 operating statement; Rent roll, census or STR report — reason: ${reason}. Lender fit exceptions: LTV 75% vs 70% maximum. Note: Rush`,
    );
    expect(req.payload).toMatchObject({ targetStage: "term_sheet", summarySha256: "a".repeat(64), emailSha256: emailSha256("Loan request: $12,500,000 HUD 232 | Corin Commercial", EMAIL_TEXT), readinessMissing: missing, overrideReason: reason, manifestSha256: r.pkg.manifestSha256 });
    // The submission record is on the row.
    const row = (await store.getOutreach(r.outreach.id))!;
    expect(row).toMatchObject({ targetStage: "term_sheet", summaryId: "summary-1", readinessMissing: missing, readinessOverrideReason: reason, emailText: EMAIL_TEXT, emailSha256: emailSha256("Loan request: $12,500,000 HUD 232 | Corin Commercial", EMAIL_TEXT), emailSubject: "Loan request: $12,500,000 HUD 232 | Corin Commercial" });
    expect(row.lenderFit?.exceptions).toEqual(["LTV 75% vs 70% maximum"]);
  });

  it("holds and a closed deal still win over an override reason", async () => {
    const { store, gate, deal, lender, items, deps } = await gated();
    const input = { dealId: deal.id, lenderId: lender.id, items, actor: "broker:ana", submission: submission(lender.id, { readiness: { missing, hardStops: [], score: 80 }, overrideReason: "Lender asked to see the deal before the T-12 is final" }) };
    const held = { active: async () => [{ detail: "Possible OFAC match for a principal" }] };
    await expect(sendPackageToLender(deps({ holds: held }), input)).rejects.toMatchObject({ reason: "deal_held" });
    await expect(sendPackageToLender(deps(), { ...input, submission: { ...input.submission, readiness: { ...input.submission.readiness, hardStops: ["On hold: OFAC"] } } })).rejects.toMatchObject({ reason: "deal_held" });
    const d = (await store.getDeal(deal.id))!;
    await store.updateDeal(d.id, d.recordVersion, { status: "withdrawn" }, "a", new Date());
    await expect(sendPackageToLender(deps(), input)).rejects.toMatchObject({ reason: "deal_closed" });
    expect(await store.listPackages(deal.id)).toEqual([]);
    expect(gate.requests).toHaveLength(0);
  });

  it("refuses an unsafe email or one that does not match its hash", async () => {
    const { gate, deal, lender, items, deps } = await gated();
    const send = (email: SubmissionSendInput["email"]) => sendPackageToLender(deps(), { dealId: deal.id, lenderId: lender.id, items, actor: "a", submission: submission(lender.id, { email }) });
    const bad = `${EMAIL_TEXT}Guarantor SSN 123-45-6789\n`;
    await expect(send({ subject: "Loan request", text: bad, sha256: emailSha256("Loan request", bad) })).rejects.toMatchObject({ reason: "email_unsafe" });
    await expect(send({ subject: "Loan request", text: EMAIL_TEXT, sha256: "0".repeat(64) })).rejects.toMatchObject({ reason: "email_unsafe" });
    const noLink = "Hello, no link here.";
    await expect(send({ subject: "Loan request", text: noLink, sha256: emailSha256("Loan request", noLink) })).rejects.toMatchObject({ reason: "email_unsafe" });
    await expect(send({ subject: "Line one\nline two", text: EMAIL_TEXT, sha256: emailSha256("Line one\nline two", EMAIL_TEXT) })).rejects.toMatchObject({ reason: "email_unsafe" });
    expect(gate.requests).toHaveLength(0);
  });

  it("refuses a missing, foreign or unpackaged summary, and fails closed without a summary store", async () => {
    const { gate, deal, lender, items, deps, summaries } = await gated();
    const input = { dealId: deal.id, lenderId: lender.id, items, actor: "a", submission: submission(lender.id) };
    await expect(sendPackageToLender(deps({ summaries: null }), input)).rejects.toMatchObject({ reason: "summary_missing" });
    await expect(sendPackageToLender(deps(), { ...input, submission: submission(lender.id, { summaryId: "nope" }) })).rejects.toMatchObject({ reason: "summary_missing" });
    await expect(sendPackageToLender(deps(), { ...input, items: docs(2) })).rejects.toThrow(/not in the package/);
    await expect(sendPackageToLender(deps(), { ...input, submission: submission(lender.id, { targetStage: "screen" }) })).rejects.toThrow(/built for a term-sheet request/);
    summaries.rows.set("summary-1", summaryRecord("another-deal"));
    await expect(sendPackageToLender(deps(), input)).rejects.toMatchObject({ reason: "summary_missing" });
    expect(gate.requests).toHaveLength(0);
  });

  it("with no mailer, emails nothing and returns the share URL and the approved email with the link filled in", async () => {
    const { store, deal, lender, items, deps } = await gated();
    const r = await sendPackageToLender(deps({ mailer: null }), { dealId: deal.id, lenderId: lender.id, items, actor: "broker:ana", ttlDays: 7, submission: submission(lender.id) });
    expect(r.outreach.status).toBe("approved");
    expect(r.shareUrl).toMatch(/^https:\/\/corincommercial\.com\/api\/deals\/share\/[A-Za-z0-9_-]{43}$/);
    const link = store.links.get(r.outreach.shareLinkId!)!;
    expect(r.email).toEqual({ subject: "Loan request: $12,500,000 HUD 232 | Corin Commercial", text: fillEmailPlaceholders(EMAIL_TEXT, { shareUrl: r.shareUrl!, expiresAt: link.expiresAt }) });
    expect(r.email!.text).toContain(`${r.shareUrl}\n`);
    expect(r.email!.text).not.toContain("{{");
    expect(outreachMessage(r)).toMatch(/approved email are shown below once/);
    // The stored text keeps its placeholders: the approved bytes never change.
    expect((await store.getOutreach(r.outreach.id))!.emailText).toBe(EMAIL_TEXT);
  });

  it("hands the approved email back once for the outreach row its share URL belongs to, and to nobody else", async () => {
    const { store, deal, lender, other, items, deps } = await gated();
    const r = await sendPackageToLender(deps({ mailer: null }), { dealId: deal.id, lenderId: lender.id, items, actor: "broker:ana", submission: submission(lender.id) });
    const link = store.links.get(r.outreach.shareLinkId!)!;
    expect(await approvedEmailForShare(store, deal.id, r.outreach.id, r.shareUrl!)).toEqual({ lenderId: lender.id, subject: "Loan request: $12,500,000 HUD 232 | Corin Commercial", text: fillEmailPlaceholders(EMAIL_TEXT, { shareUrl: r.shareUrl!, expiresAt: link.expiresAt }) });
    // A share URL for another row, another deal, a missing row or a revoked link gives nothing.
    const second = await sendPackageToLender(deps({ mailer: null }), { dealId: deal.id, lenderId: other.id, items, actor: "broker:ana", submission: submission(other.id) });
    expect(await approvedEmailForShare(store, deal.id, r.outreach.id, second.shareUrl!)).toBeNull();
    expect(await approvedEmailForShare(store, "another-deal", r.outreach.id, r.shareUrl!)).toBeNull();
    expect(await approvedEmailForShare(store, deal.id, null, r.shareUrl!)).toBeNull();
    await store.revokeShareLink(link.id, "a", "test", new Date());
    expect(await approvedEmailForShare(store, deal.id, r.outreach.id, r.shareUrl!)).toBeNull();
  });

  it("with a mailer, sends the approved subject and text with the link filled in", async () => {
    const { store, deal, lender, items, deps } = await gated();
    const m = mailer();
    const r = await sendPackageToLender(deps({ mailer: m }), { dealId: deal.id, lenderId: lender.id, items, actor: "broker:ana", submission: submission(lender.id) });
    expect(r.outreach.status).toBe("sent");
    expect(m.sent).toHaveLength(1);
    const link = [...store.links.values()][0]!;
    expect(m.sent[0]!.text).toMatch(/Secure link \(expires [A-Z][a-z]+ \d{1,2}, \d{4}\):\nhttps:\/\/corincommercial\.com\/api\/deals\/share\/[A-Za-z0-9_-]{43}\n/);
    expect(m.sent[0]!.text).not.toContain("{{");
    expect(m.sent[0]!.text).toContain(fmt.date(link.expiresAt));
    expect(r.shareUrl).toBeUndefined();
  });

  it("re-checks a pending v2 submission with the stored payload, and words a changed email as a conflict", async () => {
    const w = await world();
    const proofs = new MemoryReauthStore();
    const service = new ApprovalService(new MemoryApprovalStore(), w.now, {}, proofs);
    const reauth = new ReauthService(proofs, w.now);
    const gate = queueApprovalGate(service);
    const summaries = summaryStore([summaryRecord(w.deal.id)]);
    const items = [...docs(2), dealSummaryPackageItem(w.deal.id, PDF_SHA)];
    const deps = { store: w.store, gate, now: w.now, baseUrl: base, holds: noHolds, summaries };
    const first = await sendPackageToLender(deps, { dealId: w.deal.id, lenderId: w.lender.id, items, actor: "broker:ana", submission: submission(w.lender.id) });
    expect(first.outreach.status).toBe("pending_approval");
    // Still pending: the re-check rebuilds the same payload from the row, so no conflict.
    expect((await checkOutreachApproval(deps, first.outreach.id, "broker:ana")).outreach.status).toBe("pending_approval");
    // The email changed after the request (a new contact name, an edited plan): conflict, reworded.
    const changed = `${EMAIL_TEXT}P.S. updated\n`;
    await expect(
      sendPackageToLender(deps, { dealId: w.deal.id, lenderId: w.lender.id, items, actor: "broker:ana", submission: submission(w.lender.id, { email: { subject: "Loan request", text: changed, sha256: emailSha256("Loan request", changed) } }) }),
    ).rejects.toThrow("The submission to Cambridge Realty Capital changed after approval was requested (recipient, summary or email text). Withdraw it and request approval again.");
    // The broker approves (with step-up); the re-check mints the link and hands over the approved text.
    const approval = (await service.getByKey(first.outreach.approvalKey))!;
    expect(approval.templateId).toBe(LENDER_SUBMISSION_TEMPLATE_ID_V2);
    await reauth.record({ approval, user: { userId: broker.userId, dreLicense: broker.dreLicense }, factor: { method: "totp", verifiedAt: w.now() } });
    expect(await service.approve(approval.id, broker)).toMatchObject({ ok: true });
    const r = await checkOutreachApproval(deps, first.outreach.id, "broker:ana");
    expect(r.outreach.status).toBe("approved");
    expect(r.email?.text).toContain(r.shareUrl!);
    // A v2 row cannot be re-checked without the summary store.
    const pending = await sendPackageToLender(deps, { dealId: w.deal.id, lenderId: w.other.id, items, actor: "broker:ana", submission: submission(w.other.id) });
    await expect(checkOutreachApproval({ ...deps, summaries: null }, pending.outreach.id, "a")).rejects.toMatchObject({ reason: "summary_missing" });
  });

  it("re-checks a v1 row (requested before the lender-ready flow, no email hash) on the v1 payload", async () => {
    const { store, gate, now, deal, lender, deps } = await gated("pending");
    // Only rows already pending under the v1 template can exist without a submission: seed one.
    const { pkg } = await lockPackageVersion(store, deal.id, docs(1), "a", now());
    const key = outreachApprovalKey(deal.id, lender.id, pkg.version);
    const row = await store.insertOutreach(
      { dealId: deal.id, lenderId: lender.id, packageId: pkg.id, packageVersion: pkg.version, approvalKey: key, requestedBy: "a", staleLenderOverride: false, status: "pending_approval", approvalId: null, approvedBy: null, shareLinkId: null, sentAt: null, externalMessageId: null, responseNote: null, termSheetRef: null },
      now(),
    );
    await checkOutreachApproval(deps(), row.id, "a");
    expect(gate.requests[0]!.templateId).toBe(LENDER_SUBMISSION_TEMPLATE_ID);
    expect(gate.requests[0]!.payload).not.toHaveProperty("emailSha256");
    expect(gate.requests[0]!.payload).toMatchObject({ dealId: deal.id, lenderId: lender.id, packageVersion: pkg.version, manifestSha256: pkg.manifestSha256 });
    expect((await store.getOutreach(row.id))!.emailText).toBeUndefined();
  });

  it("a send without a submission is refused before anything is locked (no send skips the readiness gate)", async () => {
    const { store, gate, deal, lender, deps } = await gated();
    const bare = { dealId: deal.id, lenderId: lender.id, items: docs(1), actor: "a" } as unknown as SendPackageInput;
    await expect(sendPackageToLender(deps(), bare)).rejects.toMatchObject({ reason: "not_ready" });
    expect(await store.listPackages(deal.id)).toEqual([]);
    expect(gate.requests).toHaveLength(0);
  });

  it("shows the approving broker any fair-lending copy flag in the email", async () => {
    const { gate, deal, lender, items, deps } = await gated("pending");
    const text = EMAIL_TEXT.replace("not the lender.", "not the lender. The owner and his wife run the business.");
    await sendPackageToLender(deps(), { dealId: deal.id, lenderId: lender.id, items, actor: "a", submission: submission(lender.id, { email: { subject: "Loan request", text, sha256: emailSha256("Loan request", text) } }) });
    expect(gate.requests[0]!.summary).toContain('Fair-lending copy flags: "wife" (sex or gender).');
    expect(gate.requests[0]!.summary.length).toBeLessThanOrEqual(500);
  });
});
