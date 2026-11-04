import { NextResponse } from "next/server";
import { refreshCurrentSession } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/auth/session";

// Server components cannot write cookies, so an expiring session is sent here:
// the refresh token is rotated, the cookie rewritten, and the person returns
// to the page they asked for. A session that cannot be refreshed signs in again.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("next");
  const next = safeNextPath(raw);
  const fresh = await refreshCurrentSession();
  const target = fresh ? next : `/login?next=${encodeURIComponent(next)}`;
  const res = NextResponse.redirect(new URL(target, url.origin), 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}
