import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { consentAllows, consentState, type ConsentReader } from "./consent";
import type { EmailClient } from "./email/types";
import { authorizeSend } from "./gate";
import { maskPhone, toE164 } from "./phone";
import { insideSmsWindow } from "./quiet-hours";
import { SmsError, smsFailureIsDefinitive, type SmsClient } from "./sms/types";
import type { NotifyStore } from "./store";
import { templateById, type BuiltMessage, type TemplateId } from "./templates";
import { type NotificationStatus, type Recipient, type SendOutcome } from "./types";

// The send pipeline. For every message, in order:
//   1. validate the template data and the recipient address
//   2. claim an idempotency key (a retried trigger never sends twice)
//   3. consent gate (ledger: granted / not revoked, per template policy)
//   4. TCPA quiet hours for borrower texts
//   5. provider configured? (otherwise skip, never crash)
//   6. approval gate (pre-approved template, or the broker approves; a pending,
//      rejected or expired decision never sends)
//   7. send, then record provider id / failure
// Each stop writes its reason to the notifications row.
//
// Step 7 keeps the provider call apart from the bookkeeping. A text is marked
// "failed" (and so retryable) only when the provider certainly did not take it:
// Telnyx /v2/messages has no idempotency key, so retrying after a timeout,
// network error or 5xx that Telnyx in fact accepted would send a second text.
// Those end as "send_unknown", which is never retried, and staff are told to
// check. A database error after a successful send is retried as bookkeeping
// and logged; it never turns a sent message into "failed".

export type NotifierDeps = {
  email: EmailClient | null;
  sms: SmsClient | null;
  store: NotifyStore;
  consent: ConsentReader;
  gate: ApprovalGate;
  /** Extra "<template>@<version>" entries the broker pre-approved (NOTIFY_PREAPPROVED_TEMPLATES). */
  preApproved?: ReadonlySet<string>;
  /** Staff mailboxes told when a text may or may not have gone out (status send_unknown). */
  staffEmails?: readonly string[];
  now?: () => Date;
};

