import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentSignIn } from "@/lib/auth/dal";
import { requiresMfa } from "@/lib/auth/policy";
import { safeNextPath } from "@/lib/auth/session";
import { AuthCard } from "../ui";
import { MfaChallenge, MfaEnroll } from "./forms";

export const metadata: Metadata = { title: "Two-step verification" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function MfaPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard title="Two-step verification" intro="Staff accounts confirm every sign-in with a code from an authenticator app.">
      <Suspense fallback={<div className="h-40" aria-hidden="true" />}>
        <MfaStep searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function MfaStep({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  const self = `/mfa?next=${encodeURIComponent(next)}`;
  const l = await currentSignIn();
  if (l.status === "disabled") redirect("/login?error=unavailable");
  if (l.status === "signed_out") redirect(`/login?next=${encodeURIComponent(next)}`);
  if (l.status === "needs_refresh") redirect(`/auth/refresh?next=${encodeURIComponent(self)}`);
  if (l.session.aal === "aal2" || !requiresMfa(l.roles)) redirect(next);

  const factors = await l.services.provider.listTotpFactors(l.stored);
  const verified = factors.find((f) => f.status === "verified");
  return verified ? <MfaChallenge factorId={verified.id} next={next} /> : <MfaEnroll next={next} />;
}
