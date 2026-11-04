"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

type Target = "login" | "refresh" | "mfa" | "denied" | "unavailable";

const COPY: Record<Target, string> = {
  login: "Sign in to continue.",
  refresh: "Renewing your session…",
  mfa: "Confirm with your authenticator app to continue.",
  denied: "Your account does not have access to the staff area.",
  unavailable: "Staff sign-in is not configured on this deployment.",
};

/** Sends the visitor to the right sign-in step, keeping the page they asked for. */
export function SignInRedirect({ to, reason }: { to: Target; reason?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const href = useMemo(() => {
    const qs = search.toString();
    const next = encodeURIComponent(`${pathname}${qs ? `?${qs}` : ""}`);
    switch (to) {
      case "refresh":
        return `/auth/refresh?next=${next}`;
      case "mfa":
        return `/mfa?next=${next}`;
      case "denied":
        return `/access-denied?reason=${encodeURIComponent(reason ?? "not_staff")}`;
      case "unavailable":
        return "/login?error=unavailable";
      default:
        return `/login?next=${next}`;
    }
  }, [pathname, search, to, reason]);

  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <div className="bento mx-auto max-w-md p-8 text-center" role="status">
      <p className="text-[15px] text-ink">{COPY[to]}</p>
      <Link href={href} className="pill pill-primary mt-5">
        Continue
      </Link>
    </div>
  );
}
