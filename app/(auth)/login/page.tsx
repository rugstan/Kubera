import type { Metadata } from "next";
import { Suspense } from "react";
import { authServices } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/session";
import { sendCodeAction } from "../actions";
import { AuthCard, Notice, SubmitButton } from "../ui";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  unavailable: "Sign-in is not available right now. Email deals@kuberacommercial.com if you need access.",
  expired: "Your sign-in code expired. Request a new one.",
  link: "That sign-in link is invalid or has already been used. Request a new code.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard title="Sign in" intro="We will email you a 6-digit code and a sign-in link. Staff confirm with an authenticator app next.">
      <Suspense fallback={<div className="h-40" aria-hidden="true" />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function LoginForm({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const next = one("next") ? safeNextPath(one("next")) : "";
  const error = one("error");
  const services = authServices();
  const disabled = !services;

  return (
    <>
      {one("signed_out") ? <Notice tone="info">You are signed out.</Notice> : null}
      {error ? <Notice tone="error">{ERRORS[error] ?? ERRORS.unavailable}</Notice> : null}
      {disabled && error !== "unavailable" ? <Notice tone="error">Sign-in is not configured on this deployment yet.</Notice> : null}
      <form action={sendCodeAction} className="mt-5 grid gap-4" data-auth-provider={services?.mode ?? "disabled"}>
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="email" className="field-label">
            Work email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={200} className="field" disabled={disabled} />
        </div>
        <SubmitButton disabled={disabled}>Email me a code</SubmitButton>
      </form>
      {services?.mode === "fake" ? (
        <p className="mt-4 rounded-xl bg-canvas p-3 text-[13px] text-titanium" data-testid="fake-auth-note">
          Test sign-in (fake provider): use broker@kubera.test, analyst@kubera.test, admin@kubera.test or borrower@kubera.test.
        </p>
      ) : null}
    </>
  );
}
