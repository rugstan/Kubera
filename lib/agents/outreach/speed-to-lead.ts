import { bookingLink } from "@/lib/notify/calcom";
import type { LeadRecord } from "@/lib/notify/leads";
import { safeRecord, type OutreachAuditSink } from "./audit";
import type { EscalationSink } from "./escalation";
import type { OutreachSender } from "./sender";
import type { OutreachStore } from "./store";
import type { OutreachOutcome } from "./types";

// Speed to lead: a Tier-1 or Tier-2 lead gets a text within 60 seconds from the
// pre-approved speed_to_lead_sms template, with the Cal.com booking link. The
// text goes out only when the consent ledger covers texting for that number and
// it is inside the TCPA window. When it cannot (no consent, no phone, texting
// window closed, SMS not configured) the lead gets the pre-approved email
// instead, and if neither channel can go, a broker is told so a person follows
// up. One lead gets at most one of the two: once either is sent, later runs stop.

export const SPEED_TIERS = ["TIER_1_INSTITUTIONAL_HOT", "TIER_2_QUALIFIED_MIDMARKET"] as const;
export const SPEED_TO_LEAD_SLA_MS = 60_000;

export type SpeedToLeadDeps = {
  sender: OutreachSender;
  store: OutreachStore;
  escalation?: EscalationSink | null;
  audit?: OutreachAuditSink;
  now?: () => Date;
  /** Cal.com link override for tests; defaults to NEXT_PUBLIC_CALCOM_LINK. */
  calcomHandle?: string | null;
};

export type SpeedToLeadResult = {
  handled: boolean;
  skipped?: "not_hot_tier" | "already_sent";
  /** Channel that went out, if any. */
  sent: "sms" | "email" | null;
  latencyMs: number;
  /** Text sent within the 60-second target. */
  withinSla: boolean;
  sms?: OutreachOutcome;
  email?: OutreachOutcome;
  /** No automatic channel worked and a broker was asked to follow up. */
  escalated: boolean;
};

export const isHotTier = (tier: string | null): boolean => SPEED_TIERS.includes(tier as (typeof SPEED_TIERS)[number]);

/** A held message a broker or a later run can still release: do not escalate over it. */
const WAITING = new Set(["pending_approval", "deferred_quiet_hours"]);

export async function speedToLead(lead: LeadRecord, deps: SpeedToLeadDeps): Promise<SpeedToLeadResult> {
  const now = deps.now ?? (() => new Date());
  const elapsed = () => Math.max(0, now().getTime() - Date.parse(lead.createdAt));
  if (!isHotTier(lead.tier)) return { handled: false, skipped: "not_hot_tier", sent: null, latencyMs: elapsed(), withinSla: false, escalated: false };

  const earlier = await deps.store.listSeries({ kind: "speed_to_lead", leadId: lead.id });
  const already = earlier.find((r) => r.status === "sent");
  if (already) return { handled: true, skipped: "already_sent", sent: already.channel, latencyMs: elapsed(), withinSla: false, escalated: false };

  const base = { leadId: lead.id, subjectKey: `lead:${lead.id}`, requestedBy: "agent:speed_to_lead", metadata: { tier: lead.tier } };
  const first = lead.contact.firstName && lead.contact.firstName !== "there" ? lead.contact.firstName : null;

  let sms: OutreachOutcome | undefined;
  if (lead.contact.phone) {
    sms = await deps.sender.send({
      ...base,
      templateId: "speed_to_lead_sms",
      to: { audience: "borrower", phone: lead.contact.phone },
      data: { firstName: first, bookingUrl: bookingLink({ campaign: "speed-to-lead" }, deps.calcomHandle) },
      idempotencyKey: `s2l:${lead.id}:sms`,
    });
  }
  const smsMs = elapsed();
  if (sms?.status === "sent") {
    return { handled: true, sent: "sms", latencyMs: smsMs, withinSla: smsMs <= SPEED_TO_LEAD_SLA_MS, sms, escalated: false };
  }

  // A text waiting on a broker's approval is not abandoned: the broker is already asked.
  const smsWaiting = sms ? WAITING.has(sms.status) && sms.reason === "approval_pending" : false;
  let email: OutreachOutcome | undefined;
  if (lead.contact.email && !smsWaiting) {
    email = await deps.sender.send({
      ...base,
      templateId: "speed_to_lead_email",
      to: { audience: "borrower", email: lead.contact.email },
      data: { firstName: first, bookingUrl: bookingLink({ name: first, email: lead.contact.email, campaign: "speed-to-lead" }, deps.calcomHandle) },
      idempotencyKey: `s2l:${lead.id}:email`,
    });
    if (email.status === "sent") {
      return { handled: true, sent: "email", latencyMs: elapsed(), withinSla: false, ...(sms ? { sms } : {}), email, escalated: false };
    }
  }

  const waiting = [sms, email].some((o) => o && (o.reason === "approval_pending" || o.status === "deferred_quiet_hours"));
  let escalated = false;
  if (!waiting && deps.escalation) {
    escalated = await deps.escalation
      .escalate({
        key: `s2l:${lead.id}:unsent`,
        kind: "speed_to_lead_unsent",
        leadId: lead.id,
        dealId: null,
        title: `Hot lead ${lead.id.replace(/-/g, "").slice(0, 8).toUpperCase()} could not be contacted automatically`,
        lines: [
          "Neither the speed-to-lead text nor email could be sent (no consent on file, no contact detail, or the provider is not configured).",
          "Check the lead in the pipeline and follow up only through a channel the borrower agreed to.",
        ],
      })
      .then(() => true)
      .catch((err) => {
        console.error("outreach: escalation failed", err instanceof Error ? err.message : err);
        return false;
      });
    await safeRecord(deps.audit, { at: now().toISOString(), agent: "speed_to_lead", action: "escalate", kind: "speed_to_lead", reason: "no_channel_available", leadId: lead.id });
  }
  return { handled: true, sent: null, latencyMs: elapsed(), withinSla: false, ...(sms ? { sms } : {}), ...(email ? { email } : {}), escalated };
}
