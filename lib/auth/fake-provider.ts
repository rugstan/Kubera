// In-memory identity provider for tests, local development and the e2e suite.
// It mirrors Supabase Auth semantics the app relies on: unknown emails get no
// code (and no error), codes are single use with a TTL and an attempt limit,
// refresh tokens rotate, TOTP factors start unverified and a verified code
// upgrades the session to aal2. It is refused in production (lib/auth/config.ts).

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { AuthError, type AuthProvider } from "./provider";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";
import type { Aal, AuthSession, AuthTokens, AuthUser, TotpEnrollment, TotpFactor } from "./types";

type Clock = () => number;

type FakeFactor = TotpFactor & { secret: string };
type FakeUser = AuthUser & { factors: FakeFactor[] };
type PendingCode = { code: string; tokenHash: string; expiresAt: number; attempts: number };
type SessionRecord = { userId: string; aal: Aal; expiresAt: number; revoked: boolean };

export type FakeAuthOptions = {
  now?: Clock;
  /** Seconds an access token lives (Supabase default: 3600). */
  accessTtlSeconds?: number;
  /** Seconds an email code / magic link lives (Supabase default: 3600; we use 10 minutes). */
  codeTtlSeconds?: number;
  maxCodeAttempts?: number;
};

export type SentEmail = { email: string; code: string; magicLink: string; at: number };

export class FakeAuthProvider implements AuthProvider {
  readonly name = "fake" as const;
  readonly outbox: SentEmail[] = [];
  private readonly users = new Map<string, FakeUser>();
  private readonly codes = new Map<string, PendingCode>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly refreshTokens = new Map<string, string>();
  private readonly now: Clock;
  private readonly accessTtl: number;
  private readonly codeTtl: number;
  private readonly maxAttempts: number;

  constructor(opts: FakeAuthOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.accessTtl = opts.accessTtlSeconds ?? 3600;
    this.codeTtl = opts.codeTtlSeconds ?? 600;
    this.maxAttempts = opts.maxCodeAttempts ?? 5;
  }

  /** Adds an account (admins invite staff; nobody self-registers). */
  addUser(input: { email: string; id?: string; totpSecret?: string }): AuthUser {
    const email = input.email.trim().toLowerCase();
    const user: FakeUser = { id: input.id ?? randomUUID(), email, factors: [] };
    if (input.totpSecret) user.factors.push({ id: randomUUID(), status: "verified", friendlyName: "Authenticator", secret: input.totpSecret });
    this.users.set(email, user);
    return { id: user.id, email };
  }

  /** Most recent code emailed to an address (tests and the fake-mode sign-in hint). */
  lastEmailFor(email: string): SentEmail | undefined {
    const e = email.trim().toLowerCase();
    return [...this.outbox].reverse().find((m) => m.email === e);
  }

  async sendEmailOtp(email: string, opts: { redirectTo: string }): Promise<void> {
    const e = email.trim().toLowerCase();
    if (!this.users.has(e)) return;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const tokenHash = randomBytes(24).toString("hex");
    this.codes.set(e, { code, tokenHash, expiresAt: this.now() + this.codeTtl * 1000, attempts: 0 });
    const link = new URL(opts.redirectTo);
    link.searchParams.set("token_hash", tokenHash);
    link.searchParams.set("type", "email");
    this.outbox.push({ email: e, code, magicLink: link.toString(), at: this.now() });
  }

  async verifyEmailOtp(email: string, code: string): Promise<AuthSession> {
    const e = email.trim().toLowerCase();
    const pending = this.codes.get(e);
    const user = this.users.get(e);
    if (!pending || !user) throw new AuthError("invalid_code", "Code is invalid or has expired");
    if (pending.expiresAt <= this.now()) {
      this.codes.delete(e);
      throw new AuthError("expired", "Code has expired");
    }
    pending.attempts += 1;
    if (pending.code !== code) {
      if (pending.attempts >= this.maxAttempts) this.codes.delete(e);
      throw new AuthError("invalid_code", "Code is invalid or has expired");
    }
    this.codes.delete(e);
    return this.issue(user, "aal1");
  }

