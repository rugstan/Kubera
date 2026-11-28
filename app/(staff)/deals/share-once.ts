import "server-only";
import { cookies } from "next/headers";

// The one-time hand-off after a broker approves a submission while email to
// lenders is off: the share URL (and the outreach row whose approved email it
// fills in) ride in short-lived, http-only cookies scoped to the deal page, so
// the link never lands in a URL or a log. The page only learns that one is
// waiting (hasPendingShareLink); the first render claims it through a server
// action (claimShareLink), which reads and deletes the cookies in the same
// step, so a refresh, a second tab or the back button never shows it again.
// The 120-second lifetime is only the backstop for a page that never loads.

const SHARE_URL = "deal_share_url";
const SHARE_OUTREACH = "deal_share_outreach";

const scope = (dealId: string) => ({ httpOnly: true, secure: true, sameSite: "strict" as const, path: `/deals/${encodeURIComponent(dealId)}`, maxAge: 120 });

/** Keeps the share URL (and its outreach row) for the deal page's next view (server actions only). */
export async function rememberShareLink(dealId: string, shareUrl: string, outreachId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SHARE_URL, shareUrl, scope(dealId));
  jar.set(SHARE_OUTREACH, outreachId, scope(dealId));
}

/** Whether a share URL is waiting to be claimed on this deal page (rendering only reads; it never reveals the URL). */
export async function hasPendingShareLink(): Promise<boolean> {
  return Boolean((await cookies()).get(SHARE_URL)?.value);
}

/** Takes the waiting share URL and its outreach row, deleting both cookies; null when none (server actions only). */
export async function claimShareLink(dealId: string): Promise<{ shareUrl: string; outreachId: string | null } | null> {
  const jar = await cookies();
  const shareUrl = jar.get(SHARE_URL)?.value;
  const outreachId = jar.get(SHARE_OUTREACH)?.value ?? null;
  await forgetShareLink(dealId);
  return shareUrl ? { shareUrl, outreachId } : null;
}

/** Ends the one-time view once the submission is marked sent or withdrawn (server actions only). */
export async function forgetShareLink(dealId: string): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: SHARE_URL, path: scope(dealId).path });
  jar.delete({ name: SHARE_OUTREACH, path: scope(dealId).path });
}
