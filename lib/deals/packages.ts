// Loan packages and lender outreach. A package version is a manifest of vault
// documents (path + SHA-256). Sending to a lender locks the version — it can
// never change afterwards, so what the lender saw is provable — and the
// submission goes through the broker approval gate (Global rule 2). Only after
// approval is a share link minted for that lender and that version.

import { createHash } from "node:crypto";
import { z } from "zod";
import { isApproved, type ApprovalDecision, type ApprovalGate } from "@/lib/compliance/approval-gate";
import type { DealHold } from "@/lib/screening/store";
import { lenderStaleness } from "./lenders";
import { createShareLink, dealAcceptsLenderAccess, shareLinkUrl } from "./share-links";
import type { DealDeskStore } from "./store";
import type { Clock, Deal, DealPackage, LenderOutreach, LenderPanelEntry, PackageItem } from "./types";

export const LENDER_SUBMISSION_TEMPLATE_ID = "lender_package_submission_v1";

const itemSchema = z.object({
  documentId: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(60),
  storagePath: z.string().trim().min(1).max(500),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
});

export class PackageError extends Error {
  constructor(
    readonly reason: "empty" | "invalid" | "deal_not_found" | "deal_closed" | "deal_held" | "lender_not_found" | "lender_inactive" | "lender_program" | "stale_lender" | "no_contact" | "invalid_status",
    message: string,
  ) {
    super(message);
    this.name = "PackageError";
  }
}

/** Validated manifest in canonical order (by document id). */
export function canonicalManifest(items: PackageItem[]): PackageItem[] {
  if (!items.length) throw new PackageError("empty", "A package needs at least one document");
  const parsed = z.array(itemSchema).safeParse(items);
  if (!parsed.success) throw new PackageError("invalid", parsed.error.issues.map((i) => i.message).join("; "));
  const ids = new Set<string>();
  for (const i of parsed.data) {
    if (ids.has(i.documentId)) throw new PackageError("invalid", `Document ${i.documentId} appears twice`);
    ids.add(i.documentId);
  }
  return [...parsed.data].sort((a, b) => a.documentId.localeCompare(b.documentId));
}

