import { describe, expect, it } from "vitest";
import { FakeEmailClient } from "@/lib/notify/email/fake";
import { emailLenderMailer, textToHtml } from "./mailer";

describe("emailLenderMailer", () => {
  it("is null without an email client", () => {
    expect(emailLenderMailer(null)).toBeNull();
  });

  it("sends text plus escaped HTML with the idempotency key", async () => {
    const client = new FakeEmailClient();
    const mailer = emailLenderMailer(client)!;
    const r = await mailer.send({ to: "lender@example.com", subject: "Notice", text: "Hello <b>&\n\nSecond", idempotencyKey: "lender_notice:x" });
    expect(r.messageId).toBe(client.sent[0]!.providerMessageId);
    expect(client.sent[0]).toMatchObject({ to: "lender@example.com", subject: "Notice", text: "Hello <b>&\n\nSecond", idempotencyKey: "lender_notice:x" });
    expect(client.sent[0]!.html).toContain("<p>Hello &lt;b&gt;&amp;</p>");
  });

  it("keeps single line breaks", () => {
    expect(textToHtml("a\nb")).toContain("<p>a<br>b</p>");
  });
});
