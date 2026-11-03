import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeEmailClient } from "@/lib/notify/email/fake";
import { emailLenderMailer, lenderEmailEnabled, textToHtml } from "./mailer";

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

describe("email to lenders switch", () => {
  it("is off unless LENDER_EMAIL_ENABLED is exactly true", () => {
    expect(lenderEmailEnabled({})).toBe(false);
    expect(lenderEmailEnabled({ LENDER_EMAIL_ENABLED: "" })).toBe(false);
    expect(lenderEmailEnabled({ LENDER_EMAIL_ENABLED: "1" })).toBe(false);
    expect(lenderEmailEnabled({ LENDER_EMAIL_ENABLED: "yes" })).toBe(false);
    expect(lenderEmailEnabled({ LENDER_EMAIL_ENABLED: "false" })).toBe(false);
    expect(lenderEmailEnabled({ LENDER_EMAIL_ENABLED: "true" })).toBe(true);
    expect(lenderEmailEnabled({ LENDER_EMAIL_ENABLED: " TRUE " })).toBe(true);
  });

  // Every flow that writes to a lender must take the switched mailer (lenderMailer), never the borrower one.
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the deal desk actions give lender submissions and lender notices only the lender mailer", () => {
    const src = read("app/(staff)/deals/actions.ts");
    for (const call of ["sendPackageToLender(", "checkOutreachApproval(", "submitModification("]) {
      const at = src.indexOf(call);
      expect(at, call).toBeGreaterThan(-1);
      const args = src.slice(at, src.indexOf(");", at));
      expect(args, call).toContain("mailer: rt.lenderMailer");
      expect(args, call).not.toMatch(/mailer: rt\.mailer\b/);
    }
    const modDeps = /const deps = \{ store: rt\.store, gate: rt\.gate, now: rt\.now, mailer: rt\.(\w+) \};/.exec(src);
    expect(modDeps?.[1]).toBe("lenderMailer");
    // The only borrower-mailer use is the invoice, which also carries the lender mailer for lender-billed invoices.
    expect(src.match(/mailer: rt\.mailer\b/g)).toHaveLength(1);
    expect(src).toContain("mailer: rt.mailer, lenderMailer: rt.lenderMailer");
  });

  it("the lender-matching agent sends only through the lender mailer", () => {
    const src = read("lib/agents/lenders/runtime.ts");
    expect(src).not.toMatch(/desk\.mailer\b/);
    expect(src.match(/mailer: desk\.lenderMailer/g)?.length).toBeGreaterThan(0);
  });

  it("the runtime builds the lender mailer only behind the switch", () => {
    const src = read("lib/deals/runtime.ts");
    expect(src).toContain("lenderMailer: lenderEmailEnabled() ? mailer : null");
  });
});
