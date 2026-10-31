import { buildConsentEvent, type ConsentLedger } from "@/lib/consent/ledger";
import { isApproved, type ApprovalGate } from "@/lib/compliance/approval-gate";
import type { EmailClient } from "@/lib/notify/email/types";
import { AudienceError, type AudienceClient } from "./audience";
import { newsletterConsentText, resolveNewsletterConsent } from "./consent";
import { NEWSLETTER_CONFIRMATION_TEMPLATE, renderNewsletterConfirmation } from "./email";
import type { Subscriber, SubscriberStore } from "./store";
import { CONFIRM_TTL_SECONDS, signToken, verifyToken, type TokenFailure } from "./tokens";

// Newsletter signup with double opt-in.
//
//   subscribe    validate -> consent ledger 'granted' -> pending row -> confirmation email
//   confirm      verify the emailed link -> ledger 'confirmed' -> row confirmed -> Resend audience
//   unsubscribe  verify the link (or a Resend unsubscribe event) -> ledger 'revoked' -> audience flag
//
// Nothing is added to the audience, and no newsletter can reach an address,
// until that address has been confirmed. The confirmation email is the only
// message this module sends; it goes through the approval gate like every
// outbound message (Global rule 2).

export const CONFIRMATION_COOLDOWN_MS = 10 * 60_000;

/** Templates a broker has pre-approved for automatic sending, as "<id>@<version>". */
export const NEWSLETTER_PREAPPROVED: ReadonlySet<string> = new Set([`${NEWSLETTER_CONFIRMATION_TEMPLATE.id}@${NEWSLETTER_CONFIRMATION_TEMPLATE.version}`]);

export type NewsletterDeps = {
  store: SubscriberStore;
  ledger: ConsentLedger;
  /** Null when RESEND_API_KEY is unset: signups are refused rather than silently dropped. */
  email: EmailClient | null;
  /** Null when no audience is configured: confirmations are recorded and flagged for a later sync. */
  audience: AudienceClient | null;
  gate: ApprovalGate;
  /** Null when no signing secret is configured. */
  tokenSecret: string | null;
  /** Site origin used in emailed links, e.g. https://kuberacommercial.com. */
  baseUrl: string;
  contactEmail: string;
  preApproved?: ReadonlySet<string>;
  now?: () => Date;
};

export type RequestContext = { ip?: string | null; userAgent?: string | null; page?: string | null };

export type SubscribeInput = RequestContext & { email: string; textVersion?: string | null };

export type SubscribeOutcome =
  | { status: "pending_confirmation" }
  | { status: "already_subscribed" }
  | { status: "throttled" }
  | { status: "invalid_email" }
  | { status: "unavailable"; reason: string };

export type ConfirmOutcome = { status: "confirmed" | "already_confirmed" } | { status: "invalid"; reason: TokenFailure | "unknown_subscriber" | "unsubscribed" } | { status: "unavailable"; reason: string };

export type UnsubscribeOutcome = { status: "unsubscribed" | "already_unsubscribed" } | { status: "invalid"; reason: TokenFailure | "unknown_subscriber" } | { status: "unavailable"; reason: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-cased address, or null if it is not a plausible email. */
export function normalizeNewsletterEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v && v.length <= 200 && EMAIL_RE.test(v) ? v : null;
}

export class NewsletterService {
  private readonly now: () => Date;

