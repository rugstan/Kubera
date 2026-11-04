// Outbound mail for the deal desk (lender submissions, gate-H lender notices,
// invoices) on the WS-J transactional email client (Cloudflare Email Service
// or Resend, chosen from env in lib/notify/email). Plain-text messages; the
// HTML part is the same text, escaped. Without an email provider there is no
// mailer and the desk falls back to broker-sent mail. Mail to lenders also
// needs LENDER_EMAIL_ENABLED=true (lenderEmailEnabled, off by default); until
// then lenders only get what staff send from their own mailbox.
//
// Each of these sends claims its broker approval first, so a failed or
// timed-out send is never repeated automatically: the next check reports the
// approval as used and hands the text to staff. Before sending it by hand
// after an error, check the provider's log (Cloudflare takes no idempotency
// key, so a timed-out send may already have been delivered).

import type { EmailClient } from "@/lib/notify/email";
import type { LenderMailer } from "./packages";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  const body = text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;font-size:14px;line-height:1.5">${body}</div>`;
}

/**
 * Whether the desk may email lenders at all: lender submissions, gate-H lender
 * notices, invoices billed to a lender and the lender-matching agent's
 * outreach. Off unless LENDER_EMAIL_ENABLED is "true" (owner decision,
 * 2026-11-03: no email to lenders for now). While it is off those flows work
 * as they do with no email provider: after broker approval staff get the
 * share link or the text and send it themselves, then record it as sent.
 */
export function lenderEmailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LENDER_EMAIL_ENABLED?.trim().toLowerCase() === "true";
}

/** A LenderMailer on an email client; null client → null mailer. */
export function emailLenderMailer(client: EmailClient | null): LenderMailer | null {
  if (!client) return null;
  return {
    async send(msg) {
      const { providerMessageId } = await client.send({
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: textToHtml(msg.text),
        idempotencyKey: msg.idempotencyKey,
        tags: { source: "deal_desk" },
      });
      return { messageId: providerMessageId };
    },
  };
}
