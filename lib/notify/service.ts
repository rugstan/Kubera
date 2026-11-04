import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { consentAllows, consentState, type ConsentReader } from "./consent";
import { EmailError, emailRetryIsSafe, maskEmail, type EmailClient } from "./email/types";
import { authorizeSend, type Authorization } from "./gate";
import { maskPhone, toE164 } from "./phone";
import { insideSmsWindow } from "./quiet-hours";
import { SmsError, smsFailureIsDefinitive, type SmsClient } from "./sms/types";
import type { NotificationRow, NotifyStore } from "./store";
import { templateById, type BuiltMessage, type TemplateDef, type TemplateId } from "./templates";
import { type Audience, type NotificationStatus, type Recipient, type SendOutcome } from "./types";

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
// A message held at step 6 is filed in the approvals queue under
// `notify:<idempotency key>`. When a broker approves it, the notify approval
// executor (lib/approvals/executors-server.ts) claims the approval once and
// calls sendApproved, which runs steps 3 to 7 with that claimed approval as the
// authorization; the notify sweep (lib/notify/approved.ts) is the backstop.
//
// Step 7 keeps the provider call apart from the bookkeeping. A message is marked
// "failed" (and so retryable) only when sending it again cannot deliver it
// twice: the provider certainly did not take it, or (Resend) it dedupes on the
// idempotency key. Telnyx /v2/messages and Cloudflare Email Service take no
// idempotency key, so retrying after a timeout, network error or 5xx that the
// provider in fact accepted would send a second text or email. Those end as
// "send_unknown", which is never retried, and staff are told to check (except
// for a staff alert itself, which is only logged). A carrier receipt saying a text was not delivered ends as
// "undelivered" (lib/notify/store.ts), also never retried. A database error
// after a successful send is retried as bookkeeping and logged; it never turns
// a sent message into "failed".

