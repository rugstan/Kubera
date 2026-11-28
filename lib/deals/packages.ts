// Loan packages and lender outreach. A package version is a manifest of vault
// documents (path + SHA-256). Sending to a lender locks the version — it can
// never change afterwards, so what the lender saw is provable — and the
// submission goes through the broker approval gate (Global rule 2). Only after
// approval is a share link minted for that lender and that version.

import { createHash } from "node:crypto";
import { z } from "zod";
import { DEAL_SUMMARY_KIND } from "@/lib/agents/lenders/package";
import { isApproved, type ApprovalDecision, type ApprovalGate } from "@/lib/compliance/approval-gate";
import type { DealHold } from "@/lib/screening/store";
import { lenderStaleness } from "./lenders";
import { createShareLink, dealAcceptsLenderAccess, shareLinkUrl, tokenMatches } from "./share-links";
import type { DealDeskStore } from "./store";
import { emailSha256, fillEmailPlaceholders } from "./submission/email";
import { PLAYBOOK_LABELS } from "./submission/playbooks";
import { notReadyMessage } from "./submission/readiness";
import { checkNeutralCopy, findRestrictedText, restrictedTextMessage } from "./submission/redaction";
import { requirementLabel } from "./submission/requirements";
import { fmt } from "./submission/summary";
import { EMAIL_PLACEHOLDERS, OVERRIDE_REASON_LENGTH, SUBMISSION_TEXT_LIMITS, type DealSummaryRecord, type SubmissionSendInput, type SubmissionStore, type TargetStage } from "./submission/types";
import type { Clock, Deal, DealPackage, LenderOutreach, LenderPanelEntry, PackageItem } from "./types";

/** v1: documents only (submissions requested before the lender-ready flow keep this shape). */
export const LENDER_SUBMISSION_TEMPLATE_ID = "lender_package_submission_v1";
/** v2: the readiness gate, the locked deal summary and the exact email text (spec 5.2). */
export const LENDER_SUBMISSION_TEMPLATE_ID_V2 = "lender_package_submission_v2";

const itemSchema = z.object({
  documentId: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(60),
  storagePath: z.string().trim().min(1).max(500),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
});

