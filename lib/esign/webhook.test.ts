import { beforeEach, describe, expect, it } from "vitest";
import { FakeApprovalGate } from "@/lib/compliance/approval-gate";
import { generateMlds, openMldsCase, recordUetaConsent, sendMlds } from "@/lib/disclosures/service";
import { MemoryDisclosureStore, MemoryDocumentStorage } from "@/lib/disclosures/store";
import { sampleMldsInput } from "@/lib/disclosures/test-fixtures";
import { UETA_CONSENT_VERSION } from "@/lib/disclosures/ueta";
import { FakeEsignProvider } from "./fake";
import { MAX_WEBHOOK_BYTES, handleEsignWebhook, type WebhookDeps } from "./webhook";
import { ZOHO_SIGNATURE_HEADER, signZohoPayload } from "./zoho-sign";

const now = () => new Date("2026-11-03T18:00:00Z");
let store: MemoryDisclosureStore;
let storage: MemoryDocumentStorage;
let provider: FakeEsignProvider;
let requestId: string;
let disclosureId: string;

const post = (body: string, headers: Headers) => new Request("https://kuberacommercial.com/api/webhooks/zoho-sign", { method: "POST", body, headers });
const deps = (over: Partial<WebhookDeps> = {}): WebhookDeps => ({ provider, secretConfigured: true, backends: { store, storage }, now, ...over });

beforeEach(async () => {
  store = new MemoryDisclosureStore();
  storage = new MemoryDocumentStorage();
  provider = new FakeEsignProvider("zs-secret");
  const { record } = await openMldsCase(
    { store, now },
    { leadId: "11111111-1111-4111-8111-111111111111", facts: { kuberaRole: "broker", collateral: { realPropertyLien: true } }, applicationCompletedAt: now(), actor: "staff" },
  );
  disclosureId = record?.id as string;
  await generateMlds({ store, storage, render: async () => new Uint8Array([1, 2, 3]), now, approvedTemplate: true }, disclosureId, sampleMldsInput, "staff");
  for (const b of sampleMldsInput.borrowers) await recordUetaConsent({ store, now }, disclosureId, { textVersion: UETA_CONSENT_VERSION, consentedAt: now().toISOString(), email: b.email });
  const sent = await sendMlds(
    { store, provider, gate: new FakeApprovalGate(), now, templateId: "t", brokerSigner: { name: "N", email: "n@k.co" }, approvedTemplate: true },
    disclosureId,
    "staff",
  );
  requestId = sent.record.providerRequestId as string;
});

describe("e-sign webhook handler", () => {
  it("accepts a correctly signed completion and marks the MLDS signed", async () => {
    const hook = provider.webhook(requestId, "completed");
    const res = await handleEsignWebhook(post(hook.body, hook.headers), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "transitioned" });
    expect((await store.get(disclosureId))?.status).toBe("signed");
  });

  it("rejects a forged signature without touching state", async () => {
    const hook = provider.webhook(requestId, "completed");
    const res = await handleEsignWebhook(post(hook.body, new Headers({ [ZOHO_SIGNATURE_HEADER]: signZohoPayload(hook.body, "wrong-secret") })), deps());
    expect(res.status).toBe(401);
    expect((await store.get(disclosureId))?.status).toBe("sent");
  });

  it("rejects a tampered body", async () => {
    const hook = provider.webhook(requestId, "completed");
    const res = await handleEsignWebhook(post(hook.body.replace(requestId, "fake_req_999"), hook.headers), deps());
    expect(res.status).toBe(401);
  });

  it("rejects a missing signature", async () => {
    const hook = provider.webhook(requestId, "completed");
    expect((await handleEsignWebhook(post(hook.body, new Headers()), deps())).status).toBe(401);
  });

  it("acknowledges duplicates", async () => {
    const hook = provider.webhook(requestId, "completed");
    await handleEsignWebhook(post(hook.body, hook.headers), deps());
    const res = await handleEsignWebhook(post(hook.body, hook.headers), deps());
    expect(await res.json()).toEqual({ ok: true, outcome: "duplicate" });
  });

  it("returns 503 when not configured so nothing is processed unverified", async () => {
    const hook = provider.webhook(requestId, "completed");
    expect((await handleEsignWebhook(post(hook.body, hook.headers), deps({ provider: null }))).status).toBe(503);
    expect((await handleEsignWebhook(post(hook.body, hook.headers), deps({ secretConfigured: false }))).status).toBe(503);
  });

  it("asks for a retry when storage is unavailable", async () => {
    const hook = provider.webhook(requestId, "completed");
    expect((await handleEsignWebhook(post(hook.body, hook.headers), deps({ backends: null }))).status).toBe(503);
  });

  it("rejects oversized payloads", async () => {
    const big = "x".repeat(MAX_WEBHOOK_BYTES + 1);
    const res = await handleEsignWebhook(post(big, new Headers({ [ZOHO_SIGNATURE_HEADER]: signZohoPayload(big, "zs-secret") })), deps());
    expect(res.status).toBe(413);
  });

  it("acknowledges verified non-signing payloads", async () => {
    const body = JSON.stringify({ ping: true });
    const res = await handleEsignWebhook(post(body, new Headers({ [ZOHO_SIGNATURE_HEADER]: signZohoPayload(body, "zs-secret") })), deps());
    expect(await res.json()).toEqual({ ok: true, ignored: true });
  });

  it("returns 500 (provider retries) when processing fails", async () => {
    const hook = provider.webhook(requestId, "completed");
    const failing = { ...storage, put: async () => Promise.reject(new Error("bucket down")) };
    const res = await handleEsignWebhook(post(hook.body, hook.headers), deps({ backends: { store, storage: failing } }));
    expect(res.status).toBe(500);
    expect((await store.get(disclosureId))?.status).toBe("sent");
  });

  it("hands requests that are not disclosures to the deal desk hook (SBA Form 159)", async () => {
    const completed = (id: string) => {
      const body = JSON.stringify({
        requests: { request_id: id, request_status: "completed", request_name: "SBA Form 159" },
        notifications: { operation_type: "RequestCompleted", performed_by_email: "a@b.co", performed_at: now().getTime() },
      });
      return post(body, new Headers({ [ZOHO_SIGNATURE_HEADER]: signZohoPayload(body, "zs-secret") }));
    };
    const seen: string[] = [];
    const res = await handleEsignWebhook(completed("form159-request"), deps({ otherRequest: async (e) => (seen.push(e.requestId), true) }));
    expect(await res.json()).toEqual({ ok: true, outcome: "other_request" });
    expect(seen).toEqual(["form159-request"]);
    expect((await store.get(disclosureId))?.status).toBe("sent");

    const res2 = await handleEsignWebhook(completed("nobody-knows"), deps({ otherRequest: async () => false }));
    expect(await res2.json()).toEqual({ ok: true, outcome: "unknown_request" });
  });
});
