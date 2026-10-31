// Outbound mail for the deal desk (lender submissions, gate-H lender notices,
// invoices) on the WS-J transactional email client (Resend). Plain-text
// messages; the HTML part is the same text, escaped. Without RESEND_API_KEY
// there is no mailer and the desk falls back to broker-sent mail.

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
