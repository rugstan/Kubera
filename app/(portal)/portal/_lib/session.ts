import "server-only";
import { cookies } from "next/headers";
import { deskServices } from "@/lib/checklists/server";
import type { DeskServices } from "@/lib/checklists/desk";
import { PORTAL_COOKIE, portalSessionSecret, verifySession, type PortalSession } from "@/lib/principals/portal";

export type PortalContext = { session: PortalSession; services: DeskServices };

/** Why there is no portal context: not configured at all, or no valid session. */
export type PortalUnavailable = { reason: "unconfigured" | "signed_out" };

/** Resolves the borrower's portal session from the cookie and re-checks it against the invite. */
export async function portalContext(): Promise<PortalContext | PortalUnavailable> {
  // Read the request first so the page always renders per request, even when
  // the build ran without Supabase configured.
  const jar = await cookies();
  const services = deskServices();
  const secret = portalSessionSecret();
  if (!services || !secret) return { reason: "unconfigured" };
  const session = await verifySession(services.invites, jar.get(PORTAL_COOKIE)?.value, secret, services.now?.() ?? new Date());
  return session ? { session, services } : { reason: "signed_out" };
}

export function isContext(v: PortalContext | PortalUnavailable): v is PortalContext {
  return "session" in v;
}
