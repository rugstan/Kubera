import { isApproved, type ApprovalGate, type OutboundAction } from "@/lib/compliance/approval-gate";
import { consentAllows, consentState, type ConsentReader } from "@/lib/notify/consent";
import { emailRetryIsSafe, type EmailClient } from "@/lib/notify/email/types";
import { maskPhone, toE164 } from "@/lib/notify/phone";
import { insideSmsWindow } from "@/lib/notify/quiet-hours";
import type { SmsClient } from "@/lib/notify/sms/types";
import type { NotifyStore } from "@/lib/notify/store";
import { safeRecord, type OutreachAuditSink } from "./audit";
import type { OutreachStore } from "./store";
import { fingerprint, isPreApproved, templateById, type BuiltMessage, type OutreachTemplateId } from "./templates";
import type { OutreachOutcome, OutreachRecipient, OutreachStatus, ReasonCode } from "./types";

// The send pipeline for every chaser message. In order:
//   1. template data and recipient address valid
//   2. claim the idempotency key (a retried trigger never sends twice)
//   3. consent on the ledger (policy per template: required / not revoked)
//   4. TCPA texting window for borrower texts
//   5. provider configured (otherwise skip, never crash)
//   6. broker approval gate (pre-approved template, or the broker approves;
//      pending, rejected and expired decisions never send)
//   7. send, then record the provider id or the failure. A pre-approved email
//      that failed is sent again on a later call with the same key only when
//      that cannot deliver it twice (emailRetryIsSafe): Cloudflare takes no
//      idempotency key, so a timeout there is recorded as "delivery_unknown"
//      and never resent automatically.
// Each stop writes its status and reason code to outreach_messages and to the
// audit sink. What the broker approves is exactly what is sent: the rendered
// data is stored on the first attempt and reused on every retry.

export type SenderDeps = {
  email: EmailClient | null;
  sms: SmsClient | null;
  store: OutreachStore;
  consent: ConsentReader;
  gate: ApprovalGate;
  /** "<template>@<version>" entries the broker pre-approved (OUTREACH_PREAPPROVED_TEMPLATES). */
  preApproved?: ReadonlySet<string>;
  /** Mirrors outbound texts into WS-J's sms_messages ledger so replies and delivery receipts attach to them. */
  smsLog?: Pick<NotifyStore, "recordSms"> | null;
  audit?: OutreachAuditSink;
  /** Kill switch (OUTREACH_PAUSED): every send is skipped. */
  paused?: boolean;
  now?: () => Date;
};

export type OutreachSend = {
  templateId: OutreachTemplateId;
  to: OutreachRecipient;
  data: unknown;
  /** Stable key for this logical message, e.g. `docrem:<deal>:<window>:email`. */
  idempotencyKey: string;
  leadId?: string | null;
  dealId?: string | null;
  subjectKey?: string | null;
  sequence?: number;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
};

const RETRY_ANY: readonly OutreachStatus[] = ["pending_approval", "deferred_quiet_hours", "skipped_no_consent", "skipped_unconfigured"];

const normalizeEmail = (e: string | null | undefined) => {
  const v = e?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 320 ? v : null;
};

export class OutreachSender {
  private readonly now: () => Date;