  constructor(private readonly deps: NewsletterDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // --- subscribe -------------------------------------------------------------------------

  async subscribe(input: SubscribeInput): Promise<SubscribeOutcome> {
    const email = normalizeNewsletterEmail(input.email);
    if (!email) return { status: "invalid_email" };
    if (!this.deps.email) return { status: "unavailable", reason: "email is not configured" };
    if (!this.deps.tokenSecret) return { status: "unavailable", reason: "no token secret is configured" };

    try {
      const existing = await this.deps.store.findByEmail(email);
      if (existing?.status === "confirmed") return { status: "already_subscribed" };
      if (existing?.status === "pending" && existing.confirmationSentAt && this.now().getTime() - Date.parse(existing.confirmationSentAt) < CONFIRMATION_COOLDOWN_MS) {
        return { status: "throttled" };
      }

      // Evidence first: if the ledger cannot record the grant, nothing else happens.
      const text = resolveNewsletterConsent(input.textVersion);
      const granted = await this.deps.ledger.record(
        buildConsentEvent({ text, eventType: "granted", email, ip: input.ip, userAgent: input.userAgent, page: input.page ?? "/newsletter", now: this.now() }),
      );

      let subscriber: Subscriber;
      if (existing) {
        subscriber = await this.deps.store.update(existing.id, {
          status: "pending",
          sourcePage: input.page ?? existing.sourcePage,
          consentTextVersion: text.id,
          signupConsentEventId: granted.id,
        });
      } else {
        subscriber = await this.deps.store.create({ email, sourcePage: input.page ?? null, consentTextVersion: text.id, signupConsentEventId: granted.id });
      }
      return await this.sendConfirmation(subscriber);
    } catch (err) {
      console.error("newsletter subscribe failed", err instanceof Error ? err.message : err);
      return { status: "unavailable", reason: "internal error" };
    }
  }

  private async sendConfirmation(subscriber: Subscriber): Promise<SubscribeOutcome> {
    const { email: mailer, tokenSecret } = this.deps;
    if (!mailer || !tokenSecret) return { status: "unavailable", reason: "email is not configured" };

    const token = signToken(tokenSecret, "confirm", subscriber.id, { ttlSeconds: CONFIRM_TTL_SECONDS, now: this.now() });
    const confirmUrl = `${this.deps.baseUrl.replace(/\/+$/, "")}/newsletter/confirm?token=${encodeURIComponent(token)}`;
    const message = await renderNewsletterConfirmation({ confirmUrl, contactEmail: this.deps.contactEmail });

    // Approval gate: a pre-approved template version sends; any other version waits for a broker.
    const templateKey = `${NEWSLETTER_CONFIRMATION_TEMPLATE.id}@${NEWSLETTER_CONFIRMATION_TEMPLATE.version}`;
    const idempotencyKey = `newsletter-confirm:${subscriber.id}:${subscriber.confirmationCount + 1}`;
    if (!(this.deps.preApproved ?? NEWSLETTER_PREAPPROVED).has(templateKey)) {
      const decision = await this.deps.gate.request({
        kind: "email",
        idempotencyKey,
        summary: "Newsletter double opt-in confirmation email",
        templateId: templateKey,
        payload: { channel: "email", to: subscriber.email, subscriberId: subscriber.id },
        requestedBy: "newsletter",
      });
      if (!isApproved(decision)) return { status: "unavailable", reason: `confirmation email is ${decision.status} in the approval queue` };
    }

    await mailer.send({
      to: subscriber.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      idempotencyKey,
      tags: { template: `${NEWSLETTER_CONFIRMATION_TEMPLATE.id}_v${NEWSLETTER_CONFIRMATION_TEMPLATE.version}`, kind: "newsletter-confirmation" },
    });
    await this.deps.store.update(subscriber.id, { confirmationSentAt: this.now().toISOString(), confirmationCount: subscriber.confirmationCount + 1 });
    return { status: "pending_confirmation" };
  }

  // --- confirm -------------------------------------------------------------------------------

  async confirm(token: string, ctx: RequestContext = {}): Promise<ConfirmOutcome> {
    if (!this.deps.tokenSecret) return { status: "unavailable", reason: "no token secret is configured" };
    const verified = verifyToken(this.deps.tokenSecret, token, { now: this.now() });
    if (!verified.ok) return { status: "invalid", reason: verified.reason };
    if (verified.purpose !== "confirm") return { status: "invalid", reason: "malformed" };

    try {
      const subscriber = await this.deps.store.findById(verified.subscriberId);
      if (!subscriber) return { status: "invalid", reason: "unknown_subscriber" };
      if (subscriber.status === "confirmed") return { status: "already_confirmed" };
      if (subscriber.status === "unsubscribed") return { status: "invalid", reason: "unsubscribed" };

      const text = newsletterConsentText(subscriber.consentTextVersion) ?? resolveNewsletterConsent();
      const confirmed = await this.deps.ledger.record(
        buildConsentEvent({ text, eventType: "confirmed", email: subscriber.email, ip: ctx.ip, userAgent: ctx.userAgent, page: ctx.page ?? "/newsletter/confirm", now: this.now() }),
      );
      const updated = await this.deps.store.update(subscriber.id, {
        status: "confirmed",
        confirmedAt: this.now().toISOString(),
        confirmedConsentEventId: confirmed.id,
        unsubscribedAt: null,
      });
      await this.syncAudience(updated, false);
      return { status: "confirmed" };
    } catch (err) {
      console.error("newsletter confirm failed", err instanceof Error ? err.message : err);
      return { status: "unavailable", reason: "internal error" };
    }
  }

  // --- unsubscribe ---------------------------------------------------------------------------

  async unsubscribeWithToken(token: string, ctx: RequestContext = {}): Promise<UnsubscribeOutcome> {
    if (!this.deps.tokenSecret) return { status: "unavailable", reason: "no token secret is configured" };
    const verified = verifyToken(this.deps.tokenSecret, token, { now: this.now() });
    if (!verified.ok) return { status: "invalid", reason: verified.reason };
    if (verified.purpose !== "unsubscribe") return { status: "invalid", reason: "malformed" };
    try {
      const subscriber = await this.deps.store.findById(verified.subscriberId);
      if (!subscriber) return { status: "invalid", reason: "unknown_subscriber" };
      return await this.unsubscribe(subscriber, ctx);
    } catch (err) {
      console.error("newsletter unsubscribe failed", err instanceof Error ? err.message : err);
      return { status: "unavailable", reason: "internal error" };
    }
  }

  /** An unsubscribe reported by Resend (the link in a broadcast). Unknown addresses are ignored. */
  async unsubscribeByEmail(rawEmail: string, ctx: RequestContext = {}): Promise<UnsubscribeOutcome> {
    const email = normalizeNewsletterEmail(rawEmail);
    if (!email) return { status: "invalid", reason: "unknown_subscriber" };
    try {
      const subscriber = await this.deps.store.findByEmail(email);
      if (!subscriber) return { status: "invalid", reason: "unknown_subscriber" };
      return await this.unsubscribe(subscriber, { page: "/webhooks/resend", ...ctx });
    } catch (err) {
      console.error("newsletter unsubscribe failed", err instanceof Error ? err.message : err);
      return { status: "unavailable", reason: "internal error" };
    }
  }

  /** A signed unsubscribe link for a subscriber, for emails Kubera composes itself. */
  unsubscribeUrl(subscriberId: string): string | null {
    if (!this.deps.tokenSecret) return null;
    return `${this.deps.baseUrl.replace(/\/+$/, "")}/newsletter/unsubscribe?token=${encodeURIComponent(signToken(this.deps.tokenSecret, "unsubscribe", subscriberId))}`;
  }

  private async unsubscribe(subscriber: Subscriber, ctx: RequestContext): Promise<UnsubscribeOutcome> {
    if (subscriber.status === "unsubscribed") return { status: "already_unsubscribed" };
    const text = newsletterConsentText(subscriber.consentTextVersion) ?? resolveNewsletterConsent();
    // A revocation is a new ledger row; the earlier grant is never edited.
    await this.deps.ledger.record(
      buildConsentEvent({ text, eventType: "revoked", email: subscriber.email, ip: ctx.ip, userAgent: ctx.userAgent, page: ctx.page ?? "/newsletter/unsubscribe", now: this.now() }),
    );
    const updated = await this.deps.store.update(subscriber.id, { status: "unsubscribed", unsubscribedAt: this.now().toISOString() });
    // Pending addresses were never added to the audience, so there is nothing to flag.
    if (subscriber.status === "confirmed") await this.syncAudience(updated, true);
    return { status: "unsubscribed" };
  }

  // --- audience ------------------------------------------------------------------------------

  /** Keeps the Resend audience in step. A failure is recorded on the row and never undoes the consent change. */
  private async syncAudience(subscriber: Subscriber, unsubscribed: boolean): Promise<void> {
    const audience = this.deps.audience;
    if (!audience) {
      await this.deps.store.update(subscriber.id, { audienceError: "audience not configured" });
      return;
    }
    try {
      const { contactId } = await audience.upsert({ email: subscriber.email, unsubscribed });
      await this.deps.store.update(subscriber.id, { resendContactId: contactId ?? subscriber.resendContactId, audienceSyncedAt: this.now().toISOString(), audienceError: null });
    } catch (err) {
      const message = err instanceof AudienceError || err instanceof Error ? err.message : String(err);
      console.error("newsletter audience sync failed", message);
      await this.deps.store.update(subscriber.id, { audienceError: message.slice(0, 1_000) });
    }
  }
}
