// The BoldSign webhook route: an MLDS sent through the fallback provider must
// be able to reach 'signed'. Without Supabase the route verifies the signature
// and then asks BoldSign to redeliver (503), never acknowledging a lost event.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));

const { BOLDSIGN_SIGNATURE_HEADER } = await import("@/lib/esign/boldsign");
const { POST } = await import("./route");

const completed = () => JSON.stringify({ event: { id: "evt_1", eventType: "Completed", created: Math.floor(Date.now() / 1000) }, data: { documentId: "doc_1" } });
const post = (body: string, secret: string) => {
  const t = Math.floor(Date.now() / 1000);
  const s0 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return POST(new Request("https://corincommercial.com/api/webhooks/boldsign", { method: "POST", body, headers: { [BOLDSIGN_SIGNATURE_HEADER]: `t=${t}, s0=${s0}`, "content-type": "application/json" } }));
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const k of ["ESIGN_PROVIDER", "ZOHO_SIGN_CLIENT_ID", "ZOHO_SIGN_CLIENT_SECRET", "ZOHO_SIGN_REFRESH_TOKEN", "BOLDSIGN_API_KEY", "BOLDSIGN_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/boldsign", () => {
  it("answers 503 until BoldSign and its webhook secret are configured", async () => {
    expect((await post(completed(), "s")).status).toBe(503);
    vi.stubEnv("BOLDSIGN_API_KEY", "key");
    const res = await post(completed(), "s");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "E-sign webhook not configured" });
  });

  it("rejects a forged signature", async () => {
    vi.stubEnv("ESIGN_PROVIDER", "boldsign");
    vi.stubEnv("BOLDSIGN_API_KEY", "key");
    vi.stubEnv("BOLDSIGN_WEBHOOK_SECRET", "real-secret");
    expect((await post(completed(), "wrong-secret")).status).toBe(401);
  });

  it("verifies BOLDSIGN_WEBHOOK_SECRET and hands the event to the disclosure pipeline", async () => {
    vi.stubEnv("ESIGN_PROVIDER", "boldsign");
    vi.stubEnv("BOLDSIGN_API_KEY", "key");
    vi.stubEnv("BOLDSIGN_WEBHOOK_SECRET", "real-secret");
    // Signature accepted; storage is not configured in this test, so BoldSign is asked to retry.
    const res = await post(completed(), "real-secret");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Storage unavailable" });
  });

  it("still accepts BoldSign events after ESIGN_PROVIDER moves back to Zoho Sign", async () => {
    vi.stubEnv("ZOHO_SIGN_CLIENT_ID", "a");
    vi.stubEnv("ZOHO_SIGN_CLIENT_SECRET", "b");
    vi.stubEnv("ZOHO_SIGN_REFRESH_TOKEN", "c");
    vi.stubEnv("BOLDSIGN_API_KEY", "key");
    vi.stubEnv("BOLDSIGN_WEBHOOK_SECRET", "real-secret");
    expect((await post(completed(), "real-secret")).status).toBe(503);
    expect((await post(completed(), "wrong")).status).toBe(401);
  });
});