export function manifestDigest(items: PackageItem[]): string {
  const canonical = canonicalManifest(items).map((i) => [i.documentId, i.kind, i.storagePath, i.sha256, i.label]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * The locked version for exactly these documents: reuses the latest locked
 * version when its manifest is identical, otherwise locks a new version.
 */
export async function lockPackageVersion(store: DealDeskStore, dealId: string, items: PackageItem[], actor: string, now: Date): Promise<{ pkg: DealPackage; created: boolean }> {
  const manifest = canonicalManifest(items);
  const digest = manifestDigest(manifest);
  const versions = await store.listPackages(dealId);
  const sameLocked = [...versions].reverse().find((p) => p.status === "locked" && p.manifestSha256 === digest);
  const latest = versions.at(-1);
  if (sameLocked && sameLocked.version === latest?.version) return { pkg: sameLocked, created: false };
  if (latest && latest.status === "draft" && latest.manifestSha256 === digest) return { pkg: await store.lockPackage(latest.id, actor, now), created: false };
  const pkg = await store.insertPackage(
    { dealId, version: (latest?.version ?? 0) + 1, status: "locked", manifest, manifestSha256: digest, lockedAt: now.toISOString(), lockedBy: actor },
    now,
  );
  return { pkg, created: true };
}

// ---------------------------------------------------------------------------
// Outreach

/** Delivers the approved submission (WS-J transactional email client, lib/deals/mailer.ts). */
export interface LenderMailer {
  send(msg: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }>;
}

export type SendPackageInput = {
  dealId: string;
  lenderId: string;
  items: PackageItem[];
  actor: string;
  ttlDays?: number;
  /** Staff acknowledged the lender's verification is stale. */
  allowStaleLender?: boolean;
  note?: string;
};

export type SendPackageResult = {
  outreach: LenderOutreach;
  pkg: DealPackage;
  /** Present once, when a share link was minted and not emailed (copy it now). */
  shareUrl?: string;
};

export function outreachApprovalKey(dealId: string, lenderId: string, version: number): string {
  return `lender_submission:${dealId}:${lenderId}:v${version}`;
}

/** Reads the deal's open sanctions holds (WS-U deal_holds). */
export type DealHoldReader = { active(dealId: string): Promise<Pick<DealHold, "detail">[]> };

export type OutreachDeps = {
  store: DealDeskStore;
  gate: ApprovalGate;
  now: Clock;
  baseUrl: string;
  mailer?: LenderMailer | null;
  /**
   * Open sanctions holds for the deal (WS-U). null = the checklist and
   * screening desk is not configured, which fails closed: nothing is sent.
   */
  holds: DealHoldReader | null;
};

/**
 * Refuses a lender submission (or minting its share link) unless the deal is
 * open and active: not closed / withdrawn / lost, not on_hold or
 * held_for_counsel, and with no open sanctions hold. Fails closed when the
 * holds cannot be read.
 */
export async function assertDealCanGoToLenders(deps: Pick<OutreachDeps, "holds">, deal: Deal): Promise<void> {
  const status = deal.status ?? "active";
  if (status === "on_hold" || status === "held_for_counsel") {
    throw new PackageError("deal_held", `The deal is ${status.replace(/_/g, " ")}; nothing goes to lenders until the hold is released.`);
  }
  if (!dealAcceptsLenderAccess(deal)) throw new PackageError("deal_closed", `Deal is ${status === "active" ? deal.stage : status}`);
  if (!deps.holds) throw new PackageError("deal_held", "Sanctions holds cannot be checked because the checklist and screening desk is not configured; nothing was sent.");
  let holds: Pick<DealHold, "detail">[];
  try {
    holds = await deps.holds.active(deal.id);
  } catch (err) {
    console.error("[deals] hold lookup failed", err instanceof Error ? err.message : err);
    throw new PackageError("deal_held", "Sanctions holds could not be checked; nothing was sent. Try again.");
  }
  if (holds.length) throw new PackageError("deal_held", `On hold: ${holds.map((h) => h.detail).join("; ")}. Nothing goes to lenders until the hold is released.`);
}

export async function sendPackageToLender(deps: OutreachDeps, input: SendPackageInput): Promise<SendPackageResult> {
  const { store } = deps;
  const deal = await store.getDeal(input.dealId);
  if (!deal) throw new PackageError("deal_not_found", `Deal ${input.dealId} not found`);
  await assertDealCanGoToLenders(deps, deal);
  const lender = await store.getLender(input.lenderId);
  if (!lender) throw new PackageError("lender_not_found", `Lender ${input.lenderId} not found`);
  if (!lender.active) throw new PackageError("lender_inactive", `${lender.name} is inactive on the panel`);
  if (!lender.programs.includes(deal.program)) throw new PackageError("lender_program", `${lender.name} has no recorded appetite for this program`);
  const now = deps.now();
  const staleness = lenderStaleness(lender, now);
  if (staleness.stale && !input.allowStaleLender) throw new PackageError("stale_lender", `${lender.name}: ${staleness.reason} Re-verify or acknowledge before sending.`);

  const { pkg } = await lockPackageVersion(store, deal.id, input.items, input.actor, now);
  const approvalKey = outreachApprovalKey(deal.id, lender.id, pkg.version);
  const outreach = await store.getOutreachByKey(approvalKey);
  if (outreach && ["approved", "sent", "declined", "term_sheet", "withdrawn"].includes(outreach.status)) return { outreach, pkg };
  return decideOutreach(deps, { deal, lender, pkg, outreach, staleLenderOverride: outreach?.staleLenderOverride ?? staleness.stale, note: input.note, ttlDays: input.ttlDays, actor: input.actor });
}

/**
 * Re-runs the broker decision for a submission waiting on approval (same
 * approval key, same locked package; the manifest is not rebuilt). Approved →
 * share link minted (and emailed when a mailer is configured); rejected or
 * expired → the submission shows it.
 */
export async function checkOutreachApproval(deps: OutreachDeps, outreachId: string, actor: string, opts: { ttlDays?: number } = {}): Promise<SendPackageResult> {
  const { store } = deps;
  const outreach = await findOutreach(store, outreachId);
  const pkg = await store.getPackage(outreach.packageId);
  if (!pkg) throw new PackageError("invalid_status", "The locked package for this submission is missing");
  if (outreach.status !== "pending_approval") return { outreach, pkg };
  const [deal, lender] = await Promise.all([store.getDeal(outreach.dealId), store.getLender(outreach.lenderId)]);
  if (!deal) throw new PackageError("deal_not_found", `Deal ${outreach.dealId} not found`);
  if (!lender) throw new PackageError("lender_not_found", `Lender ${outreach.lenderId} not found`);
  // A hold placed (or the deal closed) after the submission was queued stops it here.
  await assertDealCanGoToLenders(deps, deal);
  return decideOutreach(deps, { deal, lender, pkg, outreach, staleLenderOverride: outreach.staleLenderOverride, ttlDays: opts.ttlDays, actor });
}

async function decideOutreach(
  deps: OutreachDeps,
  input: { deal: Deal; lender: LenderPanelEntry; pkg: DealPackage; outreach: LenderOutreach | null; staleLenderOverride: boolean; note?: string | null; ttlDays?: number; actor: string },
): Promise<SendPackageResult> {
  const { store } = deps;
  const { deal, lender, pkg } = input;
  let outreach = input.outreach;
  const now = deps.now();
  const approvalKey = outreachApprovalKey(deal.id, lender.id, pkg.version);
  const note = input.note?.trim();

  let decision: ApprovalDecision;
  try {
    decision = await deps.gate.request({
      // Sensitive: the approving broker re-authenticates (lib/agents/core/reauth.ts),
      // and the gate refuses to hand out "approved" without that proof.
      kind: "lender_submission",
      idempotencyKey: approvalKey,
      // The staff note is shown to the approving broker but is not part of the
      // hashed payload, so re-checking (or re-sending with another note) never conflicts.
      summary: `Send "${deal.title}" package v${pkg.version} (${pkg.manifest.length} document${pkg.manifest.length === 1 ? "" : "s"}) to ${lender.name}${note ? ` — note: ${note.slice(0, 200)}` : ""}`,
      templateId: LENDER_SUBMISSION_TEMPLATE_ID,
      payload: {
        dealId: deal.id,
        lenderId: lender.id,
        packageId: pkg.id,
        packageVersion: pkg.version,
        manifestSha256: pkg.manifestSha256,
        // The derived submission recipient (lib/deals/lender-contacts.ts deriveLenderContacts):
        // the primary contact's email, else the lender's submission inbox. Changing either
        // after the request changes this hash, which surfaces as "contact email changed".
        to: lender.contactEmail,
        staleLenderOverride: input.staleLenderOverride,
      },
      requestedBy: input.actor,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "ApprovalConflictError") {
      throw new PackageError(
        "invalid_status",
        `${lender.name}'s contact email changed after approval was requested for package v${pkg.version}. Withdraw this submission and send the package again so a broker approves the new recipient.`,
      );
    }
    throw err;
  }

  const base = {
    dealId: deal.id,
    lenderId: lender.id,
    packageId: pkg.id,
    packageVersion: pkg.version,
    approvalKey,
    requestedBy: input.actor,
    staleLenderOverride: input.staleLenderOverride,
  };
  if (!isApproved(decision)) {
    // A used-up approval ("already_executed") cannot send again: show it as rejected.
    const status = decision.status === "pending" ? "pending_approval" : decision.status;
    const approvalId = "approvalId" in decision ? (decision.approvalId ?? null) : null;
    const responseNote = decision.status === "rejected" && decision.reason ? decision.reason.slice(0, 500) : null;
    outreach = outreach
      ? await store.updateOutreach(outreach.id, { status, approvalId, ...(responseNote ? { responseNote } : {}) }, input.actor, now)
      : await store.insertOutreach(
          { ...base, status, approvalId, approvedBy: null, shareLinkId: null, sentAt: null, externalMessageId: null, responseNote, termSheetRef: null },
          now,
        );
    return { outreach, pkg };
  }

  // Re-read the deal and its holds right before the link exists: the approval
  // may have come back after a hold was placed or the deal closed.
  const current = await store.getDeal(deal.id);
  if (!current) throw new PackageError("deal_not_found", `Deal ${deal.id} not found`);
  await assertDealCanGoToLenders(deps, current);
  const { token, link } = await createShareLink(store, { pkg, lenderId: lender.id, createdBy: input.actor, ttlDays: input.ttlDays, now });
  const url = shareLinkUrl(deps.baseUrl, token);
  const approved = { status: "approved" as const, approvalId: decision.approvalId, approvedBy: decision.decidedBy, shareLinkId: link.id };
  outreach = outreach
    ? await store.updateOutreach(outreach.id, approved, input.actor, now)
    : await store.insertOutreach({ ...base, ...approved, sentAt: null, externalMessageId: null, responseNote: null, termSheetRef: null }, now);

  if (deps.mailer && lender.contactEmail) {
    const { messageId } = await deps.mailer.send({
      to: lender.contactEmail,
      subject: `Corin Commercial · ${deal.title} · package v${pkg.version}`,
      text: [
        `${lender.contactName ? `${lender.contactName},` : "Hello,"}`,
        "",
        `Corin Commercial, Inc. (broker, not the lender) is submitting "${deal.title}" for your review.`,
        `Package version ${pkg.version} (${pkg.manifest.length} documents) is available until ${new Date(link.expiresAt).toUTCString()}:`,
        url,
        "",
        "This link is for your institution only. Please do not forward it.",
      ].join("\n"),
      idempotencyKey: approvalKey,
    });
    outreach = await store.updateOutreach(outreach.id, { status: "sent", sentAt: now.toISOString(), externalMessageId: messageId }, input.actor, now);
    return { outreach, pkg };
  }
  return { outreach, pkg, shareUrl: url };
}

/** One line for staff describing a submission after a send or an approval check. */
export function outreachMessage(r: SendPackageResult): string {
  const v = `Package v${r.pkg.version}`;
  switch (r.outreach.status) {
    case "pending_approval":
      return `${v} locked; the submission is waiting for broker approval. Nothing was sent; use Check approval once a broker decides.`;
    case "approved":
      return r.shareUrl ? `${v} approved; the share link is shown below once. Send it from your mailbox, then click Mark sent.` : `${v} is approved; the share link was already shown. Mark it sent once delivered.`;
    case "sent":
      return `${v} sent to the lender.`;
    case "rejected":
      return `A broker rejected sending ${v}${r.outreach.responseNote ? ` (${r.outreach.responseNote})` : ""}; nothing was sent.`;
    case "expired":
      return `The approval for ${v} expired; nothing was sent. Withdraw it and send again to request a new approval.`;
    default:
      return `${v}: submission ${r.outreach.status.replace(/_/g, " ")}.`;
  }
}

/** The broker delivered an approved submission from their own mailbox. */
export async function markOutreachSent(store: DealDeskStore, outreachId: string, actor: string, now: Date, externalMessageId?: string): Promise<LenderOutreach> {
  const current = await findOutreach(store, outreachId);
  if (current.status !== "approved") throw new PackageError("invalid_status", `Only approved submissions can be marked sent (this one is ${current.status})`);
  return store.updateOutreach(current.id, { status: "sent", sentAt: now.toISOString(), externalMessageId: externalMessageId ?? null }, actor, now);
}

async function findOutreach(store: DealDeskStore, id: string): Promise<LenderOutreach> {
  const o = await store.getOutreach(id);
  if (!o) throw new PackageError("invalid_status", `Outreach ${id} not found`);
  return o;
}

export async function recordLenderResponse(
  store: DealDeskStore,
  outreachId: string,
  response: { status: "declined" | "term_sheet"; note?: string; termSheetRef?: string },
  actor: string,
  now: Date,
): Promise<LenderOutreach> {
  const o = await findOutreach(store, outreachId);
  if (!["sent", "declined", "term_sheet"].includes(o.status)) throw new PackageError("invalid_status", "Record a response only on a sent submission");
  if (response.status === "term_sheet" && !response.termSheetRef) throw new PackageError("invalid", "Attach the term sheet's vault reference");
  return store.updateOutreach(o.id, { status: response.status, responseNote: response.note ?? null, termSheetRef: response.termSheetRef ?? o.termSheetRef }, actor, now);
}

/** Withdraw a submission: revoke its share link so the lender loses access. */
export async function withdrawOutreach(store: DealDeskStore, outreachId: string, reason: string, actor: string, now: Date): Promise<LenderOutreach> {
  const o = await findOutreach(store, outreachId);
  if (o.shareLinkId) {
    const links = await store.listShareLinks(o.dealId);
    const link = links.find((l) => l.id === o.shareLinkId);
    if (link && !link.revokedAt) await store.revokeShareLink(link.id, actor, reason, now);
  }
  return store.updateOutreach(o.id, { status: "withdrawn", responseNote: reason }, actor, now);
}
