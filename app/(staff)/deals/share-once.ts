import "server-only";
import { cookies } from "next/headers";

// The one-time hand-off after a broker approves a submission while email to
// lenders is off: the share URL, the outreach row whose approved email it
// fills in, and the deal it belongs to ride in one short-lived, http-only
// cookie scoped to that deal's page, so the link never lands in a URL or a
// log. The page only learns that one is waiting (hasPendingShareLink); the
// first render claims it through a server action (claimShareLink), which
// reads and deletes the cookie in the same step, so a refresh, a second tab
// or the back button never shows it again. A claim names its deal: one for
// another deal is refused and consumes nothing, and the delete always goes
// to the path the cookie was set on. The 120-second lifetime is only the
// backstop for a page that never loads.

const SHARE_COOKIE = "deal_share";

const pathFor = (dealId: string) => `/deals/${encodeURIComponent(dealId)}`;
const scope = (dealId: string) => ({ httpOnly: true, secure: true, sameSite: "strict" as const, path: pathFor(dealId), maxAge: 120 });

type Stored = { dealId: string; shareUrl: string; outreachId: string | null };

function read(value: string | undefined): Stored | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<Record<keyof Stored, unknown>>;
    if (typeof v.dealId !== "string" || !v.dealId || typeof v.shareUrl !== "string" || !v.shareUrl) return null;
    return { dealId: v.dealId, shareUrl: v.shareUrl, outreachId: typeof v.outreachId === "string" ? v.outreachId : null };
  } catch {
    return null;
  }
}

/** Keeps the share URL (and its outreach row) for the deal page's next view (server actions only). */
export async function rememberShareLink(dealId: string, shareUrl: string, outreachId: string): Promise<void> {
  const value: Stored = { dealId, shareUrl, outreachId };
  (await cookies()).set(SHARE_COOKIE, JSON.stringify(value), scope(dealId));
}

/** Whether a share URL for this deal is waiting to be claimed (rendering only reads; it never reveals the URL). */
export async function hasPendingShareLink(dealId: string): Promise<boolean> {
  return read((await cookies()).get(SHARE_COOKIE)?.value)?.dealId === dealId;
}

/**
 * Takes the waiting share URL and its outreach row for `dealId`, deleting the
 * cookie at the path it was stored on; null when none. A cookie stored for
 * another deal is refused and left in place (server actions only).
 */
export async function claimShareLink(dealId: string): Promise<{ shareUrl: string; outreachId: string | null } | null> {
  const jar = await cookies();
  const raw = jar.get(SHARE_COOKIE)?.value;
  if (!raw) return null;
  const stored = read(raw);
  if (stored && stored.dealId !== dealId) return null;
  // A cookie that does not parse is removed at the caller's path, where it was sent from.
  jar.delete({ name: SHARE_COOKIE, path: pathFor(stored?.dealId ?? dealId) });
  return stored ? { shareUrl: stored.shareUrl, outreachId: stored.outreachId } : null;
}

/** Ends the one-time view once the submission is marked sent or withdrawn (server actions only). */
export async function forgetShareLink(dealId: string): Promise<void> {
  (await cookies()).delete({ name: SHARE_COOKIE, path: pathFor(dealId) });
}
