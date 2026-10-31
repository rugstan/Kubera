// Identity provider contract. The real implementation is Supabase Auth
// (lib/auth/supabase-provider.ts); tests and the e2e suite use the in-memory
// fake (lib/auth/fake-provider.ts). The app never talks to Supabase Auth
// directly, so the staff pages work identically against either.

import type { AuthSession, AuthTokens, TotpEnrollment, TotpFactor } from "./types";

export type AuthErrorCode =
  | "invalid_code"
  | "expired"
  | "rate_limited"
  | "invalid_session"
  | "mfa_failed"
  | "unavailable";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}

export interface AuthProvider {
  readonly name: "supabase" | "fake";
  /**
   * Emails a one-time code and magic link. Never reveals whether the address
   * has an account: unknown addresses resolve silently (no account is created).
   */
  sendEmailOtp(email: string, opts: { redirectTo: string }): Promise<void>;
  /** Exchanges the 6-digit email code for an aal1 session. */
  verifyEmailOtp(email: string, code: string): Promise<AuthSession>;
  /** Exchanges a magic-link token hash for an aal1 session. */
  verifyMagicLink(tokenHash: string): Promise<AuthSession>;
  /** Validates the access token; null when it is invalid or expired. */
  getSession(tokens: AuthTokens): Promise<AuthSession | null>;
  /** Rotates the refresh token (single use) for a fresh session at the same aal. */
  refresh(refreshToken: string): Promise<AuthSession>;
  listTotpFactors(tokens: AuthTokens): Promise<TotpFactor[]>;
  /** Starts TOTP enrollment; the factor stays unverified until the first code checks out. */
  enrollTotp(tokens: AuthTokens, friendlyName: string): Promise<TotpEnrollment>;
  /** Verifies a TOTP code for the factor and returns the upgraded aal2 session. */
  verifyTotp(tokens: AuthTokens, factorId: string, code: string): Promise<AuthSession>;
  /** Revokes the session's refresh token. Best effort. */
  signOut(tokens: AuthTokens): Promise<void>;
}
