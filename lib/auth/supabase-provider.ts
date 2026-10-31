// Supabase Auth implementation of AuthProvider (email OTP / magic link + TOTP
// MFA). Every call builds a short-lived client with no persisted session, so
// tokens only ever live in the caller's httpOnly cookie.
//
// Supabase setup (Dashboard → Authentication):
//   * Email provider on; "Allow new users to sign up" off (admins invite staff).
//   * Email OTP length 6, expiry 600 s.
//   * Magic Link email template links to
//     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
//     and also shows {{ .Token }} so people can type the code instead.
//   * MFA → TOTP enabled (verify on, enroll on).
//
// Staff onboarding: invite the person from Authentication → Users (this
// creates their `profiles` row), then an administrator inserts their
// `user_roles` row(s) and, for brokers, records and verifies the DRE license
// on the profile. They enroll an authenticator on first sign-in; ask new
// staff to sign in promptly after the invite, since first enrollment trusts
// whoever holds the inbox.

import { createClient, type AuthError as SupabaseAuthError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { AuthError, type AuthErrorCode, type AuthProvider } from "./provider";
import type { Aal, AuthSession, AuthTokens, TotpEnrollment, TotpFactor } from "./types";

export type SupabaseAuthConfig = { url: string; anonKey: string };

/** Reads the `aal` claim from a JWT payload (the token was validated by the server first). */
export function aalFromJwt(accessToken: string): Aal {
  const part = accessToken.split(".")[1];
  if (!part) return "aal1";
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { aal?: unknown };
    return claims.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

export function mapSupabaseError(err: Pick<SupabaseAuthError, "code" | "status" | "message"> | null | undefined): AuthError {
  const code = err?.code ?? "";
  const status = err?.status ?? 0;
  let mapped: AuthErrorCode = "unavailable";
  if (code === "otp_expired") mapped = "expired";
  else if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429) mapped = "rate_limited";
  else if (code === "mfa_verification_failed" || code === "mfa_challenge_expired" || code === "mfa_factor_not_found") mapped = "mfa_failed";
  else if (code === "invalid_credentials" || code === "otp_disabled" || code === "validation_failed") mapped = "invalid_code";
  else if (code === "session_not_found" || code === "refresh_token_not_found" || code === "refresh_token_already_used" || code === "bad_jwt" || status === 401 || status === 403)
    mapped = "invalid_session";
  else if (status === 400 || status === 422) mapped = "invalid_code";
  return new AuthError(mapped, err?.message || mapped);
}

/** Errors that mean "no such account / signups closed": swallowed so sign-in never reveals who has an account. */
const SILENT_SEND_ERRORS = new Set(["otp_disabled", "signup_disabled", "user_not_found", "email_address_not_authorized"]);

function toSession(session: Pick<Session, "access_token" | "refresh_token" | "expires_at" | "expires_in"> & { user: { id: string; email?: string } }): AuthSession {
  const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt,
    user: { id: session.user.id, email: (session.user.email ?? "").toLowerCase() },
    aal: aalFromJwt(session.access_token),
  };
}

export class SupabaseAuthProvider implements AuthProvider {
  readonly name = "supabase" as const;

  constructor(
    private readonly config: SupabaseAuthConfig,
    private readonly makeClient: (cfg: SupabaseAuthConfig) => SupabaseClient = (cfg) =>
      createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
  ) {}

  private client(): SupabaseClient {
    return this.makeClient(this.config);
  }

  private async withSession(tokens: AuthTokens): Promise<SupabaseClient> {
    const client = this.client();
    const { error } = await client.auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
    if (error) throw mapSupabaseError(error);
    return client;
  }

  async sendEmailOtp(email: string, opts: { redirectTo: string }): Promise<void> {
    const { error } = await this.client().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: opts.redirectTo },
    });
    if (!error) return;
    if (error.code && SILENT_SEND_ERRORS.has(error.code)) return;
    throw mapSupabaseError(error);
  }

  async verifyEmailOtp(email: string, code: string): Promise<AuthSession> {
    const { data, error } = await this.client().auth.verifyOtp({ email, token: code, type: "email" });
    if (error || !data.session) throw mapSupabaseError(error ?? { code: "invalid_credentials", status: 400, message: "No session" });
    return toSession(data.session);
  }

  async verifyMagicLink(tokenHash: string): Promise<AuthSession> {
    const { data, error } = await this.client().auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (error || !data.session) throw mapSupabaseError(error ?? { code: "invalid_credentials", status: 400, message: "No session" });
    return toSession(data.session);
  }

  async getSession(tokens: AuthTokens): Promise<AuthSession | null> {
    if (tokens.expiresAt * 1000 <= Date.now()) return null;
    // getUser asks the Auth server, so a revoked or forged token is rejected.
    const { data, error } = await this.client().auth.getUser(tokens.accessToken);
    if (error || !data.user) return null;
    return {
      ...tokens,
      user: { id: data.user.id, email: (data.user.email ?? "").toLowerCase() },
      aal: aalFromJwt(tokens.accessToken),
    };
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const { data, error } = await this.client().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw mapSupabaseError(error ?? { code: "refresh_token_not_found", status: 401, message: "No session" });
    return toSession(data.session);
  }

  async listTotpFactors(tokens: AuthTokens): Promise<TotpFactor[]> {
    const client = await this.withSession(tokens);
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw mapSupabaseError(error);
    return data.all
      .filter((f) => f.factor_type === "totp")
      .map((f) => ({ id: f.id, status: f.status === "verified" ? "verified" : "unverified", friendlyName: f.friendly_name ?? undefined }));
  }

  async enrollTotp(tokens: AuthTokens, friendlyName: string): Promise<TotpEnrollment> {
    const client = await this.withSession(tokens);
    // Remove abandoned unverified factors first (friendly names must be unique).
    const listed = await client.auth.mfa.listFactors();
    for (const f of listed.data?.all ?? []) {
      if (f.factor_type === "totp" && f.status !== "verified") await client.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName });
    if (error) throw mapSupabaseError(error);
    return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri, qrCode: data.totp.qr_code };
  }

  async verifyTotp(tokens: AuthTokens, factorId: string, code: string): Promise<AuthSession> {
    const client = await this.withSession(tokens);
    const { data, error } = await client.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error || !data) throw mapSupabaseError(error ?? { code: "mfa_verification_failed", status: 422, message: "Verification failed" });
    return toSession({ ...data, expires_at: Math.floor(Date.now() / 1000) + data.expires_in });
  }

  async signOut(tokens: AuthTokens): Promise<void> {
    try {
      const client = await this.withSession(tokens);
      await client.auth.signOut({ scope: "local" });
    } catch {
      // The cookie is cleared regardless; an already-invalid session needs no revocation.
    }
  }
}
