import { describe, expect, it, vi } from "vitest";
import type { FakeEsignProvider } from "./fake";
import { esignProviderFromEnv, mldsTemplateId } from "./index";

const zoho = { ZOHO_SIGN_CLIENT_ID: "a", ZOHO_SIGN_CLIENT_SECRET: "b", ZOHO_SIGN_REFRESH_TOKEN: "c" };

describe("e-sign provider selection", () => {
  it("returns null and warns once when nothing is configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(esignProviderFromEnv({ NODE_ENV: "test" })).toBeNull();
    expect(esignProviderFromEnv({ NODE_ENV: "test" })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("prefers Zoho Sign and uses BoldSign only when ESIGN_PROVIDER=boldsign", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(esignProviderFromEnv({ NODE_ENV: "test", ...zoho, BOLDSIGN_API_KEY: "k" })?.name).toBe("zoho_sign");
    // A BoldSign key alone does not select it: an MLDS sent there would need its webhook set up first.
    expect(esignProviderFromEnv({ NODE_ENV: "test", BOLDSIGN_API_KEY: "k" })).toBeNull();
    expect(esignProviderFromEnv({ NODE_ENV: "test", BOLDSIGN_API_KEY: "k", ESIGN_PROVIDER: "boldsign" })?.name).toBe("boldsign");
    expect(esignProviderFromEnv({ NODE_ENV: "test", ...zoho, BOLDSIGN_API_KEY: "k", ESIGN_PROVIDER: "boldsign" })?.name).toBe("boldsign");
    warn.mockRestore();
  });

  it("resolves the MLDS template id per provider", () => {
    expect(mldsTemplateId("zoho_sign", { NODE_ENV: "test", ZOHO_SIGN_MLDS_TEMPLATE_ID: "z1" })).toBe("z1");
    expect(mldsTemplateId("boldsign", { NODE_ENV: "test" })).toBeNull();
    expect(mldsTemplateId("fake", { NODE_ENV: "test" })).toBe("fake_mlds_template");
  });

  it("allows the fake only outside production and without the Supabase service role", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(esignProviderFromEnv({ NODE_ENV: "test", ESIGN_PROVIDER: "fake" })?.name).toBe("fake");
    expect(esignProviderFromEnv({ NODE_ENV: "production", VERCEL_ENV: "preview", ESIGN_PROVIDER: "fake" })?.name).toBe("fake");
    expect(esignProviderFromEnv({ NODE_ENV: "production", VERCEL_ENV: "production", ESIGN_PROVIDER: "fake" })).toBeNull();
    expect(esignProviderFromEnv({ NODE_ENV: "test", DEPLOY_ENV: "production", ESIGN_PROVIDER: "fake" })).toBeNull();
    expect(esignProviderFromEnv({ NODE_ENV: "production", VERCEL_ENV: "preview", ESIGN_PROVIDER: "fake", SUPABASE_SERVICE_ROLE_KEY: "service-role" })).toBeNull();
    expect(esignProviderFromEnv({ NODE_ENV: "test", ESIGN_PROVIDER: "fake", SUPABASE_SERVICE_ROLE_KEY: "service-role" })).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/not allowed in production/);
    error.mockRestore();
  });

  it("never gives an env-built fake the public default webhook secret", () => {
    const fallback = esignProviderFromEnv({ NODE_ENV: "test", ESIGN_PROVIDER: "fake" }) as FakeEsignProvider;
    expect(fallback.webhookSecret).not.toBe("fake-webhook-secret");
    expect(fallback.webhookSecret.length).toBeGreaterThanOrEqual(32);
    const explicit = esignProviderFromEnv({ NODE_ENV: "test", ESIGN_PROVIDER: "fake", ZOHO_SIGN_WEBHOOK_SECRET: "s" }) as FakeEsignProvider;
    expect(explicit.webhookSecret).toBe("s");
  });
});
