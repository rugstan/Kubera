import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const jar = new Map<string, string>();
const setCalls: { name: string; value: string; maxAge: number }[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts: { maxAge: number }) => {
      setCalls.push({ name, value, maxAge: opts.maxAge });
      if (opts.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));

class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));

const { MemoryAuditSink } = await import("./audit");
const { MemoryDirectory } = await import("./directory");
const { FakeAuthProvider } = await import("./fake-provider");
const { requireStaff, requireUser, staffForMutation, refreshCurrentSession } = await import("./dal");
const { completeSignIn } = await import("./flows");
const { setAuthServices, sessionSigningKey } = await import("./server");
const { SESSION_COOKIE, LOGIN_COOKIE, encodeSession, decodeSession, toStored } = await import("./session");
const { totp } = await import("./totp");
const { setRateLimiter, MemoryRateLimiter } = await import("@/lib/ratelimit");
type AuthServicesT = import("./server").AuthServices;
type Role = import("./types").Role;

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
let now = Date.parse("2026-11-03T17:00:00Z");
let provider: InstanceType<typeof FakeAuthProvider>;
let directory: InstanceType<typeof MemoryDirectory>;
let audit: InstanceType<typeof MemoryAuditSink>;
let services: AuthServicesT;

function addPerson(email: string, roles: Role[], opts: { totp?: boolean; active?: boolean } = {}) {
  const u = provider.addUser({ email, totpSecret: opts.totp ? SECRET : undefined });
  directory.set(
    { id: u.id, email, fullName: email.split("@")[0]!, title: null, active: opts.active ?? true, dreLicenseNumber: null, dreLicenseType: null, dreLicenseExpiresOn: null, dreLicenseVerifiedAt: null },
    roles,
  );
  return u;
}

async function signIn(email: string, aal2 = false) {
  await provider.sendEmailOtp(email, { redirectTo: "https://kuberacommercial.com/auth/confirm" });
  let s = await provider.verifyEmailOtp(email, provider.lastEmailFor(email)!.code);
  if (aal2) {
    const [factor] = await provider.listTotpFactors(s);
    s = await provider.verifyTotp(s, factor!.id, totp(SECRET, now));
  }
  jar.set(SESSION_COOKIE, encodeSession(toStored(s, Math.floor(now / 1000)), sessionSigningKey()));
  return s;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof RedirectError) return err.to;
    throw err;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.useFakeTimers({ now, toFake: ["Date"] });
  jar.clear();
  setCalls.length = 0;
  provider = new FakeAuthProvider({ now: () => Date.now() });
  directory = new MemoryDirectory();
  audit = new MemoryAuditSink();
  services = { mode: "fake", provider, directory, audit, userClient: () => null };
  setAuthServices(services);
  setRateLimiter(new MemoryRateLimiter());
  addPerson("broker@kubera.test", ["broker"], { totp: true });
  addPerson("analyst@kubera.test", ["analyst"]);
  addPerson("borrower@kubera.test", ["borrower"]);
  addPerson("former@kubera.test", ["broker"], { totp: true, active: false });
  addPerson("norole@kubera.test", []);
});

afterEach(() => {
  vi.useRealTimers();
  setAuthServices(undefined);
  setRateLimiter(undefined);
  now = Date.parse("2026-11-03T17:00:00Z");
});

