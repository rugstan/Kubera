import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { creditAuthText, CURRENT_CREDIT_AUTH } from "@/lib/principals/consent";
import { buildOrgChart } from "@/lib/principals/org-chart";
import { principalObligations } from "@/lib/principals/requirements";
import { toPublicPrincipal } from "@/lib/principals/service";
import { FORM_1919_QUESTIONS } from "@/lib/principals/types";
import { ProfileForm } from "../_components/ProfileForm";
import { loadPortalPrincipal } from "../_lib/profile";
import { isContext, portalContext } from "../_lib/session";

export const metadata: Metadata = { title: "Your profile" };

export default function ProfilePage() {
  return (
    <>
      <p>
        <Link href="/portal" className="text-[15px] font-medium text-accent underline underline-offset-2">
          ← Your documents
        </Link>
      </p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Your profile</h1>
      <Suspense fallback={<p className="mt-6 text-[15px] text-ink/80">Loading your profile…</p>}>
        <Profile />
      </Suspense>
    </>
  );
}

async function Profile() {
  const ctx = await portalContext();
  if (!isContext(ctx)) {
    return (
      <p className="mt-6 text-[15px]">
        Your session has ended.{" "}
        <Link href="/portal" className="font-medium text-accent underline underline-offset-2">
          Sign in again with a new link
        </Link>
        .
      </p>
    );
  }
  const view = await loadPortalPrincipal(ctx.services, ctx.session);
  if (!view || view.kind !== "individual") {
    return <p className="mt-6 text-[15px]">This link is for the deal&apos;s documents. Ask your advisor for a link in your own name to complete a personal profile.</p>;
  }
  const [checklists, rows] = await Promise.all([ctx.services.checklists.checklistsForDeal(ctx.session.dealId), ctx.services.principals.forDeal(ctx.session.dealId)]);
  const principals = rows.map(toPublicPrincipal);
  const owes = principalObligations(checklists.map((c) => c.program), principals, buildOrgChart(principals)).get(view.id)?.requirements ?? new Set();
  return (
    <>
      <p className="mt-2 text-[15px] text-ink/80">
        {view.legalName} · {view.email}
      </p>
      <ProfileForm
        initial={view}
        sections={{ pfs: owes.has("pfs"), reo: owes.has("reo_schedule"), hud2530: owes.has("hud_2530"), form1919: owes.has("form_1919"), credit: owes.has("credit_authorization") || !view.creditAuthorizedAt }}
        questions={{ ...FORM_1919_QUESTIONS }}
        creditText={creditAuthText(CURRENT_CREDIT_AUTH).text}
        creditVersion={CURRENT_CREDIT_AUTH}
      />
    </>
  );
}