  async verifyMagicLink(tokenHash: string): Promise<AuthSession> {
    for (const [email, pending] of this.codes) {
      if (pending.tokenHash !== tokenHash) continue;
      this.codes.delete(email);
      if (pending.expiresAt <= this.now()) throw new AuthError("expired", "Link has expired");
      return this.issue(this.users.get(email)!, "aal1");
    }
    throw new AuthError("invalid_code", "Link is invalid or has expired");
  }

  async getSession(tokens: AuthTokens): Promise<AuthSession | null> {
    const rec = this.sessions.get(hash(tokens.accessToken));
    if (!rec || rec.revoked || rec.expiresAt * 1000 <= this.now()) return null;
    const user = this.userById(rec.userId);
    if (!user) return null;
    return { ...tokens, expiresAt: rec.expiresAt, user: { id: user.id, email: user.email }, aal: rec.aal };
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const key = hash(refreshToken);
    const access = this.refreshTokens.get(key);
    const rec = access ? this.sessions.get(access) : undefined;
    if (!access || !rec || rec.revoked) throw new AuthError("invalid_session", "Refresh token is invalid");
    // Rotation: the old refresh token and its access token stop working.
    this.refreshTokens.delete(key);
    rec.revoked = true;
    const user = this.userById(rec.userId);
    if (!user) throw new AuthError("invalid_session", "User no longer exists");
    return this.issue(user, rec.aal);
  }

  async listTotpFactors(tokens: AuthTokens): Promise<TotpFactor[]> {
    const user = await this.requireUser(tokens);
    return user.factors.map(({ id, status, friendlyName }) => ({ id, status, friendlyName }));
  }

  async enrollTotp(tokens: AuthTokens, friendlyName: string): Promise<TotpEnrollment> {
    const user = await this.requireUser(tokens);
    // Like Supabase, abandoned unverified factors are replaced rather than piling up.
    user.factors = user.factors.filter((f) => f.status === "verified");
    const secret = generateTotpSecret();
    const factor: FakeFactor = { id: randomUUID(), status: "unverified", friendlyName, secret };
    user.factors.push(factor);
    return { factorId: factor.id, secret, uri: otpauthUri(secret, user.email) };
  }

  async verifyTotp(tokens: AuthTokens, factorId: string, code: string): Promise<AuthSession> {
    const user = await this.requireUser(tokens);
    const factor = user.factors.find((f) => f.id === factorId);
    if (!factor || !verifyTotp(factor.secret, code.trim(), this.now())) throw new AuthError("mfa_failed", "Authenticator code is not valid");
    factor.status = "verified";
    // The aal1 session is replaced by the upgraded one.
    const rec = this.sessions.get(hash(tokens.accessToken));
    if (rec) rec.revoked = true;
    this.refreshTokens.delete(hash(tokens.refreshToken));
    return this.issue(user, "aal2");
  }

  async signOut(tokens: AuthTokens): Promise<void> {
    const rec = this.sessions.get(hash(tokens.accessToken));
    if (rec) rec.revoked = true;
    this.refreshTokens.delete(hash(tokens.refreshToken));
  }

  private async requireUser(tokens: AuthTokens): Promise<FakeUser> {
    const session = await this.getSession(tokens);
    const user = session ? this.userById(session.user.id) : undefined;
    if (!user) throw new AuthError("invalid_session", "Session is invalid or expired");
    return user;
  }

  private userById(id: string): FakeUser | undefined {
    for (const u of this.users.values()) if (u.id === id) return u;
    return undefined;
  }

  private issue(user: FakeUser, aal: Aal): AuthSession {
    const accessToken = `fake_at_${randomBytes(24).toString("base64url")}`;
    const refreshToken = `fake_rt_${randomBytes(24).toString("base64url")}`;
    const expiresAt = Math.floor(this.now() / 1000) + this.accessTtl;
    this.sessions.set(hash(accessToken), { userId: user.id, aal, expiresAt, revoked: false });
    this.refreshTokens.set(hash(refreshToken), hash(accessToken));
    return { accessToken, refreshToken, expiresAt, user: { id: user.id, email: user.email }, aal };
  }
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
