import type { Metadata } from "next";
import { Suspense } from "react";
import { safeNextPath } from "@/lib/auth/session";
import { confirmLinkAction } from "../../actions";
import { AuthCard, Notice, SubmitButton } from "../../ui";

export const metadata: Metadata = { title: "Confirm sign-in", referrer: "no-referrer" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Magic links land here. Opening the link does not sign anyone in: the button
// does, so email security scanners that open links cannot use up the token.
export default function ConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard title="Confirm sign-in">
      <Suspense fallback={<div className="h-24" aria-hidden="true" />}>
        <ConfirmForm searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function ConfirmForm({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tokenHash = typeof sp.token_hash === "string" ? sp.token_hash : "";
  const next = typeof sp.next === "string" && sp.next ? safeNextPath(sp.next) : "";
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(tokenHash)) {
    return <Notice tone="error">This sign-in link is incomplete. Request a new code from the sign-in page.</Notice>;
  }
  return (
    <form action={confirmLinkAction} className="mt-4 grid gap-4">
      <p className="text-[15px] leading-relaxed text-titanium">Continue to finish signing in on this device.</p>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="next" value={next} />
      <SubmitButton>Continue</SubmitButton>
    </form>
  );
}
