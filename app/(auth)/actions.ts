"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { auditQuietly } from "@/lib/auth/audit";
import { clearSessionCookie, requestFingerprint, sessionForMutation, writeSessionCookie } from "@/lib/auth/dal";
import { completeSignIn, emailKey, limited, readPendingLogin, setPendingLogin } from "@/lib/auth/flows";
import { isAuthError } from "@/lib/auth/provider";
import { authServices } from "@/lib/auth/server";
import { safeNextPath, toStored } from "@/lib/auth/session";
import { site } from "@/lib/site";

// Sign-in server actions. Each one re-reads the request state itself (never
// trusting hidden fields for identity) and answers unknown emails exactly
// like known ones, so the forms never reveal who has an account.

const emailSchema = z.email().max(200);
const codeSchema = z.string().trim().regex(/^\d{6}$/);
const MIN = 60_000;

function nextFrom(formData: FormData): string {
  const raw = formData.get("next");
  return typeof raw === "string" && raw ? safeNextPath(raw) : "";
}

export async function sendCodeAction(formData: FormData): Promise<void> {
  const next = nextFrom(formData);
  const back = (error: string) => `/login?error=${error}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) redirect(back("email"));
  const email = parsed.data;

  const services = authServices();
  if (!services) redirect(back("unavailable"));

  const { ipHash } = await requestFingerprint();
  if ((await limited(`auth:send:ip:${ipHash ?? "unknown"}`, 10, 15 * MIN)) || (await limited(`auth:send:email:${emailKey(email)}`, 5, 15 * MIN))) {
    redirect(back("rate_limited"));
  }

  try {
    const confirm = new URL("/auth/confirm", site.siteUrl);
    if (next) confirm.searchParams.set("next", next);
    await services.provider.sendEmailOtp(email, { redirectTo: confirm.toString() });
  } catch (err) {
    redirect(back(isAuthError(err) && err.code === "rate_limited" ? "rate_limited" : "unavailable"));
  }
  await setPendingLogin({ email, next, sentAt: Math.floor(Date.now() / 1000) });
  redirect("/login/verify");
}

export async function verifyCodeAction(formData: FormData): Promise<void> {
  const pending = await readPendingLogin();
  if (!pending) redirect("/login?error=expired");
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) redirect("/login/verify?error=code");

  const services = authServices();
  if (!services) redirect("/login?error=unavailable");
  if (await limited(`auth:verify:email:${emailKey(pending.email)}`, 10, 15 * MIN)) redirect("/login/verify?error=rate_limited");

  let destination: string;
  try {
    const session = await services.provider.verifyEmailOtp(pending.email, code.data);
    destination = await completeSignIn(services, session, pending.next);
  } catch (err) {
    if (!isAuthError(err)) throw err;
    await auditQuietly(services.audit, { actorId: null, actorLabel: pending.email, action: "auth.sign_in_failed", detail: { reason: err.code }, ...(await requestFingerprint()) });
    redirect(`/login/verify?error=${err.code === "rate_limited" ? "rate_limited" : err.code === "unavailable" ? "unavailable" : "invalid_code"}`);
  }
  redirect(destination);
}

/** Second step of a magic link: a button press, so mail scanners that prefetch links cannot spend it. */
export async function confirmLinkAction(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const next = nextFrom(formData);
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(tokenHash)) redirect("/login?error=link");
  const services = authServices();
  if (!services) redirect("/login?error=unavailable");
  const { ipHash } = await requestFingerprint();
  if (await limited(`auth:link:ip:${ipHash ?? "unknown"}`, 20, 15 * MIN)) redirect("/login?error=rate_limited");

  let destination: string;
  try {
    const session = await services.provider.verifyMagicLink(tokenHash);
    destination = await completeSignIn(services, session, next);
  } catch (err) {
    if (!isAuthError(err)) throw err;
    redirect("/login?error=link");
  }
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  const auth = await sessionForMutation();
  if (auth.ok) {
    await auth.services.provider.signOut(auth.stored);
    await auditQuietly(auth.services.audit, {
      actorId: auth.session.user.id,
      actorLabel: auth.profile?.fullName || auth.session.user.email,
      action: "auth.sign_out",
      ...(await requestFingerprint()),
    });
  }
  await clearSessionCookie();
  redirect("/login?signed_out=1");
}

// --- MFA ----------------------------------------------------------------------------

export type EnrollState =
  | { status: "idle" }
  | { status: "enrolling"; factorId: string; secret: string; uri: string; qrCode?: string }
  | { status: "error"; message: string };

export async function startEnrollmentAction(): Promise<EnrollState> {
  const auth = await sessionForMutation();
  if (!auth.ok) return { status: "error", message: "Your sign-in expired. Sign in again to set up your authenticator." };
  const existing = await auth.services.provider.listTotpFactors(auth.stored);
  if (existing.some((f) => f.status === "verified")) return { status: "error", message: "An authenticator is already set up. Enter its code instead." };
  try {
    const e = await auth.services.provider.enrollTotp(auth.stored, "Kubera Commercial");
    return { status: "enrolling", factorId: e.factorId, secret: e.secret, uri: e.uri, qrCode: e.qrCode };
  } catch {
    return { status: "error", message: "We could not start authenticator setup. Try again in a minute." };
  }
}

export type MfaState = { error?: string };

const factorSchema = z.string().min(1).max(100);

export async function verifyMfaAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const auth = await sessionForMutation();
  if (!auth.ok) return { error: "Your sign-in expired. Sign in again." };
  const code = codeSchema.safeParse(formData.get("code"));
  const factorId = factorSchema.safeParse(formData.get("factorId"));
  if (!code.success || !factorId.success) return { error: "Enter the 6-digit code from your authenticator app." };
  if (await limited(`auth:mfa:user:${auth.session.user.id}`, 6, 5 * MIN)) return { error: "Too many attempts. Wait a few minutes and try again." };

  const fp = await requestFingerprint();
  const label = auth.profile?.fullName || auth.session.user.email;
  // The factor must belong to this user: the provider checks it against the session.
  const factors = await auth.services.provider.listTotpFactors(auth.stored);
  const factor = factors.find((f) => f.id === factorId.data);
  if (!factor) return { error: "That authenticator is not set up on your account. Start setup again." };

  let upgraded;
  try {
    upgraded = await auth.services.provider.verifyTotp(auth.stored, factor.id, code.data);
  } catch (err) {
    await auditQuietly(auth.services.audit, { actorId: auth.session.user.id, actorLabel: label, action: "auth.mfa_failed", ...fp });
    return { error: isAuthError(err) && err.code === "invalid_session" ? "Your sign-in expired. Sign in again." : "That code did not match. Check the time on your phone and try the newest code." };
  }
  await writeSessionCookie(toStored(upgraded, auth.stored.issuedAt));
  await auditQuietly(auth.services.audit, {
    actorId: auth.session.user.id,
    actorLabel: label,
    action: factor.status === "verified" ? "auth.mfa_verified" : "auth.mfa_enrolled",
    ...fp,
  });
  redirect(nextFrom(formData) || "/pipeline");
}
