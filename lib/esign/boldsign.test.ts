import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BOLDSIGN_SIGNATURE_HEADER, BoldSignProvider } from "./boldsign";
import type { FetchLike } from "./types";

describe("BoldSign adapter", () => {
  it("sends from a template with the API key and prefilled fields", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return Response.json({ documentId: "doc_1" });
    };
    const b = new BoldSignProvider({ apiKey: "key" }, fetchImpl);
    const created = await b.createFromTemplate({
      templateId: "tpl",
      requestName: "MLDS",
      recipients: [{ role: "Borrower 1", name: "B", email: "b@x.co", verifyByEmail: true }],
      fields: { principal_amount: "$1.00" },
      reference: "d1",
    });
    expect(created.requestId).toBe("doc_1");
    expect(calls[0]?.url).toBe("https://api.boldsign.com/v1/template/send?templateId=tpl");
    expect(new Headers(calls[0]?.init?.headers).get("x-api-key")).toBe("key");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.roles[0]).toMatchObject({ signerEmail: "b@x.co", authenticationType: "EmailOTP", existingFormFields: [{ id: "principal_amount", value: "$1.00" }] });
  });

  it("maps document status", async () => {
    const b = new BoldSignProvider({ apiKey: "k" }, async () => Response.json({ status: "Revoked" }));
    expect(await b.getStatus("d")).toBe("recalled");
  });

  it("verifies timestamped webhook signatures and rejects stale ones", () => {
    const now = 1_800_000_000_000;
    const b = new BoldSignProvider({ apiKey: "k", webhookSecret: "s" }, undefined, () => now);
    const body = JSON.stringify({ event: { id: "evt_1", eventType: "Completed", created: now / 1000 }, data: { documentId: "doc_1" } });
    const sign = (t: number) => `t=${t}, s0=${createHmac("sha256", "s").update(`${t}.${body}`).digest("hex")}`;
    expect(b.verifyWebhook(body, new Headers({ [BOLDSIGN_SIGNATURE_HEADER]: sign(now / 1000) }))).toBe(true);
    expect(b.verifyWebhook(body, new Headers({ [BOLDSIGN_SIGNATURE_HEADER]: sign(now / 1000 - 3600) }))).toBe(false);
    expect(b.verifyWebhook(`${body}x`, new Headers({ [BOLDSIGN_SIGNATURE_HEADER]: sign(now / 1000) }))).toBe(false);
    expect(b.parseWebhook(body)).toMatchObject({ provider: "boldsign", eventId: "evt_1", requestId: "doc_1", type: "completed" });
  });
});
