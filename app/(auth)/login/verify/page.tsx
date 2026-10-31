import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { readPendingLogin } from "@/lib/auth/flows";
import { authServices, fakeAuthBundle } from "@/lib/auth/server";
import { sendCodeAction, verifyCodeAction } from "../../actions";
import { AuthCard, Notice, SubmitButton } from "../../ui";

export const metadata: Metadata = { title: "Enter your code" };

const ERRORS: Record<string, string> = {
  code: "Enter the 6-digit code from the email.",
  invalid_code: "That code is not valid or has expired. Check the newest email, or request a new code.",
  rate_limited: "Too many attempts. Wait a few minutes and request a new code.",
  unavailable: "Sign-in is not available right now. Try again shortly.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** pat@example.com → p••@example.com */
function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

export default function VerifyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard title="Check your email">
      <Suspense fallback={<div className="h-48" aria-hidden="true" />}>
        <VerifyForm searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function VerifyForm({ searchParams }: { searchParams: SearchParams }) {
  const [sp, pending] = await Promise.all([searchParams, readPendingLogin()]);
  if (!pending) redirect("/login?error=expired");
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const fakeCode = authServices()?.mode === "fake" ? fakeAuthBundle().provider.lastEmailFor(pending.email)?.code : undefined;

  return (
    <>
      <p className="text-[15px] leading-relaxed text-titanium">
        If <strong className="font-medium text-ink">{maskEmail(pending.email)}</strong> has an account, we sent a 6-digit code and a sign-in link. The code
        works for 10 minutes.
      </p>
      {error ? <Notice tone="error">{ERRORS[error] ?? ERRORS.invalid_code}</Notice> : null}
      <form action={verifyCodeAction} className="mt-5 grid gap-4">
        <div>
          <label htmlFor="code" className="field-label">
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            className="field tracking-[0.3em]"
            aria-describedby="code-hint"
          />
          <p id="code-hint" className="mt-1.5 text-[13px] text-titanium">
            Numbers only. Prefer the link? Open it on this device.
          </p>
        </div>
        <SubmitButton>Sign in</SubmitButton>
      </form>
      {fakeCode ? (
        <p className="mt-4 rounded-xl bg-canvas p-3 text-[13px] text-titanium">
          Test sign-in (fake provider) code: <code data-testid="fake-code">{fakeCode}</code>
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
        <form action={sendCodeAction}>
          <input type="hidden" name="email" value={pending.email} />
          <input type="hidden" name="next" value={pending.next} />
          <button type="submit" className="rounded-md text-accent underline underline-offset-2">
            Send a new code
          </button>
        </form>
        <Link href="/login" className="rounded-md text-accent underline underline-offset-2">
          Use a different email
        </Link>
      </div>
    </>
  );
}
