import { describe, expect, it } from "vitest";
import { resolveAuthMode } from "./config";

const supabase = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };

describe("resolveAuthMode", () => {
  it("is disabled until Supabase Auth is configured", () => {
    expect(resolveAuthMode({})).toMatchObject({ mode: "disabled" });
    expect(resolveAuthMode({ SUPABASE_URL: "https://x.supabase.co" })).toMatchObject({ mode: "disabled", reason: expect.stringContaining("SUPABASE_ANON_KEY") });
    expect(resolveAuthMode({ ...supabase, SUPABASE_SERVICE_ROLE_KEY: "" })).toMatchObject({ mode: "disabled", reason: expect.stringContaining("SERVICE_ROLE") });
  });

  it("uses Supabase when configured (public anon key name accepted)", () => {
    expect(resolveAuthMode(supabase)).toEqual({ mode: "supabase", url: "https://x.supabase.co", anonKey: "anon" });
    expect(resolveAuthMode({ ...supabase, SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "pub" })).toMatchObject({ mode: "supabase", anonKey: "pub" });
    expect(resolveAuthMode({ ...supabase, AUTH_PROVIDER: "supabase" })).toMatchObject({ mode: "supabase" });
  });

  it("allows the fake provider only outside production", () => {
    expect(resolveAuthMode({ AUTH_PROVIDER: "fake" })).toEqual({ mode: "fake" });
    expect(resolveAuthMode({ AUTH_PROVIDER: "fake", NODE_ENV: "production" })).toEqual({ mode: "fake" });
    expect(resolveAuthMode({ AUTH_PROVIDER: "fake", VERCEL_ENV: "preview" })).toEqual({ mode: "fake" });
    expect(resolveAuthMode({ AUTH_PROVIDER: "fake", VERCEL_ENV: "production" })).toMatchObject({ mode: "disabled", reason: expect.stringContaining("production") });
    expect(resolveAuthMode({ AUTH_PROVIDER: "FAKE", DEPLOY_ENV: "production" })).toMatchObject({ mode: "disabled" });
    // Never fake identities against real data.
    expect(resolveAuthMode({ AUTH_PROVIDER: "fake", ...supabase })).toMatchObject({ mode: "disabled", reason: expect.stringContaining("SERVICE_ROLE") });
  });

  it("rejects unknown providers instead of guessing", () => {
    expect(resolveAuthMode({ ...supabase, AUTH_PROVIDER: "auth0" })).toMatchObject({ mode: "disabled", reason: expect.stringContaining("auth0") });
  });
});
