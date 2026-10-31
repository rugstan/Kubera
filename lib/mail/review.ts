// Staff review queue for inbound mail (app/(staff)/documents/mail).
//
// routeMail and processInboundMessage park anything they cannot attach with
// confidence (no match, ambiguous, CC-only or unauthenticated sender,
// suspicious, advisor-only sender, failed after every retry) as needs_review.
// Staff either assign the message to a lead or deal, or dismiss it. Assigning
// to a lead registers the attachments held in quarantine as vault documents
// (status quarantined), so the malware scanner picks them up and they reach the
// deal's file only once they are clean. Nothing here sends mail or writes to a
// third party.

import type { SupabaseClient } from "@supabase/supabase-js";
import { documentKindFor, sanitizeFileName, type AttachmentRecord, type AttachmentSink } from "./attachments";
import { REFERENCE_IN_BODY_ONLY } from "./classify";
import { MAILBOXES, MAX_MAIL_ATTEMPTS, type InboundMailbox } from "./mailboxes";
import { supabaseDealDirectory, type MailStore, type ReviewMail } from "./store";
import type { DealMatch, MemoryDealDirectory } from "./route";

/** Mailboxes whose review items page staff: borrower inquiries (deals@) and document submissions (docs@, never synced to Twenty). */
export const REVIEW_ALERT_MAILBOXES: readonly InboundMailbox[] = ["deals", "docs"];

export const REVIEW_REASON_LABELS: Readonly<Record<string, string>> = {
  no_deal_match: "No matching deal or lead",
  unknown_reference: "The deal reference in the message matches no deal",
  ambiguous_reference: "The deal reference matches more than one deal",
  ambiguous_participant: "The sender matches more than one lead or deal",
  ambiguous_property: "The property name matches more than one deal",
  matched_by_cc: "Matched only through a CC address",
  sender_not_verified: "The sender's domain did not pass DMARC, so the match is unconfirmed",
  sender_not_authenticated: "The sender failed DMARC (possible spoofing); not matched by address",
  thread_match_sender_not_authenticated: "Reply in a known thread from a sender that failed DMARC",
  matched_by_property_name: "Matched by property name only",
  [REFERENCE_IN_BODY_ONLY]: "The deal reference appears only in the body, not the subject",
  suspicious: "Looks suspicious (possible phishing or malware)",
  rules_only_classification: "Classified by rules only (the AI classifier was not used)",
  low_confidence: "Low classification confidence",
  human_review_requested: "The sender asked that an advisor handle their requests personally",
  processing_failed: "Processing failed after every retry",
};

export function reviewReasonLabel(code: string): string {
  return REVIEW_REASON_LABELS[code] ?? code.replace(/_/g, " ");
}

/** Attachments held in quarantine that are not yet vault documents. */
export function heldAttachments(m: Pick<ReviewMail, "attachments">): AttachmentRecord[] {
  return m.attachments.filter((a) => a.status === "stored" && a.storagePath && a.sha256 && a.contentType && a.bucket);
}

// --- Staff alert -------------------------------------------------------------------------

export type ReviewAlertInput = {
  mailMessageId: string;
  mailbox: InboundMailbox;
  category: string;
  reviewReasons: readonly string[];
  storedAttachments: number;
};

export function shouldAlertReview(mailbox: InboundMailbox): boolean {
  return REVIEW_ALERT_MAILBOXES.includes(mailbox);
}

/**
 * The staff_alert content. It carries the mailbox, category, reasons and
 * attachment count only: the sender, subject and body stay in the queue,
 * behind staff sign-in.
 */
export function reviewAlertContent(a: ReviewAlertInput): { title: string; lines: string[] } {
  const lines = [
    `A ${a.mailbox}@ message (${a.category.replace(/_/g, " ")}) could not be filed automatically and is waiting in the mail review queue.`,
    ...a.reviewReasons.slice(0, 6).map((r) => `Why: ${reviewReasonLabel(r)}.`),
  ];
  if (a.storedAttachments > 0) {
    lines.push(
      `${a.storedAttachments} ${a.storedAttachments === 1 ? "attachment is" : "attachments are"} held in quarantine and will not be scanned or added to a deal until someone assigns the message.`,
    );
  }
  return { title: `Mail needs review: ${a.mailbox}@`, lines };
}

// --- Assigning and dismissing --------------------------------------------------------------

export interface ReviewTargets {
  byReference(reference: string): Promise<DealMatch[]>;
  dealById(id: string): Promise<DealMatch | null>;
  leadExists(id: string): Promise<boolean>;
}

export type ReviewDeps = { store: MailStore; sink: AttachmentSink; targets: ReviewTargets; now?: () => Date };

