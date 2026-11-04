"use server";

// Borrower portal: UETA consent to sign the MLDS (RE 882) electronically.
// The signed-in borrower consents for themselves only, on their own deal; the
// consent text version, time, IP and user agent are stored with the
// disclosure so the exact text is provable.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MldsDeskError, recordPortalUetaConsent } from "@/lib/deals/mlds";
import { supabaseDisclosureBackends } from "@/lib/disclosures/store-supabase";
import { rateLimit } from "@/lib/ratelimit";
import { isContext, portalContext } from "./_lib/session";

const field = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export async function esignConsentAction(f: FormData): Promise<never> {
  const ctx = await portalContext();
  if (!isContext(ctx)) redirect("/portal");
  let target = "/portal?consent=recorded#esign";
  try {
    const backends = supabaseDisclosureBackends();
    if (!backends) throw new MldsDeskError("The portal cannot record your consent right now. Ask your advisor.");
    if (!(await rateLimit(`portal-esign-consent:${ctx.session.email}`, 20, 10 * 60_000))) throw new MldsDeskError("Too many attempts. Please wait a few minutes and try again.");
    const h = await headers();
    await recordPortalUetaConsent({ disclosures: backends.store, now: () => new Date() }, { dealId: ctx.session.dealId, email: ctx.session.email }, {
      disclosureId: field(f, "disclosureId"),
      textVersion: field(f, "textVersion"),
      agreed: f.get("agree") === "on",
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip"),
      userAgent: h.get("user-agent"),
    });
  } catch (err) {
    if (!(err instanceof MldsDeskError)) console.error("[portal] e-sign consent failed", err instanceof Error ? err.message : err);
    const message = err instanceof MldsDeskError ? err.message : "Something went wrong; your consent was not recorded. Please try again.";
    target = `/portal?consent_error=${encodeURIComponent(message.slice(0, 300))}#esign`;
  }
  redirect(target);
}
