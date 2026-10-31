import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { currentSignIn } from "@/lib/auth/dal";
import { displayName, evaluateStaffAccess } from "@/lib/auth/policy";
import { site } from "@/lib/site";
import { SignInRedirect } from "@/lib/auth/sign-in-redirect";

export const metadata: Metadata = {
  title: { default: "Staff", template: "%s · Kubera staff" },
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/pipeline", label: "Pipeline" },
  { href: "/approvals", label: "Approvals" },
  { href: "/documents", label: "Documents" },
  { href: "/deals", label: "Deal desk" },
  { href: "/checklists", label: "Checklists" },
  { href: "/construction", label: "Construction" },
  { href: "/lenders", label: "Lenders" },
  { href: "/ai-review", label: "AI review" },
  { href: "/reports", label: "Reports" },
  { href: "/prospects", label: "Prospects" },
] as const;

// The staff shell. The static chrome prerenders; who is signed in streams in
// behind Suspense. This layout's check is a convenience: every staff page,
// server action and route handler authorizes itself through lib/auth/dal.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="glass sticky top-0 z-40 border-b border-hairline">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/pipeline" className="rounded-md text-[15px] font-semibold tracking-tight text-ink">
            {site.name} <span className="font-normal text-titanium">· Staff</span>
          </Link>
          <nav aria-label="Staff" className="order-3 w-full sm:order-none sm:w-auto">
            <ul className="flex gap-1 overflow-x-auto">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="inline-flex min-h-11 items-center rounded-full px-3.5 text-[14px] font-medium text-ink hover:bg-black/5">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto">
            <Suspense fallback={<span className="text-[13px] text-titanium">Loading…</span>}>
              <AccountMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Suspense fallback={<p className="text-[15px] text-titanium">Loading…</p>}>
          <StaffGate>{children}</StaffGate>
        </Suspense>
      </main>
    </div>
  );
}

async function signedInStaff() {
  const l = await currentSignIn();
  if (l.status !== "signed_in") return null;
  const d = evaluateStaffAccess({ session: { userId: l.session.user.id, email: l.session.user.email, aal: l.session.aal }, profile: l.profile, roles: l.roles });
  return d.kind === "allow" ? d.principal : null;
}

async function AccountMenu() {
  const principal = await signedInStaff();
  if (!principal) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-right text-[13px] leading-tight sm:block">
        <span className="block font-medium text-ink">{displayName(principal.profile)}</span>
        <span className="block capitalize text-titanium">{principal.staffRoles.join(", ")}</span>
      </span>
      <form action={signOutAction}>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-full border border-black/10 bg-white px-4 text-[14px] font-medium text-ink hover:bg-black/5">
          Sign out
        </button>
      </form>
    </div>
  );
}

/**
 * Renders the page only for signed-in staff with MFA. Anyone else is sent on
 * (sign-in, session refresh, MFA or access denied) with the current path kept.
 */
async function StaffGate({ children }: { children: React.ReactNode }) {
  const l = await currentSignIn();
  if (l.status === "signed_in") {
    const d = evaluateStaffAccess({ session: { userId: l.session.user.id, email: l.session.user.email, aal: l.session.aal }, profile: l.profile, roles: l.roles });
    if (d.kind === "allow") return <>{children}</>;
    return <SignInRedirect to={d.kind === "mfa" ? "mfa" : d.kind === "forbidden" ? "denied" : "login"} reason={d.kind === "forbidden" ? d.reason : undefined} />;
  }
  return <SignInRedirect to={l.status === "needs_refresh" ? "refresh" : l.status === "disabled" ? "unavailable" : "login"} />;
}
