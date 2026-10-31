import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Open your portal", referrer: "same-origin" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ERRORS: Record<string, string> = {
  invalid: "This link is not valid. Check that you opened the whole link, or ask your advisor for a new one.",
  expired: "This link has expired. Ask your advisor for a new one.",
  used: "This link was already used. For your security each link works once; ask your advisor for a new one.",
  revoked: "This link was cancelled. Ask your advisor for a new one.",
};

export default function AccessPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <h1 className="text-3xl font-semibold sm:text-4xl">Open your borrower portal</h1>
      <p className="mt-3 max-w-2xl text-[17px] text-ink/80">Your advisor sent you a secure, single-use link. Continue to open the portal on this device.</p>
      <Suspense fallback={null}>
        <AccessForm searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AccessForm({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const error = pick(sp.error);
  const token = pick(sp.token) ?? "";
  if (error) {
    return (
      <p role="alert" className="mt-6 max-w-2xl rounded-2xl border border-red-700/40 bg-red-50 px-4 py-3 text-[15px] text-red-900">
        {ERRORS[error] ?? ERRORS.invalid}
      </p>
    );
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return (
      <p role="alert" className="mt-6 max-w-2xl rounded-2xl border border-red-700/40 bg-red-50 px-4 py-3 text-[15px] text-red-900">
        {ERRORS.invalid}
      </p>
    );
  }
  return (
    <form method="post" action="/portal/access/redeem" className="mt-8">
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="pill pill-primary">
        Continue to the portal
      </button>
      <p className="mt-3 text-[13px] text-ink/80">The session ends after a few hours or when you sign out.</p>
    </form>
  );
}