export type SendRequest = {
  templateId: TemplateId;
  to: Recipient;
  data: unknown;
  /** Stable key for this logical message, e.g. `milestone:<eventId>:email`. */
  idempotencyKey: string;
  leadId?: string | null;
  dealId?: string | null;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Statuses a later call with the same key may pick up again. "failed" is only
 * written when nothing reached the provider, or for email, where Resend's
 * idempotency key makes a resend safe. "send_unknown" is deliberately absent: a
 * text that may already have gone out is never sent again automatically.
 */
const RETRYABLE: readonly NotificationStatus[] = ["pending_approval", "deferred_quiet_hours", "skipped_no_consent", "skipped_unconfigured", "failed"];

/** Tries for each post-send store write before it is logged and given up. */
const BOOKKEEPING_ATTEMPTS = 3;

const normalizeEmail = (e: string | null | undefined) => {
  const v = e?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 320 ? v : null;
};

export class Notifier {
  private readonly now: () => Date;

  constructor(private readonly deps: NotifierDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async send(req: SendRequest): Promise<SendOutcome> {
    const template = templateById(req.templateId);
    if (!template.audiences.includes(req.to.audience)) {
      return { status: "invalid", reason: `template ${template.id} cannot be sent to ${req.to.audience}` };
    }

    const address = template.channel === "email" ? normalizeEmail(req.to.email) : toE164(req.to.phone);
    if (!address) return { status: "invalid", reason: `no valid ${template.channel === "email" ? "email address" : "phone number"} for recipient` };

    let built: BuiltMessage;
    try {
      built = await template.build(req.data);
    } catch (err) {
      return { status: "invalid", reason: `template data rejected: ${err instanceof Error ? err.message.slice(0, 300) : "unknown error"}` };
    }

    const { row, fresh } = await this.deps.store.claim({
      channel: template.channel,
      templateId: template.id,
      templateVersion: template.version,
      audience: req.to.audience,
      recipient: address,
      idempotencyKey: req.idempotencyKey,
      subject: built.channel === "email" ? built.subject : null,
      leadId: req.leadId ?? null,
      dealId: req.dealId ?? null,
      metadata: req.metadata,
    });
    const id = row.id;
    if (!fresh) {
      if (!RETRYABLE.includes(row.status)) {
        return { status: "duplicate", notificationId: id, previousStatus: row.status, providerMessageId: row.providerMessageId ?? undefined };
      }
      // Exactly one concurrent retry wins the row.
      const reopened = await this.deps.store.reopen(id, RETRYABLE);
      if (!reopened) return { status: "duplicate", notificationId: id, previousStatus: row.status };
    }
    const stop = async (status: NotificationStatus, reason: string, extra: { consentEventId?: string; approvalId?: string } = {}): Promise<SendOutcome> => {
      await this.deps.store.update(id, { status, error: reason, ...extra });
      return { status, notificationId: id, reason };
    };

    // 3. Consent
    let consentEventId: string | undefined;
    if (template.consent !== "none") {
      try {
        const records = await this.deps.consent.history(template.channel, { email: template.channel === "email" ? address : null, phone: template.channel === "sms" ? address : null });
        const state = consentState(records, template.channel);
        consentEventId = state.eventId;
        if (!consentAllows(template.consent, state)) {
          const why = state.state === "revoked" ? "recipient has opted out" : "no consent on file for this channel";
          return stop("skipped_no_consent", why, { consentEventId });
        }
      } catch (err) {
        // Fail closed: if the ledger cannot be read, nothing is sent.
        console.error("notify: consent lookup failed; not sending", req.templateId, err instanceof Error ? err.message : err);
        return stop("failed", "consent lookup failed");
      }
    }

    // 4. Quiet hours
    if (template.channel === "sms" && template.quietHours && !insideSmsWindow(this.now())) {
      return stop("deferred_quiet_hours", "outside the 8 a.m. to 9 p.m. texting window; retry later", { consentEventId });
    }

    // 5. Provider configured
    const client = template.channel === "email" ? this.deps.email : this.deps.sms;
    if (!client) return stop("skipped_unconfigured", `${template.channel} provider is not configured`, { consentEventId });

    // 6. Approval gate
    const auth = await authorizeSend({
      template,
      channel: template.channel,
      gate: this.deps.gate,
      preApproved: this.deps.preApproved,
      idempotencyKey: `notify:${req.idempotencyKey}`,
      summary: `Send "${template.id}" ${template.channel === "email" ? "email" : "text"} to ${template.channel === "email" ? address : maskPhone(address)}`,
      payload: { templateId: template.id, templateVersion: template.version, recipient: address, audience: req.to.audience, leadId: req.leadId ?? null, data: req.data },
      requestedBy: req.requestedBy ?? "system:notify",
    });
    if (!auth.ok) {
      const reason = auth.status === "pending_approval" ? "waiting for broker approval" : `approval ${auth.status}`;
      return stop(auth.status, reason, { consentEventId, approvalId: auth.approvalId });
    }

    // 7. Send
    await this.deps.store.update(id, { incrementAttempts: true, approvalId: auth.approvalId, consentEventId });
    // Only the provider call is inside this try: what it catches is a send failure.
    let providerMessageId: string;
    try {
      if (built.channel === "email") {
        if (!this.deps.email) throw new Error("email provider is not configured");
        ({ providerMessageId } = await this.deps.email.send({
          to: address,
          subject: built.subject,
          html: built.html,
          text: built.text,
          idempotencyKey: req.idempotencyKey,
          tags: { template: template.id },
        }));
      } else {
        if (!this.deps.sms) throw new SmsError("sms provider is not configured", undefined, { notSent: true });
        ({ providerMessageId } = await this.deps.sms.send({ to: address, text: built.body }));
      }
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
      console.error(`notify: ${template.channel} send failed (${template.id})`, message);
      if (template.channel === "sms" && !smsFailureIsDefinitive(err)) {
        // Telnyx may have accepted the text; sending again could deliver it twice.
        const reason = `delivery unknown, not retried: ${message}`.slice(0, 1000);
        await this.bookkeeping(id, "record send_unknown", () => this.deps.store.update(id, { status: "send_unknown", provider: client.name, error: reason }));
        await this.alertUnknownSms(id, template.id, address);
        return { status: "send_unknown", notificationId: id, reason: reason.slice(0, 300) };
      }
      await this.bookkeeping(id, "record the failure", () => this.deps.store.update(id, { status: "failed", error: message }));
      return { status: "failed", notificationId: id, reason: message.slice(0, 300) };
    }

    // Bookkeeping after a successful send. If every write fails the row stays
    // "queued", which is not retryable, so the message is still never resent.
    const sentAt = this.now().toISOString();
    await this.bookkeeping(id, "record the send", () => this.deps.store.update(id, { status: "sent", provider: client.name, providerMessageId, sentAt, error: null }));
    if (built.channel === "sms" && this.deps.sms) {
      await this.deps.store
        .recordSms({
          direction: "outbound",
          fromNumber: this.deps.sms.fromNumber,
          toNumber: address,
          body: built.body,
          status: "sent",
          providerMessageId,
          notificationId: id,
          leadId: req.leadId ?? null,
        })
        .catch((err) => console.error("notify: could not record outbound sms", err instanceof Error ? err.message : err));
    }
    return { status: "sent", notificationId: id, providerMessageId };
  }

  /** Runs a post-send store write, retrying a few times; logs and gives up rather than throwing. */
  private async bookkeeping(id: string, what: string, write: () => Promise<unknown>): Promise<boolean> {
    for (let attempt = 1; attempt <= BOOKKEEPING_ATTEMPTS; attempt++) {
      try {
        await write();
        return true;
      } catch (err) {
        if (attempt === BOOKKEEPING_ATTEMPTS) {
          console.error(`notify: could not ${what} for notification ${id} after ${attempt} attempts`, err instanceof Error ? err.message : err);
        }
      }
    }
    return false;
  }

  /** Tells staff a text may or may not have gone out (pre-approved staff_alert; masked number and ids only). Never throws. */
  private async alertUnknownSms(id: string, templateId: TemplateId, phone: string): Promise<void> {
    const emails = this.deps.staffEmails ?? [];
    if (emails.length === 0) {
      console.error(`notify: text ${id} (${templateId}) to ${maskPhone(phone)} may or may not have been delivered; no staff mailbox to alert`);
      return;
    }
    await Promise.all(
      emails.map((email) =>
        this.send({
          templateId: "staff_alert",
          to: { audience: "staff", email },
          data: {
            title: "Text message delivery unknown",
            lines: [
              `A ${templateId} text to ${maskPhone(phone)} hit a timeout or provider error, so it may or may not have been delivered.`,
              "It will not be resent automatically. Check the Telnyx message log before sending it again by hand.",
              `Notification ${id}`,
            ],
          },
          idempotencyKey: `notify-unknown:${id}:${email}`,
          requestedBy: "system:notify",
          metadata: { notificationId: id },
        }).catch((err) => {
          console.error("notify: could not alert staff about a text with unknown delivery", err instanceof Error ? err.message : err);
        }),
      ),
    );
  }
}