export class PackageError extends Error {
  constructor(
    readonly reason:
      | "empty"
      | "invalid"
      | "deal_not_found"
      | "deal_closed"
      | "deal_held"
      | "lender_not_found"
      | "lender_inactive"
      | "lender_program"
      | "stale_lender"
      | "no_contact"
      | "invalid_status"
      /** Required items are missing at the target stage and no reason (20+ characters) was given. */
      | "not_ready"
      /** The email text failed the restricted-data check, its hash, its placeholders or its limits. */
      | "email_unsafe"
      /** The locked deal summary is missing, belongs to another deal or stage, or is not in the package. */
      | "summary_missing",
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
  /**
   * The lender-ready submission (spec 5.2): target stage, the locked summary,
   * readiness, the override reason, the lender fit and the exact email, built
   * by lib/deals/submission/send.ts prepareSubmission. Required: no send skips
   * the readiness gate. (Rows requested under the v1 documents-only template
   * before the lender-ready flow are only re-checked, by checkOutreachApproval.)
   */
  submission: SubmissionSendInput;
};

export type SendPackageResult = {
  outreach: LenderOutreach;
  pkg: DealPackage;
  /** Present once, when a share link was minted and not emailed (copy it now). */
  shareUrl?: string;
  /** With shareUrl, for a submission: the approved email with the link and its expiry filled in, for staff to send by hand. */
  email?: { subject: string; text: string };
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
  /** Locked deal summaries (deal_summaries): every send and every v2 re-check reads it; null fails closed with summary_missing. */
  summaries: Pick<SubmissionStore, "getSummary"> | null;
};

/** A submission that passed the gate: what is hashed into the approval and stored on lender_outreach. */
type CheckedSubmission = { send: SubmissionSendInput; summary: DealSummaryRecord; overrideReason: string | null };

const STAGE_REQUEST: Record<TargetStage, string> = { screen: "soft-quote", term_sheet: "term-sheet", underwrite: "underwriting" };

/** Missing ids as labels: the summary's open items when they line up with the ids, else the requirement table. */
function missingLabels(missing: readonly string[], summary: DealSummaryRecord | null): string[] {
  if (summary && summary.spec.openItems.length === missing.length) return [...summary.spec.openItems];
  return missing.map(requirementLabel);
}

/**
 * The readiness gate (spec 5.2), checked before anything is locked or any
 * approval is requested. Order: hard stops, then missing items without a
 * reason, then the email, then the summary. Holds and deal status are never
 * overridable.
 */
async function checkSubmission(deps: Pick<OutreachDeps, "summaries">, deal: Deal, lender: LenderPanelEntry, items: readonly PackageItem[], s: SubmissionSendInput): Promise<CheckedSubmission> {
  if (s.readiness.hardStops.length) throw new PackageError("deal_held", `${s.readiness.hardStops.join(" ")} A reason to send anyway does not lift a hold.`);
  if (s.fit.lenderId !== lender.id) throw new PackageError("invalid", `The lender fit was built for another lender, not ${lender.name}`);
  let summary: DealSummaryRecord | null = null;
  if (deps.summaries) {
    try {
      summary = await deps.summaries.getSummary(s.summaryId);
    } catch (err) {
      console.error("[deals] summary lookup failed", err instanceof Error ? err.message : err);
      throw new PackageError("summary_missing", "The deal summary could not be read; nothing was sent. Try again.");
    }
  }

  const reason = s.overrideReason?.trim() || null;
  if (s.readiness.missing.length) {
    if (!reason) throw new PackageError("not_ready", notReadyMessage(s.targetStage, missingLabels(s.readiness.missing, summary)));
    if (reason.length < OVERRIDE_REASON_LENGTH.min) throw new PackageError("not_ready", `The reason to send with items missing must be at least ${OVERRIDE_REASON_LENGTH.min} characters.`);
    if (reason.length > OVERRIDE_REASON_LENGTH.max) throw new PackageError("not_ready", `The reason to send with items missing must be at most ${OVERRIDE_REASON_LENGTH.max} characters.`);
  }

  const { subject, text, sha256 } = s.email;
  if (!subject.trim() || subject.length > SUBMISSION_TEXT_LIMITS.emailSubject || [...subject].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new PackageError("email_unsafe", "The email subject must be one line of at most 200 characters.");
  if (!text.trim() || text.length > SUBMISSION_TEXT_LIMITS.emailText) throw new PackageError("email_unsafe", "The email text is empty or longer than 20,000 characters.");
  if (emailSha256(text) !== sha256) throw new PackageError("email_unsafe", "The email text does not match its hash; build the preview again.");
  if (!text.includes(EMAIL_PLACEHOLDERS.shareLink)) throw new PackageError("email_unsafe", "The email has no place for the share link.");
  const findings = findRestrictedText(`${subject}\n${text}`);
  if (findings.length) throw new PackageError("email_unsafe", restrictedTextMessage(findings));

  if (!deps.summaries) throw new PackageError("summary_missing", "Deal summaries cannot be checked because the submission store is not configured; nothing was sent.");
  if (!summary || summary.dealId !== deal.id) throw new PackageError("summary_missing", "The locked deal summary for this submission was not found. Prepare the submission again.");
  if (summary.targetStage !== s.targetStage) throw new PackageError("summary_missing", `The deal summary was built for a ${STAGE_REQUEST[summary.targetStage]} request, not a ${STAGE_REQUEST[s.targetStage]} request.`);
  if (!items.some((i) => i.kind === DEAL_SUMMARY_KIND && i.sha256 === summary.pdfSha256)) throw new PackageError("summary_missing", "The deal summary PDF is not in the package; prepare the submission again.");
  return { send: s, summary, overrideReason: s.readiness.missing.length ? reason : null };
}

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
  // The type requires the submission; this keeps an untyped caller from skipping the readiness gate.
  if (!input.submission) throw new PackageError("not_ready", "Prepare the lender submission first: every send carries the readiness check, the locked deal summary and the approved email.");
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
  // The readiness gate runs before anything is locked or requested.
  const submission = await checkSubmission(deps, deal, lender, input.items, input.submission);

  const { pkg } = await lockPackageVersion(store, deal.id, input.items, input.actor, now);
  const approvalKey = outreachApprovalKey(deal.id, lender.id, pkg.version);
  const outreach = await store.getOutreachByKey(approvalKey);
  if (outreach && ["approved", "sent", "declined", "term_sheet", "withdrawn"].includes(outreach.status)) return { outreach, pkg };
  return decideOutreach(deps, { deal, lender, pkg, outreach, staleLenderOverride: outreach?.staleLenderOverride ?? staleness.stale, note: input.note, ttlDays: input.ttlDays, actor: input.actor, submission });
}

/** The submission stored on a lender_outreach row (v2), rebuilt for a re-check; null for a v1 row. */
async function storedSubmission(deps: Pick<OutreachDeps, "summaries">, outreach: LenderOutreach): Promise<CheckedSubmission | null> {
  if (!outreach.emailSha256 || !outreach.emailText || !outreach.emailSubject) return null;
  if (!deps.summaries || !outreach.summaryId || !outreach.targetStage || !outreach.lenderFit) throw new PackageError("summary_missing", "The submission's deal summary cannot be read; nothing was sent.");
  const summary = await deps.summaries.getSummary(outreach.summaryId);
  if (!summary || summary.dealId !== outreach.dealId) throw new PackageError("summary_missing", "The submission's locked deal summary was not found; nothing was sent.");
  const missing = outreach.readinessMissing ?? [];
  const reason = outreach.readinessOverrideReason ?? null;
  return {
    send: {
      targetStage: outreach.targetStage,
      summaryId: outreach.summaryId,
      readiness: { missing, hardStops: [], score: 0 },
      overrideReason: reason ?? undefined,
      fit: outreach.lenderFit,
      email: { subject: outreach.emailSubject, text: outreach.emailText, sha256: outreach.emailSha256 },
    },
    summary,
    overrideReason: reason,
  };
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
  // v1 rows (no email hash) re-request with the v1 payload shape; v2 rows with what was stored.
  const submission = await storedSubmission(deps, outreach);
  return decideOutreach(deps, { deal, lender, pkg, outreach, staleLenderOverride: outreach.staleLenderOverride, ttlDays: opts.ttlDays, actor, submission });
}

/** The approving broker's one line (spec 5.2); not hashed, so it can carry labels and the note. */
function submissionApprovalSummary(deal: Deal, lender: LenderPanelEntry, pkg: DealPackage, s: CheckedSubmission, note: string | undefined): string {
  const tiles = s.summary.spec.headline;
  const tile = (labels: readonly string[]) => tiles.find((t) => labels.includes(t.label));
  const ltv = tile(["LTV", "Loan to price", "Combined LTV", "LTC", "Combined LTC"]);
  const dscr = tile(["DSCR", "Global DSCR"]);
  const figures = [deal.loanAmountCents ? fmt.usd(deal.loanAmountCents) : null, ltv ? `${ltv.label} ${ltv.value}` : null, dscr ? `${dscr.label} ${dscr.value}` : null].filter(Boolean).join(", ");
  const missing = s.send.readiness.missing;
  const flags = [...new Set(checkNeutralCopy([s.send.email.text]).map((f) => `"${f.term}" (${f.label})`))];
  const parts = [
    `Send "${deal.title}" (${PLAYBOOK_LABELS[s.summary.playbook]}, ${STAGE_REQUEST[s.send.targetStage]} request) package v${pkg.version} to ${lender.name}${figures ? `: ${figures}` : ""}.`,
    `Missing: ${missing.length ? missingLabels(missing, s.summary).join("; ") : "none"}${s.overrideReason ? ` — reason: ${s.overrideReason}` : ""}.`,
    `Lender fit exceptions: ${s.send.fit.exceptions.length ? s.send.fit.exceptions.join("; ") : "none"}.`,
    // Fair lending (spec 6.5): staff confirmed copy that touches a protected characteristic; the broker sees it.
    flags.length ? `Fair-lending copy flags: ${flags.join("; ")}.` : null,
    note ? `Note: ${note.slice(0, 200)}` : null,
  ].filter(Boolean);
  const line = parts.join(" ");
  return line.length <= 500 ? line : `${line.slice(0, 499)}…`;
}

async function decideOutreach(
  deps: OutreachDeps,
  input: { deal: Deal; lender: LenderPanelEntry; pkg: DealPackage; outreach: LenderOutreach | null; staleLenderOverride: boolean; note?: string | null; ttlDays?: number; actor: string; submission: CheckedSubmission | null },
): Promise<SendPackageResult> {
  const { store } = deps;
  const { deal, lender, pkg, submission } = input;
  let outreach = input.outreach;
  const now = deps.now();
  const approvalKey = outreachApprovalKey(deal.id, lender.id, pkg.version);
  const note = input.note?.trim();

  const v1Payload = {
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
  };
  let decision: ApprovalDecision;
  try {
    decision = await deps.gate.request({
      // Sensitive: the approving broker re-authenticates (lib/agents/core/reauth.ts),
      // and the gate refuses to hand out "approved" without that proof.
      kind: "lender_submission",
      idempotencyKey: approvalKey,
      // The staff note is shown to the approving broker but is not part of the
      // hashed payload, so re-checking (or re-sending with another note) never conflicts.
      summary: submission
        ? submissionApprovalSummary(deal, lender, pkg, submission, note)
        : `Send "${deal.title}" package v${pkg.version} (${pkg.manifest.length} document${pkg.manifest.length === 1 ? "" : "s"}) to ${lender.name}${note ? ` — note: ${note.slice(0, 200)}` : ""}`,
      templateId: submission ? LENDER_SUBMISSION_TEMPLATE_ID_V2 : LENDER_SUBMISSION_TEMPLATE_ID,
      // v2 also hashes the target stage, the locked summary, the exact email and the
      // readiness gap with its reason: a change to any of them after the request is a conflict.
      payload: submission
        ? {
            ...v1Payload,
            targetStage: submission.send.targetStage,
            summarySha256: submission.summary.specSha256,
            emailSha256: submission.send.email.sha256,
            readinessMissing: [...submission.send.readiness.missing],
            overrideReason: submission.overrideReason,
          }
        : v1Payload,
      requestedBy: input.actor,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "ApprovalConflictError") {
      throw new PackageError(
        "invalid_status",
        submission
          ? `The submission to ${lender.name} changed after approval was requested (recipient, summary or email text). Withdraw it and request approval again.`
          : `${lender.name}'s contact email changed after approval was requested for package v${pkg.version}. Withdraw this submission and send the package again so a broker approves the new recipient.`,
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
    // The submission record (spec 3.6 section 4): what the broker approved, kept on the row.
    ...(submission
      ? {
          targetStage: submission.send.targetStage,
          summaryId: submission.summary.id,
          readinessMissing: [...submission.send.readiness.missing],
          readinessOverrideReason: submission.overrideReason,
          lenderFit: submission.send.fit,
          emailSubject: submission.send.email.subject,
          emailText: submission.send.email.text,
          emailSha256: submission.send.email.sha256,
        }
      : {}),
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

  // The approved email (v2) with the link filled in; v1 rows keep the documents-only note.
  const approvedEmail =
    outreach.emailText && outreach.emailSubject
      ? { subject: outreach.emailSubject, text: fillEmailPlaceholders(outreach.emailText, { shareUrl: url, expiresAt: link.expiresAt }) }
      : null;
  if (deps.mailer && lender.contactEmail) {
    const { messageId } = await deps.mailer.send({
      to: lender.contactEmail,
      subject: approvedEmail?.subject ?? `Corin Commercial · ${deal.title} · package v${pkg.version}`,
      text:
        approvedEmail?.text ??
        [
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
  // No lender mailer (LENDER_EMAIL_ENABLED unset): nothing is emailed; staff get the link and the approved text once.
  return { outreach, pkg, shareUrl: url, ...(approvedEmail ? { email: approvedEmail } : {}) };
}

/**
 * The approved email for the one-time "send it yourself" view (email to
 * lenders off): the stored text with the link and its expiry filled in. Only
 * for the outreach row the share URL was minted for (its token matches the
 * row's link) on this deal, and only for a lender-ready (v2) row; null otherwise.
 */
export async function approvedEmailForShare(store: Pick<DealDeskStore, "getOutreach" | "listShareLinks">, dealId: string, outreachId: string | null | undefined, shareUrl: string): Promise<{ lenderId: string; subject: string; text: string } | null> {
  if (!outreachId) return null;
  const o = await store.getOutreach(outreachId);
  if (!o || o.dealId !== dealId || !o.emailText || !o.emailSubject || !o.shareLinkId) return null;
  const link = (await store.listShareLinks(dealId)).find((l) => l.id === o.shareLinkId);
  const token = shareUrl.split("/").pop() ?? "";
  if (!link || link.revokedAt || !tokenMatches(token, link.tokenHash)) return null;
  return { lenderId: o.lenderId, subject: o.emailSubject, text: fillEmailPlaceholders(o.emailText, { shareUrl, expiresAt: link.expiresAt }) };
}

/** One line for staff describing a submission after a send or an approval check. */
export function outreachMessage(r: SendPackageResult): string {
  const v = `Package v${r.pkg.version}`;
  switch (r.outreach.status) {
    case "pending_approval":
      return `${v} locked; the submission is waiting for broker approval. Nothing was sent; use Check approval once a broker decides.`;
    case "approved":
      if (r.shareUrl && r.email) return `${v} approved; the share link and the approved email are shown below once. Email to lenders is off, so send it from your mailbox, then click Mark sent.`;
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
