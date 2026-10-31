import type { Metadata } from "next";
import { Suspense } from "react";
import { signOutAction } from "../actions";
import { AuthCard } from "../ui";

export const metadata: Metadata = { title: "No access" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const COPY: Record<string, string> = {
  not_staff: "This area is for Kubera staff. Your account does not have a staff role.",
  inactive: "Your account is not active, or no role has been assigned to it yet.",
};

export default function AccessDeniedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard title="No access">
      <Suspense fallback={<p className="mt-2 text-[15px] text-titanium">{COPY.inactive}</p>}>
        <Reason searchParams={searchParams} />
      </Suspense>
      <p className="mt-3 text-[15px] leading-relaxed text-titanium">If you think this is a mistake, ask a Kubera administrator to check your account.</p>
      <form action={signOutAction} className="mt-5">
        <button type="submit" className="pill pill-glass w-full">
          Sign out
        </button>
      </form>
    </AuthCard>
  );
}

async function Reason({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const reason = typeof sp.reason === "string" ? sp.reason : "inactive";
  return <p className="mt-2 text-[15px] leading-relaxed text-ink">{COPY[reason] ?? COPY.inactive}</p>;
}