export type ReviewFailure = { ok: false; code: "not_in_queue" | "unknown_target" | "not_assignable"; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^KC-[0-9a-f]{8}$/i;

/** A deal reference (KC-XXXXXXXX), a deal id or a lead id → the deal and lead to file the message under. */
export async function resolveTarget(raw: string, targets: ReviewTargets): Promise<{ dealId: string | null; leadId: string | null } | null> {
  const value = raw.trim();
  if (REFERENCE.test(value)) {
    const matches = await targets.byReference(value);
    return matches.length === 1 ? { dealId: matches[0]!.dealId, leadId: matches[0]!.leadId } : null;
  }
  if (!UUID.test(value)) return null;
  const id = value.toLowerCase();
  const deal = await targets.dealById(id);
  if (deal) return { dealId: deal.dealId, leadId: deal.leadId };
  return (await targets.leadExists(id)) ? { dealId: null, leadId: id } : null;
}

export type AssignResult = { ok: true; leadId: string | null; dealId: string | null; registered: number; failed: number; heldBack: number };

/**
 * Files a reviewed message under a lead or deal. Its quarantined attachments
 * become vault documents of the lead (for mailboxes whose attachments go to
 * the vault), so the scanner picks them up; an attachment that fails to
 * register stays held and is reported.
 */
export async function assignReviewedMail(deps: ReviewDeps, id: string, reviewer: string, target: string): Promise<AssignResult | ReviewFailure> {
  const now = deps.now ?? (() => new Date());
  const mail = await deps.store.getReview(id, { maxAttempts: MAX_MAIL_ATTEMPTS });
  if (!mail) return { ok: false, code: "not_in_queue", message: "This message is no longer waiting for review." };
  if (mail.status === "failed") return { ok: false, code: "not_assignable", message: "This message was never read successfully. Open it in Zoho Mail, then dismiss it here." };
  const resolved = await resolveTarget(target, deps.targets);
  if (!resolved) return { ok: false, code: "unknown_target", message: "No single deal or lead matches that reference. Use a KC- deal reference, a deal ID or a lead ID." };

  let registered = 0;
  let failed = 0;
  let heldBack = 0;
  const attachments = mail.attachments.map((a) => ({ ...a }));
  const held = heldAttachments({ attachments });
  if (held.length && resolved.leadId && MAILBOXES[mail.mailbox].vaultAttachments) {
    for (const a of held) {
      const kind = documentKindFor(a.fileName, mail.classification);
      try {
        const { documentId } = await deps.sink.registerDocument({
          leadId: resolved.leadId,
          kind,
          bucket: a.bucket!,
          path: a.storagePath!,
          fileName: sanitizeFileName(a.fileName),
          contentType: a.contentType!,
          sizeBytes: a.size,
          sha256: a.sha256!,
        });
        Object.assign(a, { status: "registered", documentId, kind, error: null });
        registered++;
      } catch (err) {
        a.error = `registration failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
        failed++;
      }
    }
  } else heldBack = held.length;

  const closed = await deps.store.markReviewed(id, { reviewer, at: now().toISOString(), outcome: "assigned", leadId: resolved.leadId, dealId: resolved.dealId, attachments });
  if (!closed) return { ok: false, code: "not_in_queue", message: "Someone else resolved this message first." };
  return { ok: true, ...resolved, registered, failed, heldBack };
}

/** Closes a review without filing the message (spam, a duplicate, nothing to do). Attachments stay in quarantine until retention removes them. */
export async function dismissReviewedMail(deps: ReviewDeps, id: string, reviewer: string): Promise<{ ok: true } | ReviewFailure> {
  const now = deps.now ?? (() => new Date());
  const mail = await deps.store.getReview(id, { maxAttempts: MAX_MAIL_ATTEMPTS });
  if (!mail) return { ok: false, code: "not_in_queue", message: "This message is no longer waiting for review." };
  const closed = await deps.store.markReviewed(id, { reviewer, at: now().toISOString(), outcome: "dismissed" });
  return closed ? { ok: true } : { ok: false, code: "not_in_queue", message: "Someone else resolved this message first." };
}

export function listReviewQueue(store: MailStore, opts: { queue?: string | null; limit?: number } = {}): Promise<ReviewMail[]> {
  return store.listReview({ queue: opts.queue ?? null, limit: opts.limit ?? 100, maxAttempts: MAX_MAIL_ATTEMPTS });
}

// --- Targets ---------------------------------------------------------------------------------

export function memoryReviewTargets(dir: MemoryDealDirectory): ReviewTargets {
  return {
    byReference: (ref) => dir.byReference(ref),
    async dealById(id) {
      const d = dir.deals.find((x) => x.id === id);
      return d ? { dealId: d.id, leadId: d.leadId, name: d.name } : null;
    },
    async leadExists(id) {
      return dir.leads.some((l) => l.id === id);
    },
  };
}

export function supabaseReviewTargets(db: SupabaseClient): ReviewTargets {
  const directory = supabaseDealDirectory(db);
  return {
    byReference: (ref) => directory.byReference(ref),
    async dealById(id) {
      const { data, error } = await db.from("deals").select("id, lead_id, name").eq("id", id).maybeSingle();
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return null;
        throw new Error(`deal lookup failed: ${error.message}`);
      }
      const d = data as { id: string; lead_id: string | null; name: string | null } | null;
      return d ? { dealId: d.id, leadId: d.lead_id, name: d.name } : null;
    },
    async leadExists(id) {
      const { data, error } = await db.from("leads").select("id").eq("id", id).maybeSingle();
      if (error) throw new Error(`lead lookup failed: ${error.message}`);
      return Boolean(data);
    },
  };
}
