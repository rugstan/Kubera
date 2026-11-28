import "server-only";
import { cookies } from "next/headers";

// The one-time hand-off after a broker approves a submission while email to
// lenders is off: the share URL (and the outreach row whose approved email it
// fills in) ride in short-lived, http-only cookies scoped to the deal page, so
// the link is shown on the next page view and never lands in a URL or a log.

const SHARE_URL = "deal_share_url";
const SHARE_OUTREACH = "deal_share_outreach";

const scope = (dealId: string) => ({ httpOnly: true, secure: true, sameSite: "strict" as const, path: `/deals/${encodeURIComponent(dealId)}`, maxAge: 120 });

/** Keeps the share URL (and its outreach row) for the deal page's next view. */
export async function rememberShareLink(dealId: string, shareUrl: string, outreachId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SHARE_URL, shareUrl, scope(dealId));
  jar.set(SHARE_OUTREACH, outreachId, scope(dealId));
}

/** The share URL waiting to be shown on this deal page, with its outreach row; null when none. */
export async function pendingShareLink(): Promise<{ shareUrl: string; outreachId: string | null } | null> {
  const jar = await cookies();
  const shareUrl = jar.get(SHARE_URL)?.value;
  return shareUrl ? { shareUrl, outreachId: jar.get(SHARE_OUTREACH)?.value ?? null } : null;
}

/** Ends the one-time view once the submission is marked sent or withdrawn (server actions only). */
export async function forgetShareLink(dealId: string): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: SHARE_URL, path: scope(dealId).path });
  jar.delete({ name: SHARE_OUTREACH, path: scope(dealId).path });
}