export type NotifierDeps = {
  email: EmailClient | null;
  sms: SmsClient | null;
  store: NotifyStore;
  consent: ConsentReader;
  gate: ApprovalGate;
  /** Extra "<template>@<version>" entries the broker pre-approved (NOTIFY_PREAPPROVED_TEMPLATES). */
  preApproved?: ReadonlySet<string>;
  /** Staff mailboxes told when a text or email may or may not have gone out (status send_unknown). */
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
 * written when nothing reached the provider, or when the provider dedupes on
 * the idempotency key (Resend), so a resend is safe. "send_unknown" and
 * "undelivered" are deliberately absent: a message the provider may have (or
 * did) take is never sent again automatically.
 */
export const RETRYABLE: readonly NotificationStatus[] = ["pending_approval", "deferred_quiet_hours", "skipped_no_consent", "skipped_unconfigured", "failed"];

/** Approvals for held notifications are filed under `notify:<notification idempotency key>`. */
export const NOTIFY_APPROVAL_PREFIX = "notify:";
export const notifyApprovalKey = (idempotencyKey: string) => `${NOTIFY_APPROVAL_PREFIX}${idempotencyKey}`;
export const isNotifyApproval = (record: { idempotencyKey: string }) => record.idempotencyKey.startsWith(NOTIFY_APPROVAL_PREFIX);

/** The approval fields sendApproved needs (an ApprovalRecord fits). */
export type ApprovedNotification = { id: string; idempotencyKey: string; status: string; executedAt: string | null; payload: Record<string, unknown> };

/** Row metadata key: the approval sendApproved claimed for this row (it authorizes a later retry). */
export const CLAIMED_APPROVAL = "claimedApprovalId";
export const claimedApprovalId = (row: Pick<NotificationRow, "metadata">): string | null => {
  const v = row.metadata?.[CLAIMED_APPROVAL];
  return typeof v === "string" ? v : null;
};

/** What the broker reviews and approves; sendApproved rebuilds the message from it. */
function approvalPayload(template: TemplateDef, recipient: string, audience: Audience, leadId: string | null, data: unknown): Record<string, unknown> {
  return { templateId: template.id, templateVersion: template.version, recipient, audience, leadId, data };
}

function templateByIdOrNull(id: string): TemplateDef | null {
  try {
    return templateById(id as TemplateId);
  } catch {
    return null;
  }
}

/** Tries for each post-send store write before it is logged and given up. */
const BOOKKEEPING_ATTEMPTS = 3;

const normalizeEmail = (e: string | null | undefined) => {
  const v = e?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 320 ? v : null;
};

type DeliveryContext = { id: string; template: TemplateDef; built: BuiltMessage; address: string; leadId: string | null; idempotencyKey: string };

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
    let current = row;
    if (!fresh) {
      if (!RETRYABLE.includes(row.status)) {
        return { status: "duplicate", notificationId: row.id, previousStatus: row.status, providerMessageId: row.providerMessageId ?? undefined };
      }
      // Exactly one concurrent retry wins the row.
      const reopened = await this.deps.store.reopen(row.id, RETRYABLE);
      if (!reopened) return { status: "duplicate", notificationId: row.id, previousStatus: row.status };
      current = reopened;
    }

    return this.deliver({ id: current.id, template, built, address, leadId: req.leadId ?? null, idempotencyKey: req.idempotencyKey }, async () => {
      const auth = await authorizeSend({
        template,
        channel: template.channel,
        gate: this.deps.gate,
        preApproved: this.deps.preApproved,
        idempotencyKey: notifyApprovalKey(req.idempotencyKey),
        summary: `Send "${template.id}" ${template.channel === "email" ? "email" : "text"} to ${template.channel === "email" ? address : maskPhone(address)}`,
        payload: approvalPayload(template, address, req.to.audience, req.leadId ?? null, req.data),
        requestedBy: req.requestedBy ?? "system:notify",
      });
      // The broker's approval was already claimed for this very message by
      // sendApproved, which then stopped before sending (quiet hours, provider
      // down): the queue reports it executed, but this row still holds it.
      if (!auth.ok && auth.status === "rejected" && auth.reason === "already_executed" && auth.approvalId && claimedApprovalId(current) === auth.approvalId) {
        return { ok: true, via: "broker_approval", approvalId: auth.approvalId };
      }
      return auth;
    });
  }

  /**
   * Sends a held notification under the broker approval that
   * ApprovalService.executeOnce already claimed for it (the notify approval
   * executor in lib/approvals/executors-server.ts, and the sweep in
   * lib/notify/approved.ts). It never asks the gate again: the claimed approval
   * is the authorization. The message is rebuilt from what the broker approved
   * (the approval payload), and consent and quiet hours are checked again. A
   * stop before the send (quiet hours, opted out, provider down) leaves the
   * claimed approval on the row, so a later attempt can still send it.
   */
  async sendApproved(approval: ApprovedNotification): Promise<SendOutcome> {
    if (!isNotifyApproval(approval)) return { status: "invalid", reason: "not a notification approval" };
    if (approval.status !== "approved" || !approval.executedAt) return { status: "invalid", reason: "approval is not approved and claimed" };
    const key = approval.idempotencyKey.slice(NOTIFY_APPROVAL_PREFIX.length);
    const row = await this.deps.store.findByKey(key);
    if (!row) return { status: "invalid", reason: "no notification is held for this approval" };
    if (!RETRYABLE.includes(row.status)) {
      return { status: "duplicate", notificationId: row.id, previousStatus: row.status, providerMessageId: row.providerMessageId ?? undefined };
    }
    if (row.approvalId !== approval.id && claimedApprovalId(row) !== approval.id) {
      return { status: "invalid", notificationId: row.id, reason: "the notification is held for a different approval" };
    }

    const p = approval.payload;
    const template = typeof p.templateId === "string" ? templateByIdOrNull(p.templateId) : null;
    if (
      !template ||
      p.templateVersion !== template.version ||
      p.channel !== template.channel ||
      row.templateId !== template.id ||
      row.templateVersion !== template.version ||
      row.channel !== template.channel ||
      p.recipient !== row.recipient ||
      p.audience !== row.audience ||
      !template.audiences.includes(row.audience)
    ) {
      const reason = "approval does not match the held notification";
      await this.deps.store.update(row.id, { status: "failed", error: reason });
      return { status: "invalid", notificationId: row.id, reason };
    }
    let built: BuiltMessage;
    try {
      built = await template.build(p.data);
    } catch (err) {
      const reason = `template data rejected: ${err instanceof Error ? err.message.slice(0, 300) : "unknown error"}`;
      await this.deps.store.update(row.id, { status: "failed", error: reason });
      return { status: "invalid", notificationId: row.id, reason };
    }

    const reopened = await this.deps.store.reopen(row.id, RETRYABLE);
    if (!reopened) return { status: "duplicate", notificationId: row.id, previousStatus: row.status };
    // Record that this row holds the claimed approval before anything can stop the send.
    await this.deps.store.update(row.id, { approvalId: approval.id, metadata: { ...reopened.metadata, [CLAIMED_APPROVAL]: approval.id } });
    return this.deliver({ id: row.id, template, built, address: row.recipient, leadId: row.leadId, idempotencyKey: key }, async () => ({
      ok: true,
      via: "broker_approval",
      approvalId: approval.id,
    }));
  }

  /** Steps 3 to 7 for a notification row this caller holds (status queued). `authorize` is step 6. */
  private async deliver(ctx: DeliveryContext, authorize: () => Promise<Authorization>): Promise<SendOutcome> {
    const { id, template, built, address } = ctx;
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
        console.error("notify: consent lookup failed; not sending", template.id, err instanceof Error ? err.message : err);
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
    const auth = await authorize();
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
        if (!this.deps.email) throw new EmailError("email provider is not configured", undefined, { notSent: true });
        ({ providerMessageId } = await this.deps.email.send({
          to: address,
          subject: built.subject,
          html: built.html,
          text: built.text,
          idempotencyKey: ctx.idempotencyKey,
          tags: { template: template.id },
        }));
      } else {
        if (!this.deps.sms) throw new SmsError("sms provider is not configured", undefined, { notSent: true });
        ({ providerMessageId } = await this.deps.sms.send({ to: address, text: built.body }));
      }
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
      console.error(`notify: ${template.channel} send failed (${template.id})`, message);
      const retrySafe = template.channel === "sms" ? smsFailureIsDefinitive(err) : emailRetryIsSafe(this.deps.email, err);
      if (!retrySafe) {
        // The provider may have accepted it and takes no idempotency key; sending again could deliver it twice.
        const reason = `delivery unknown, not retried: ${message}`.slice(0, 1000);
        await this.bookkeeping(id, "record send_unknown", () => this.deps.store.update(id, { status: "send_unknown", provider: client.name, error: reason }));
        await this.alertUnknownDelivery(id, template.id, template.channel, address);
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
          leadId: ctx.leadId,
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

  /**
   * Tells staff a text or email may or may not have gone out (pre-approved
   * staff_alert; masked address and ids only). A staff alert whose own delivery
   * is unknown is only logged, so alerts never chain. Never throws.
   */
  private async alertUnknownDelivery(id: string, templateId: TemplateId, channel: "email" | "sms", address: string): Promise<void> {
    const masked = channel === "sms" ? maskPhone(address) : maskEmail(address);
    const what = channel === "sms" ? "text" : "email";
    const emails = this.deps.staffEmails ?? [];
    if (templateId === "staff_alert" || emails.length === 0) {
      console.error(`notify: ${what} ${id} (${templateId}) to ${masked} may or may not have been delivered; ${templateId === "staff_alert" ? "not alerting about an alert" : "no staff mailbox to alert"}`);
      return;
    }
    const log = channel === "sms" ? "the Telnyx message log" : `the ${this.deps.email?.name === "cloudflare" ? "Cloudflare Email Sending activity log" : "email provider's log"}`;
    await Promise.all(
      emails.map((email) =>
        this.send({
          templateId: "staff_alert",
          to: { audience: "staff", email },
          data: {
            title: channel === "sms" ? "Text message delivery unknown" : "Email delivery unknown",
            lines: [
              `A ${templateId} ${what} to ${masked} hit a timeout or provider error, so it may or may not have been delivered.`,
              `It will not be resent automatically. Check ${log} before sending it again by hand.`,
              `Notification ${id}`,
            ],
          },
          idempotencyKey: `notify-unknown:${id}:${email}`,
          requestedBy: "system:notify",
          metadata: { notificationId: id },
        }).catch((err) => {
          console.error(`notify: could not alert staff about ${channel === "sms" ? "a text" : "an email"} with unknown delivery`, err instanceof Error ? err.message : err);
        }),
      ),
    );
  }
}
