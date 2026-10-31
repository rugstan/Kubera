// Routes a classified message to a deal (and/or lead), most reliable signal first:
//
//   1. reference   a KC-XXXXXXXX token in the subject or body
//   2. thread      In-Reply-To / References match an earlier routed message
//   3. participant the sender (or a cc) is a lead's contact with one active deal
//   4. property    the classifier's property name matches exactly one deal (always reviewed)
//
// Anything ambiguous, suspicious or low-confidence goes to the mailbox's
// staff queue for review instead of being attached to a deal automatically.
// A sender that fails DMARC is never matched by address (it may be spoofed)
// and its thread match is reviewed. Only a From address with a DMARC pass
// routes automatically by participant; a CC-only match is always reviewed.

import { LOW_CONFIDENCE, REFERENCE_IN_BODY_ONLY, type MailClassification } from "./classify";
import { MAILBOXES } from "./mailboxes";
import type { MailMessage } from "./types";

export type DealMatch = { dealId: string; leadId: string | null; name: string | null };

export interface DealDirectory {
  byReference(reference: string): Promise<DealMatch[]>;
  /** Deal/lead an earlier message in the thread was routed to. */
  byThread(messageIds: string[]): Promise<{ dealId: string | null; leadId: string | null } | null>;
  /** Leads whose contact email is `email`, and their active deals. */
  byParticipant(email: string): Promise<{ leadIds: string[]; deals: DealMatch[] }>;
  byProperty(name: string): Promise<DealMatch[]>;
}

export type RouteMethod = "reference" | "thread" | "participant" | "property" | "none";

export type MailRoute = {
  dealId: string | null;
  leadId: string | null;
  method: RouteMethod;
  confidence: number;
  queue: string;
  status: "processed" | "needs_review" | "ignored";
  reviewReasons: string[];
};

const IGNORABLE = new Set(["auto_reply", "marketing"]);
const OWN_DOMAIN = /@(kuberacommercial\.com|kubera\.loans)$/i;

export async function routeMail(msg: MailMessage, c: MailClassification, dir: DealDirectory): Promise<MailRoute> {
  const reasons: string[] = [];
  let dealId: string | null = null;
  let leadId: string | null = null;
  let method: RouteMethod = "none";
  let confidence = 0;

  const pick = (matches: DealMatch[], m: RouteMethod, conf: number, label: string): boolean => {
    if (matches.length === 1) {
      dealId = matches[0]!.dealId;
      leadId = matches[0]!.leadId;
      method = m;
      confidence = conf;
      return true;
    }
    if (matches.length > 1) reasons.push(`ambiguous_${label}`);
    return false;
  };

  // 1. Explicit reference token.
  if (c.dealReference) {
    const matches = await dir.byReference(c.dealReference);
    if (pick(matches, "reference", 0.98, "reference")) {
      // A token only in the body could have been planted: confirm by hand.
      if (c.flags.includes(REFERENCE_IN_BODY_ONLY)) reasons.push(REFERENCE_IN_BODY_ONLY);
    } else if (matches.length === 0) reasons.push("unknown_reference");
  }

  // 2. Thread.
  if (method === "none") {
    const ids = [msg.inReplyTo, ...msg.references].filter((v): v is string => Boolean(v));
    if (ids.length) {
      const prior = await dir.byThread(ids);
      if (prior && (prior.dealId || prior.leadId)) {
        dealId = prior.dealId;
        leadId = prior.leadId;
        method = "thread";
        confidence = 0.9;
        // In-Reply-To / References are trivially copied by a spoofer: an
        // unauthenticated sender's thread match is only a suggestion.
        if (msg.dmarc === "fail") reasons.push("thread_match_sender_not_authenticated");
      }
    }
  }

  // 3. Participant (never for a sender that failed DMARC). DMARC vouches only
  // for the From domain, so a match found through a CC address (which anyone
  // can add) or a From address without a DMARC pass is reviewed, not attached.
  if (method === "none") {
    if (msg.dmarc === "fail") reasons.push("sender_not_authenticated");
    else {
      const from = msg.fromAddress.toLowerCase();
      const candidates = [msg.fromAddress, ...msg.ccAddresses].filter((a) => a && !OWN_DOMAIN.test(a)).map((a) => a.toLowerCase());
      for (const email of [...new Set(candidates)]) {
        const found = await dir.byParticipant(email);
        let matched = pick(found.deals, "participant", 0.8, "participant");
        if (!matched && found.deals.length === 0 && found.leadIds.length === 1) {
          leadId = found.leadIds[0]!;
          method = "participant";
          confidence = 0.7;
          matched = true;
        }
        if (matched) {
          if (email !== from) {
            reasons.push("matched_by_cc");
            confidence = Math.min(confidence, 0.5);
          } else if (msg.dmarc !== "pass") reasons.push("sender_not_verified");
          break;
        }
        if (found.leadIds.length > 1 && found.deals.length === 0) reasons.push("ambiguous_participant");
        if (found.deals.length > 1) break;
      }
    }
  }

  // 4. Property name (fuzzy: always reviewed).
  if (method === "none" && c.propertyName) {
    if (pick(await dir.byProperty(c.propertyName), "property", 0.6, "property")) reasons.push("matched_by_property_name");
  }

  if (c.suspicious) reasons.push("suspicious");
  if (c.source === "rules" && !IGNORABLE.has(c.category)) reasons.push("rules_only_classification");
  else if (c.confidence < LOW_CONFIDENCE) reasons.push("low_confidence");
  const dealRelated = !IGNORABLE.has(c.category) && c.category !== "spam_or_phishing";
  if (dealRelated && method === "none" && c.category !== "new_inquiry" && c.category !== "partner_referral") reasons.push("no_deal_match");

  const uniqueReasons = [...new Set(reasons)];
  // Suspicious mail is always shown to a human; plain noise is filed away.
  const status: MailRoute["status"] = c.suspicious
    ? "needs_review"
    : IGNORABLE.has(c.category) || c.category === "spam_or_phishing"
      ? "ignored"
      : uniqueReasons.length
        ? "needs_review"
        : "processed";

  return { dealId, leadId, method, confidence, queue: MAILBOXES[msg.mailbox].queue, status, reviewReasons: uniqueReasons };
}