  constructor(private readonly deps: SenderDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private async audit(req: OutreachSend, template: { id: string; version: number; kind: string }, outcome: OutreachOutcome) {
    await safeRecord(this.deps.audit, {
      at: this.now().toISOString(),
      agent: agentFor(template.kind),
      action: outcome.status === "sent" ? "send" : "skip",
      kind: template.kind as never,
      reason: outcome.reason,
      dealId: req.dealId ?? null,
      leadId: req.leadId ?? null,
      templateId: template.id,
      templateVersion: template.version,
      approvalId: outcome.approvalId ?? null,
      messageId: outcome.messageId ?? null,
      detail: { status: outcome.status, sequence: req.sequence ?? 1 },
    });
  }

  async send(req: OutreachSend): Promise<OutreachOutcome> {
    const template = templateById(req.templateId);
    if (!template.audiences.includes(req.to.audience)) {
      return { status: "invalid", reason: "invalid_recipient", detail: `template ${template.id} cannot be sent to ${req.to.audience}` };
    }
    const address = template.channel === "email" ? normalizeEmail(req.to.email) : toE164(req.to.phone);
    if (!address) return { status: "invalid", reason: "invalid_recipient", detail: `no valid ${template.channel === "email" ? "email address" : "phone number"} for recipient` };

    const { row, fresh } = await this.deps.store.claim({
      kind: template.kind,
      channel: template.channel,
      templateId: template.id,
      templateVersion: template.version,
      audience: req.to.audience,
      recipient: address,
      idempotencyKey: req.idempotencyKey,
      leadId: req.leadId ?? null,
      dealId: req.dealId ?? null,
      subjectKey: req.subjectKey ?? null,
      sequence: req.sequence ?? 1,
      // The data the broker reviews is fixed at the first attempt.
      metadata: { ...(req.metadata ?? {}), renderData: req.data },
    });
    const id = row.id;
    const preApproved = isPreApproved(template, this.deps.preApproved);

    if (!fresh) {
      const retryable = new Set<OutreachStatus>(RETRY_ANY);
      if (template.channel === "email" && preApproved && row.reasonCode !== "delivery_unknown") retryable.add("failed");
      if (!retryable.has(row.status)) {
        return { status: "duplicate", reason: "duplicate", messageId: id, previousStatus: row.status, providerMessageId: row.providerMessageId ?? undefined };
      }
      const reopened = await this.deps.store.reopen(id, [...retryable]);
      if (!reopened) return { status: "duplicate", reason: "duplicate", messageId: id, previousStatus: row.status };
    }

    const renderData = fresh ? req.data : (row.metadata.renderData ?? req.data);

    let built: BuiltMessage;
    try {
      built = template.build(renderData);
    } catch (err) {
      const detail = `template data rejected: ${err instanceof Error ? err.message.slice(0, 300) : "unknown error"}`;
      await this.deps.store.update(id, { status: "failed", reasonCode: "invalid_template_data", error: detail });
      const out: OutreachOutcome = { status: "invalid", reason: "invalid_template_data", messageId: id, detail };
      await this.audit(req, template, out);
      return out;
    }

    const stop = async (status: OutreachStatus, reason: ReasonCode, detail: string, extra: { consentEventId?: string; approvalId?: string } = {}): Promise<OutreachOutcome> => {
      await this.deps.store.update(id, { status, reasonCode: reason, error: detail, ...extra });
      const out: OutreachOutcome = { status, reason, messageId: id, detail, ...(extra.approvalId ? { approvalId: extra.approvalId } : {}) };
      await this.audit(req, template, out);
      return out;
    };

    if (this.deps.paused) return stop("skipped_unconfigured", "provider_unconfigured", "outreach is paused (OUTREACH_PAUSED)");

    // 3. Consent
    let consentEventId: string | undefined;
    if (template.consent !== "none") {
      try {
        const records = await this.deps.consent.history(template.channel, { email: template.channel === "email" ? address : null, phone: template.channel === "sms" ? address : null });
        const state = consentState(records, template.channel);
        consentEventId = state.eventId;
        if (!consentAllows(template.consent, state)) {
          return state.state === "revoked"
            ? stop("skipped_no_consent", "consent_revoked", "recipient has opted out", { consentEventId })
            : stop("skipped_no_consent", "no_consent", "no consent on file for this channel", { consentEventId });
        }
      } catch (err) {
        // Fail closed: if the ledger cannot be read, nothing is sent.
        console.error("outreach: consent lookup failed; not sending", template.id, err instanceof Error ? err.message : err);
        return stop("failed", "consent_lookup_failed", "consent lookup failed");
      }
    }

    // 4. Texting window
    if (template.channel === "sms" && template.quietHours && !insideSmsWindow(this.now())) {
      return stop("deferred_quiet_hours", "outside_texting_window", "outside the 8 a.m. to 9 p.m. texting window; retry later", { consentEventId });
    }

    // 5. Provider
    const client = template.channel === "email" ? this.deps.email : this.deps.sms;
    if (!client) return stop("skipped_unconfigured", "provider_unconfigured", `${template.channel} provider is not configured`, { consentEventId });

    // 6. Approval gate
    let approvalId: string | undefined;
    if (!preApproved) {
      const action: OutboundAction = {
        kind: (template.channel === "email" ? "email" : "sms") as OutboundAction["kind"],
        idempotencyKey: `outreach:${req.idempotencyKey}`,
        summary: `${summaryFor(template.kind)}: ${template.id} to ${template.channel === "email" ? address : maskPhone(address)}`.slice(0, 300),
        templateId: `${template.id}@${template.version}`,
        payload: {
          channel: template.channel,
          templateId: template.id,
          templateVersion: template.version,
          templateBodySha256: fingerprint(template),
          recipient: address,
          audience: req.to.audience,
          leadId: req.leadId ?? null,
          dealId: req.dealId ?? null,
          data: renderData,
        },
        requestedBy: req.requestedBy ?? "agent:outreach",
      };
      let decision;
      try {
        decision = await this.deps.gate.request(action);
      } catch (err) {
        console.error("outreach: approval request failed; not sending", template.id, err instanceof Error ? err.message : err);
        return stop("pending_approval", "approval_pending", "approval request could not be recorded; will retry", { consentEventId });
      }
      if (!isApproved(decision)) {
        if (decision.status === "rejected") return stop("rejected", "approval_rejected", "approval rejected", { consentEventId, approvalId: decision.approvalId });
        if (decision.status === "expired") return stop("expired", "approval_expired", "approval expired; nothing was sent", { consentEventId, approvalId: decision.approvalId });
        return stop("pending_approval", "approval_pending", "waiting for broker approval", { consentEventId, approvalId: decision.approvalId });
      }
      approvalId = decision.approvalId;
    }

    // 7. Send
    await this.deps.store.update(id, { incrementAttempts: true, approvalId: approvalId ?? null, consentEventId: consentEventId ?? null });
    try {
      let providerMessageId: string;
      if (built.channel === "email") {
        if (!this.deps.email) throw new Error("email provider is not configured");
        ({ providerMessageId } = await this.deps.email.send({
          to: address,
          subject: built.subject,
          html: built.html,
          text: built.text,
          idempotencyKey: `outreach-${req.idempotencyKey}`.slice(0, 250),
          tags: { template: template.id, kind: template.kind },
        }));
      } else {
        if (!this.deps.sms) throw new Error("sms provider is not configured");
        ({ providerMessageId } = await this.deps.sms.send({ to: address, text: built.body }));
      }
      await this.deps.store.update(id, { status: "sent", reasonCode: "sent", provider: client.name, providerMessageId, sentAt: this.now().toISOString(), error: null });
      if (built.channel === "sms" && this.deps.sms && this.deps.smsLog) {
        await this.deps.smsLog
          .recordSms({ direction: "outbound", fromNumber: this.deps.sms.fromNumber, toNumber: address, body: built.body, status: "sent", providerMessageId, leadId: req.leadId ?? null })
          .catch((err) => console.error("outreach: could not record outbound sms", err instanceof Error ? err.message : err));
      }
      const out: OutreachOutcome = { status: "sent", reason: "sent", messageId: id, providerMessageId, ...(approvalId ? { approvalId } : {}) };
      await this.audit(req, template, out);
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`outreach: ${template.channel} send failed (${template.id})`, message);
      if (built.channel === "email" && !emailRetryIsSafe(this.deps.email, err)) {
        // The provider may have accepted it and takes no idempotency key: never resend automatically.
        return stop("failed", "delivery_unknown", `delivery unknown, not retried: ${message}`.slice(0, 1000), { ...(approvalId ? { approvalId } : {}) });
      }
      return stop("failed", "send_failed", message.slice(0, 1000), { ...(approvalId ? { approvalId } : {}) });
    }
  }
}

function agentFor(kind: string) {
  switch (kind) {
    case "speed_to_lead":
      return "speed_to_lead" as const;
    case "document_reminder":
      return "document_reminders" as const;
    case "closing_nudge":
      return "closing_nudges" as const;
    default:
      return "vendor_nudges" as const;
  }
}

function summaryFor(kind: string): string {
  switch (kind) {
    case "speed_to_lead":
      return "Speed-to-lead reply";
    case "document_reminder":
      return "Document reminder";
    case "closing_nudge":
      return "Closing checklist nudge";
    default:
      return "Vendor order nudge";
  }
}
