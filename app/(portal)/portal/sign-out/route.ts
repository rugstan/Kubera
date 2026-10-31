import { NextResponse } from "next/server";
import { deskServices } from "@/lib/checklists/server";
import { decodeSession, PORTAL_COOKIE, portalSessionSecret } from "@/lib/principals/portal";
import { isAllowedOrigin } from "@/lib/security";
import { cookieValue } from "../_lib/request";

// Ends the portal session: clears the cookie and revokes the link it came
// from, so the session cannot be replayed.

export async function POST(req: Request) {
  if (!isAllowedOrigin(req.headers.get("origin"))) return new NextResponse("Forbidden", { status: 403 });
  const services = deskServices();
  const secret = portalSessionSecret();
  if (services && secret) {
    const now = services.now?.() ?? new Date();
    const session = decodeSession(cookieValue(req, PORTAL_COOKIE), secret, now);
    if (session) await services.invites.revoke(session.inviteId, now).catch(() => {});
  }
  const res = NextResponse.redirect(new URL("/portal?state=signed_out", req.url), { status: 303, headers: { "cache-control": "no-store" } });
  res.cookies.set(PORTAL_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/portal", maxAge: 0 });
  return res;
}
