import { describe, expect, it, vi } from "vitest";
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

  it("prefers Zoho Sign, falls back to BoldSign", () => {
    expect(esignProviderFromEnv({ NODE_ENV: "test", ...zoho, BOLDSIGN_API_KEY: "k" })?.name).toBe("zoho_sign");
    expect(esignProviderFromEnv({ NODE_ENV: "test", BOLDSIGN_API_KEY: "k" })?.name).toBe("boldsign");
    expect(esignProviderFromEnv({ NODE_ENV: "test", ...zoho, BOLDSIGN_API_KEY: "k", ESIGN_PROVIDER: "boldsign" })?.name).toBe("boldsign");
  });

  it("resolves the MLDS template id per provider", () => {
    expect(mldsTemplateId("zoho_sign", { NODE_ENV: "test", ZOHO_SIGN_MLDS_TEMPLATE_ID: "z1" })).toBe("z1");
    expect(mldsTemplateId("boldsign", { NODE_ENV: "test" })).toBeNull();
    expect(mldsTemplateId("fake", { NODE_ENV: "test" })).toBe("fake_mlds_template");
  });

  it("allows the fake outside production only", () => {
    expect(esignProviderFromEnv({ NODE_ENV: "test", ESIGN_PROVIDER: "fake" })?.name).toBe("fake");
    expect(() => esignProviderFromEnv({ NODE_ENV: "production", VERCEL_ENV: "production", ESIGN_PROVIDER: "fake" })).toThrow(/not allowed/);
  });
});