describe("requireStaff", () => {
  it("sends anonymous visitors to sign in, keeping the page", async () => {
    expect(await redirectOf(requireStaff("/approvals"))).toBe("/login?next=%2Fapprovals");
  });

  it("sends staff without MFA to the TOTP step", async () => {
    await signIn("broker@kubera.test");
    expect(await redirectOf(requireStaff("/pipeline"))).toBe("/mfa?next=%2Fpipeline");
  });

  it("admits staff with an MFA session", async () => {
    await signIn("broker@kubera.test", true);
    const ctx = await requireStaff("/pipeline");
    expect(ctx.principal).toMatchObject({ email: "broker@kubera.test", staffRoles: ["broker"], aal: "aal2" });
  });

  it("refuses portal users and deactivated staff", async () => {
    await signIn("borrower@kubera.test");
    expect(await redirectOf(requireStaff("/pipeline"))).toBe("/access-denied?reason=not_staff");
    await signIn("former@kubera.test", true);
    expect(await redirectOf(requireStaff("/pipeline"))).toBe("/access-denied?reason=inactive");
  });

  it("rejects forged or revoked tokens without looping through refresh", async () => {
    const s = await signIn("broker@kubera.test", true);
    jar.set(SESSION_COOKIE, encodeSession({ accessToken: "forged", refreshToken: s.refreshToken, expiresAt: s.expiresAt, issuedAt: Math.floor(now / 1000) }, sessionSigningKey()));
    expect(await redirectOf(requireStaff("/pipeline"))).toBe("/login?next=%2Fpipeline");
    jar.set(SESSION_COOKIE, "garbage");
    expect(await redirectOf(requireStaff("/pipeline"))).toBe("/login?next=%2Fpipeline");
    // A cookie signed with another key (or edited to extend its lifetime) is ignored.
    jar.set(SESSION_COOKIE, encodeSession(toStored(s, Math.floor(now / 1000) + 3600), "some-other-key"));
    expect(await redirectOf(requireStaff("/pipeline"))).toBe("/login?next=%2Fpipeline");
  });

  it("routes an expiring session through the refresh endpoint", async () => {
    await signIn("broker@kubera.test", true);
    vi.setSystemTime(now + 3_590_000);
    expect(await redirectOf(requireStaff("/documents"))).toBe("/auth/refresh?next=%2Fdocuments");
  });

  it("signs everyone out after the absolute session lifetime, refreshes or not", async () => {
    await signIn("broker@kubera.test", true);
    vi.setSystemTime(now + 12 * 3600_000);
    expect(await redirectOf(requireStaff("/pipeline"))).toBe("/login?next=%2Fpipeline");
    expect(await refreshCurrentSession()).toBeNull();
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("explains when sign-in is not configured", async () => {
    setAuthServices(null);
    expect(await redirectOf(requireStaff("/pipeline"))).toBe("/login?error=unavailable");
  });
});

describe("requireUser (portal)", () => {
  it("admits portal users at aal1 but still demands MFA from staff", async () => {
    await signIn("borrower@kubera.test");
    expect((await requireUser("/portal")).principal.roles).toEqual(["borrower"]);
    await signIn("analyst@kubera.test");
    expect(await redirectOf(requireUser("/portal"))).toBe("/mfa?next=%2Fportal");
    await signIn("norole@kubera.test");
    expect(await redirectOf(requireUser("/portal"))).toBe("/access-denied?reason=inactive");
  });
});

describe("staffForMutation", () => {
  it("refreshes an expiring session in place and keeps the original sign-in time", async () => {
    const s = await signIn("broker@kubera.test", true);
    const issuedAt = decodeSession(jar.get(SESSION_COOKIE), sessionSigningKey())!.issuedAt;
    vi.setSystemTime(now + 3_590_000);
    const r = await staffForMutation();
    expect(r.ok).toBe(true);
    const stored = decodeSession(jar.get(SESSION_COOKIE), sessionSigningKey())!;
    expect(stored.refreshToken).not.toBe(s.refreshToken);
    expect(stored.issuedAt).toBe(issuedAt);
    // The cookie never outlives the absolute lifetime.
    expect(setCalls.at(-1)!.maxAge).toBe(12 * 3600 - 3590);
  });

  it("answers 401/403 instead of redirecting", async () => {
    expect(await staffForMutation()).toEqual({ ok: false, status: 401, reason: "signed_out" });
    await signIn("broker@kubera.test");
    expect(await staffForMutation()).toEqual({ ok: false, status: 403, reason: "mfa_required" });
    await signIn("borrower@kubera.test");
    expect(await staffForMutation()).toEqual({ ok: false, status: 403, reason: "forbidden" });
  });

  it("clears the cookie when the refresh token was already used", async () => {
    const s = await signIn("broker@kubera.test", true);
    await provider.refresh(s.refreshToken);
    vi.setSystemTime(now + 3_590_000);
    expect(await staffForMutation()).toEqual({ ok: false, status: 401, reason: "signed_out" });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
});

describe("completeSignIn", () => {
  async function aal1(email: string) {
    await provider.sendEmailOtp(email, { redirectTo: "https://kuberacommercial.com/auth/confirm" });
    return provider.verifyEmailOtp(email, provider.lastEmailFor(email)!.code);
  }

  it("sends staff to MFA with a safe destination and records the sign-in", async () => {
    jar.set(LOGIN_COOKIE, "pending");
    const dest = await completeSignIn(services, await aal1("broker@kubera.test"), "/approvals");
    expect(dest).toBe("/mfa?next=%2Fapprovals");
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(jar.has(LOGIN_COOKIE)).toBe(false);
    expect(directory.signIns).toHaveLength(1);
    expect(audit.events.at(-1)).toMatchObject({ action: "auth.sign_in", ipHash: expect.any(String), userAgent: "vitest" });
    expect(await completeSignIn(services, await aal1("broker@kubera.test"), "https://evil.example")).toBe("/mfa?next=%2Fpipeline");
  });

  it("sends portal users home and refuses accounts without a role", async () => {
    expect(await completeSignIn(services, await aal1("borrower@kubera.test"), "")).toBe("/portal");
    const s = await aal1("norole@kubera.test");
    expect(await completeSignIn(services, s, "/pipeline")).toBe("/access-denied?reason=inactive");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await provider.getSession(s)).toBeNull();
    expect(audit.events.at(-1)).toMatchObject({ action: "auth.access_denied", detail: { reason: "no_role" } });
  });
});
