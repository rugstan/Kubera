import { describe, expect, it } from "vitest";
import { FakeAuthProvider } from "./fake-provider";
import { AuthError } from "./provider";
import { totp } from "./totp";

const REDIRECT = "https://kuberacommercial.com/auth/confirm";

function setup(start = 1_800_000_000_000) {
  let now = start;
  const provider = new FakeAuthProvider({ now: () => now });
  const user = provider.addUser({ email: "Pat@Kubera.test" });
  return { provider, user, advance: (ms: number) => (now += ms), now: () => now };
}

async function signIn(p: FakeAuthProvider, email = "pat@kubera.test") {
  await p.sendEmailOtp(email, { redirectTo: REDIRECT });
  return p.verifyEmailOtp(email, p.lastEmailFor(email)!.code);
}

describe("FakeAuthProvider email sign-in", () => {
  it("issues an aal1 session for the emailed code, once", async () => {
    const { provider, user } = setup();
    await provider.sendEmailOtp("pat@kubera.test", { redirectTo: REDIRECT });
    const mail = provider.lastEmailFor("PAT@kubera.test")!;
    expect(mail.code).toMatch(/^\d{6}$/);
    expect(mail.magicLink).toMatch(/^https:\/\/kuberacommercial\.com\/auth\/confirm\?token_hash=[0-9a-f]+&type=email$/);
    const s = await provider.verifyEmailOtp("pat@kubera.test", mail.code);
    expect(s).toMatchObject({ user: { id: user.id, email: "pat@kubera.test" }, aal: "aal1" });
    await expect(provider.verifyEmailOtp("pat@kubera.test", mail.code)).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("sends nothing (and says nothing) for unknown addresses", async () => {
    const { provider } = setup();
    await expect(provider.sendEmailOtp("nobody@kubera.test", { redirectTo: REDIRECT })).resolves.toBeUndefined();
    expect(provider.outbox).toHaveLength(0);
    await expect(provider.verifyEmailOtp("nobody@kubera.test", "123456")).rejects.toBeInstanceOf(AuthError);
  });

  it("expires codes and burns them after too many wrong attempts", async () => {
    const { provider, advance } = setup();
    await provider.sendEmailOtp("pat@kubera.test", { redirectTo: REDIRECT });
    const code = provider.lastEmailFor("pat@kubera.test")!.code;
    advance(11 * 60_000);
    await expect(provider.verifyEmailOtp("pat@kubera.test", code)).rejects.toMatchObject({ code: "expired" });

    await provider.sendEmailOtp("pat@kubera.test", { redirectTo: REDIRECT });
    const fresh = provider.lastEmailFor("pat@kubera.test")!.code;
    const wrong = fresh === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expect(provider.verifyEmailOtp("pat@kubera.test", wrong)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(provider.verifyEmailOtp("pat@kubera.test", fresh)).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("accepts the magic link once", async () => {
    const { provider } = setup();
    await provider.sendEmailOtp("pat@kubera.test", { redirectTo: REDIRECT });
    const hash = new URL(provider.lastEmailFor("pat@kubera.test")!.magicLink).searchParams.get("token_hash")!;
    await expect(provider.verifyMagicLink(hash)).resolves.toMatchObject({ aal: "aal1" });
    await expect(provider.verifyMagicLink(hash)).rejects.toMatchObject({ code: "invalid_code" });
  });
});

describe("FakeAuthProvider sessions", () => {
  it("validates, expires and rotates sessions", async () => {
    const { provider, advance } = setup();
    const s = await signIn(provider);
    expect(await provider.getSession(s)).toMatchObject({ aal: "aal1" });
    expect(await provider.getSession({ ...s, accessToken: "forged" })).toBeNull();

    const r = await provider.refresh(s.refreshToken);
    expect(await provider.getSession(s)).toBeNull();
    expect(await provider.getSession(r)).not.toBeNull();
    await expect(provider.refresh(s.refreshToken)).rejects.toMatchObject({ code: "invalid_session" });

    advance(3_601_000);
    expect(await provider.getSession(r)).toBeNull();
  });

  it("signs out by revoking the session", async () => {
    const { provider } = setup();
    const s = await signIn(provider);
    await provider.signOut(s);
    expect(await provider.getSession(s)).toBeNull();
    await expect(provider.refresh(s.refreshToken)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("FakeAuthProvider TOTP", () => {
  it("enrolls a factor and upgrades the session to aal2 on a valid code", async () => {
    const { provider, now } = setup();
    const s = await signIn(provider);
    expect(await provider.listTotpFactors(s)).toEqual([]);
    const enrollment = await provider.enrollTotp(s, "Authenticator");
    expect(enrollment.uri).toContain(`secret=${enrollment.secret}`);
    expect(await provider.listTotpFactors(s)).toEqual([{ id: enrollment.factorId, status: "unverified", friendlyName: "Authenticator" }]);

    await expect(provider.verifyTotp(s, enrollment.factorId, "000000")).rejects.toMatchObject({ code: "mfa_failed" });
    const upgraded = await provider.verifyTotp(s, enrollment.factorId, totp(enrollment.secret, now()));
    expect(upgraded.aal).toBe("aal2");
    expect(await provider.getSession(s)).toBeNull();
    expect(await provider.listTotpFactors(upgraded)).toEqual([{ id: enrollment.factorId, status: "verified", friendlyName: "Authenticator" }]);
    // A refresh keeps the assurance level.
    expect((await provider.refresh(upgraded.refreshToken)).aal).toBe("aal2");
  });

  it("replaces abandoned unverified factors and rejects unknown factor ids", async () => {
    const { provider } = setup();
    const s = await signIn(provider);
    await provider.enrollTotp(s, "Authenticator");
    const second = await provider.enrollTotp(s, "Authenticator");
    expect((await provider.listTotpFactors(s)).map((f) => f.id)).toEqual([second.factorId]);
    await expect(provider.verifyTotp(s, "not-a-factor", "123456")).rejects.toMatchObject({ code: "mfa_failed" });
    await expect(provider.enrollTotp({ ...s, accessToken: "forged" }, "x")).rejects.toMatchObject({ code: "invalid_session" });
  });
});
