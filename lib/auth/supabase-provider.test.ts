import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseAuthProvider, aalFromJwt, mapSupabaseError } from "./supabase-provider";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const future = () => Math.floor(Date.now() / 1000) + 3600;

function fakeClient(auth: Record<string, unknown>) {
  return { auth } as unknown as SupabaseClient;
}

describe("aalFromJwt", () => {
  it("reads the assurance level claim and defaults to aal1", () => {
    expect(aalFromJwt(jwt({ aal: "aal2" }))).toBe("aal2");
    expect(aalFromJwt(jwt({ aal: "aal1" }))).toBe("aal1");
    expect(aalFromJwt(jwt({}))).toBe("aal1");
    expect(aalFromJwt("not-a-jwt")).toBe("aal1");
    expect(aalFromJwt("a.%%%.c")).toBe("aal1");
  });
});

describe("mapSupabaseError", () => {
  it.each([
    [{ code: "otp_expired", status: 403 }, "expired"],
    [{ code: "over_email_send_rate_limit", status: 429 }, "rate_limited"],
    [{ code: undefined, status: 429 }, "rate_limited"],
    [{ code: "mfa_verification_failed", status: 422 }, "mfa_failed"],
    [{ code: "invalid_credentials", status: 400 }, "invalid_code"],
    [{ code: "refresh_token_already_used", status: 400 }, "invalid_session"],
    [{ code: "bad_jwt", status: 401 }, "invalid_session"],
    [{ code: "validation_failed", status: 422 }, "invalid_code"],
    [{ code: "unexpected_failure", status: 500 }, "unavailable"],
  ])("%o → %s", (err, code) => {
    expect(mapSupabaseError({ ...err, message: "x" } as never).code).toBe(code);
  });
});

describe("SupabaseAuthProvider", () => {
  it("never creates accounts from the sign-in form and hides unknown emails", async () => {
    const signInWithOtp = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" } });
    const p = new SupabaseAuthProvider({ url: "https://x.supabase.co", anonKey: "anon" }, () => fakeClient({ signInWithOtp }));
    await p.sendEmailOtp("pat@kubera.test", { redirectTo: "https://kuberacommercial.com/auth/confirm" });
    await expect(p.sendEmailOtp("nobody@kubera.test", { redirectTo: "https://kuberacommercial.com/auth/confirm" })).resolves.toBeUndefined();
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "pat@kubera.test", options: { shouldCreateUser: false, emailRedirectTo: "https://kuberacommercial.com/auth/confirm" } });
  });

  it("surfaces rate limits on send", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: { code: "over_email_send_rate_limit", status: 429, message: "slow down" } });
    const p = new SupabaseAuthProvider({ url: "u", anonKey: "k" }, () => fakeClient({ signInWithOtp }));
    await expect(p.sendEmailOtp("pat@kubera.test", { redirectTo: "https://x" })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps verified sessions, lower-cases emails and reads aal", async () => {
    const access = jwt({ aal: "aal1" });
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { session: { access_token: access, refresh_token: "rt", expires_at: 2_000_000_000, user: { id: "u1", email: "Pat@Kubera.test" } } },
      error: null,
    });
    const p = new SupabaseAuthProvider({ url: "u", anonKey: "k" }, () => fakeClient({ verifyOtp }));
    expect(await p.verifyEmailOtp("pat@kubera.test", "123456")).toEqual({ accessToken: access, refreshToken: "rt", expiresAt: 2_000_000_000, user: { id: "u1", email: "pat@kubera.test" }, aal: "aal1" });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "pat@kubera.test", token: "123456", type: "email" });
    await p.verifyMagicLink("abc123abc123abc123");
    expect(verifyOtp).toHaveBeenLastCalledWith({ token_hash: "abc123abc123abc123", type: "email" });
  });

  it("validates sessions with the Auth server and rejects expired tokens without a call", async () => {
    const getUser = vi.fn().mockResolvedValueOnce({ data: { user: { id: "u1", email: "pat@kubera.test" } }, error: null }).mockResolvedValueOnce({ data: { user: null }, error: { message: "bad" } });
    const p = new SupabaseAuthProvider({ url: "u", anonKey: "k" }, () => fakeClient({ getUser }));
    const tokens = { accessToken: jwt({ aal: "aal2" }), refreshToken: "rt", expiresAt: future() };
    expect(await p.getSession(tokens)).toMatchObject({ aal: "aal2", user: { id: "u1" } });
    expect(await p.getSession(tokens)).toBeNull();
    expect(await p.getSession({ ...tokens, expiresAt: 1 })).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it("enrolls TOTP after clearing abandoned factors and upgrades on verify", async () => {
    const unenroll = vi.fn().mockResolvedValue({ error: null });
    const listFactors = vi.fn().mockResolvedValue({ data: { all: [{ id: "old", factor_type: "totp", status: "unverified" }, { id: "phone", factor_type: "phone", status: "unverified" }] }, error: null });
    const enroll = vi.fn().mockResolvedValue({ data: { id: "f1", totp: { secret: "S", uri: "otpauth://x", qr_code: "data:image/svg+xml;utf8,<svg/>" } }, error: null });
    const access2 = jwt({ aal: "aal2" });
    const challengeAndVerify = vi.fn().mockResolvedValue({ data: { access_token: access2, refresh_token: "rt2", expires_in: 3600, user: { id: "u1", email: "pat@kubera.test" } }, error: null });
    const setSession = vi.fn().mockResolvedValue({ error: null });
    const p = new SupabaseAuthProvider({ url: "u", anonKey: "k" }, () => fakeClient({ setSession, mfa: { listFactors, unenroll, enroll, challengeAndVerify } }));
    const tokens = { accessToken: jwt({ aal: "aal1" }), refreshToken: "rt", expiresAt: future() };
    expect(await p.enrollTotp(tokens, "Kubera Commercial")).toEqual({ factorId: "f1", secret: "S", uri: "otpauth://x", qrCode: "data:image/svg+xml;utf8,<svg/>" });
    expect(unenroll).toHaveBeenCalledWith({ factorId: "old" });
    expect(unenroll).toHaveBeenCalledTimes(1);
    expect(await p.verifyTotp(tokens, "f1", " 123456 ")).toMatchObject({ accessToken: access2, refreshToken: "rt2", aal: "aal2" });
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
  });

  it("maps a failed TOTP check", async () => {
    const p = new SupabaseAuthProvider({ url: "u", anonKey: "k" }, () =>
      fakeClient({ setSession: vi.fn().mockResolvedValue({ error: null }), mfa: { challengeAndVerify: vi.fn().mockResolvedValue({ data: null, error: { code: "mfa_verification_failed", status: 422, message: "Invalid TOTP code" } }) } }),
    );
    await expect(p.verifyTotp({ accessToken: "a", refreshToken: "r", expiresAt: future() }, "f1", "000000")).rejects.toMatchObject({ code: "mfa_failed" });
  });
});
