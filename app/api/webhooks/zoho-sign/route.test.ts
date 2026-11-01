// The Zoho Sign webhook route must never accept the fake provider's built-in
// test secret: with ESIGN_PROVIDER=fake against a real Supabase (or without an
// explicit webhook secret) anyone could HMAC a 'completed' payload with the
// public value and mark an MLDS signed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));

const { esignProviderFromEnv } = await import("@/lib/esign");
const { ZOHO_SIGNATURE_HEADER, signZohoPayload } = await import("@/lib/esign/zoho-sign");
const { POST } = await import("./route");

const DEFAULT_FAKE_SECRET = "fake-webhook-secret";
const completed = JSON.stringify({
  requests: { request_id: "fake_req_1", request_status: "completed", request_name: "MLDS" },
  notifications: { operation_type: "RequestCompleted", performed_by_email: "borrower@example.com", performed_at: 1_800_000_000_000 },
});
const ping = JSON.stringify({ ping: true });
const post = (body: string, secret: string) =>
  POST(new Request("https://kuberacommercial.com/api/webhooks/zoho-sign", { method: "POST", body, headers: { [ZOHO_SIGNATURE_HEADER]: signZohoPayload(body, secret), "content-type": "application/json" } }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("ESIGN_PROVIDER", "fake");
  for (const k of ["ZOHO_SIGN_CLIENT_ID", "ZOHO_SIGN_CLIENT_SECRET", "ZOHO_SIGN_REFRESH_TOKEN", "BOLDSIGN_API_KEY", "ZOHO_SIGN_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL_ENV", "DEPLOY_ENV"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/zoho-sign with ESIGN_PROVIDER=fake", () => {
  it("rejects a webhook signed with the default secret when the service-role key is present", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    expect(esignProviderFromEnv()).toBeNull();
    const res = await post(completed, DEFAULT_FAKE_SECRET);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "E-sign webhook not configured" });
  });

  it("rejects a webhook signed with the default secret even with an explicit secret configured", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.stubEnv("ZOHO_SIGN_WEBHOOK_SECRET", "real-secret");
    expect((await post(completed, DEFAULT_FAKE_SECRET)).status).toBe(503);
  });

  it("refuses the fake when no webhook secret is set, even in local development", async () => {
    const res = await post(completed, DEFAULT_FAKE_SECRET);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "E-sign webhook not configured" });
  });

  it("verifies only against the explicit ZOHO_SIGN_WEBHOOK_SECRET in local development", async () => {
    vi.stubEnv("ZOHO_SIGN_WEBHOOK_SECRET", "local-secret");
    expect((await post(completed, DEFAULT_FAKE_SECRET)).status).toBe(401);
    const ok = await post(ping, "local-secret");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, ignored: true });
  });
});
