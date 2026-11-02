// Portal session lookup for route handlers, read from the request's Cookie
// header so the handlers stay testable without a Next request scope.

import { deskServices } from "@/lib/checklists/server";
import type { DeskServices } from "@/lib/checklists/desk";
import { PORTAL_COOKIE, portalSessionSecret, verifySession, type PortalSession } from "@/lib/principals/portal";

export function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export type RequestPortal = { ok: true; session: PortalSession; services: DeskServices } | { ok: false; status: 401 | 503; error: string };

export async function portalFromRequest(req: Request): Promise<RequestPortal> {
  const services = deskServices();
  const secret = portalSessionSecret();
  if (!services || !secret) return { ok: false, status: 503, error: "The borrower portal is not available right now. Email your advisor or docs@corincommercial.com." };
  const session = await verifySession(services.invites, cookieValue(req, PORTAL_COOKIE), secret, services.now?.() ?? new Date());
  if (!session) return { ok: false, status: 401, error: "Your portal session has ended. Use a new link from your advisor." };
  return { ok: true, session, services };
}