/** Directory with no data (Supabase not configured): nothing routes, everything is reviewed. */
export const emptyDealDirectory: DealDirectory = {
  async byReference() {
    return [];
  },
  async byThread() {
    return null;
  },
  async byParticipant() {
    return { leadIds: [], deals: [] };
  },
  async byProperty() {
    return [];
  },
};

/** In-memory directory for tests. */
export class MemoryDealDirectory implements DealDirectory {
  constructor(
    readonly deals: { id: string; leadId: string | null; name: string; propertyName?: string | null; status?: string }[] = [],
    readonly leads: { id: string; email: string }[] = [],
    readonly threads: { messageId: string; dealId: string | null; leadId: string | null }[] = [],
  ) {}

  private match(d: MemoryDealDirectory["deals"][number]): DealMatch {
    return { dealId: d.id, leadId: d.leadId, name: d.name };
  }

  async byReference(reference: string): Promise<DealMatch[]> {
    const prefix = reference.replace(/^KC-/i, "").toLowerCase();
    return this.deals.filter((d) => d.id.replace(/-/g, "").startsWith(prefix)).map((d) => this.match(d));
  }

  async byThread(ids: string[]): Promise<{ dealId: string | null; leadId: string | null } | null> {
    const lower = ids.map((i) => i.toLowerCase());
    const hit = [...this.threads].reverse().find((t) => lower.includes(t.messageId.toLowerCase()));
    return hit ? { dealId: hit.dealId, leadId: hit.leadId } : null;
  }

  async byParticipant(email: string): Promise<{ leadIds: string[]; deals: DealMatch[] }> {
    const leadIds = this.leads.filter((l) => l.email.toLowerCase() === email.toLowerCase()).map((l) => l.id);
    const deals = this.deals.filter((d) => d.leadId && leadIds.includes(d.leadId) && (d.status ?? "active") === "active").map((d) => this.match(d));
    return { leadIds, deals };
  }

  async byProperty(name: string): Promise<DealMatch[]> {
    const n = name.trim().toLowerCase();
    return this.deals.filter((d) => (d.propertyName ?? d.name).trim().toLowerCase() === n).map((d) => this.match(d));
  }
}
