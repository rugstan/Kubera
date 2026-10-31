import { NextResponse } from "next/server";
import { deskServices } from "@/lib/checklists/server";
import { encodeSession, PORTAL_COOKIE, PortalLinkError, portalSessionSecret, redeemPortalLink } from "@/lib/principals/portal";
import { isAllowedOrigin } from "@/lib/security";

// Redeems a portal magic link. The link page (/portal/access) only shows a
// "Continue" button that POSTs here, so mail scanners that prefetch links
// cannot use up the single-use token. Errors go back without the token.

const back = (req: Request, path: string) => NextResponse.redirect(new URL(path, req.url), { status: 303, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!isAllowedOrigin(req.headers.get("origin"))) return new NextResponse("Forbidden", { status: 403 });
  const services = deskServices();
  const secret = portalSessionSecret();
  if (!services || !secret) return back(req, "/portal?state=unavailable");

  let token = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") ?? "").trim();
  } catch {
    return back(req, "/portal/access?error=invalid");
  }

  try {
    const session = await redeemPortalLink(services.invites, token, services.now?.() ?? new Date());
    const res = back(req, "/portal");
    res.cookies.set(PORTAL_COOKIE, encodeSession(session, secret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/portal",
      expires: new Date(session.expiresAt),
    });
    return res;
  } catch (err) {
    if (err instanceof PortalLinkError) return back(req, `/portal/access?error=${err.code}`);
    console.error("[portal] link redeem failed", err instanceof Error ? err.message : err);
    return back(req, "/portal/access?error=invalid");
  }
}
