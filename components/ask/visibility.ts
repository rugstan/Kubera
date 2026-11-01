// Where the floating "Ask Kubera AI" button may appear.

import { STAFF_ROUTE_PREFIXES } from "@/lib/auth/staff-routes";

/**
 * Focused funnels where an AI side door competes with the form itself, plus
 * the staff app (every desk in the staff nav), borrower portal and sign-in
 * pages, where the public advisor does not belong.
 */
const HIDDEN_PREFIXES: readonly string[] = [
  "/express",
  "/partners",
  ...STAFF_ROUTE_PREFIXES,
  "/portal",
  "/login",
  "/mfa",
  "/auth",
  "/access-denied",
];

export function isAskButtonRouteHidden(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Scroll distance (px) after which the desktop floating button appears. */
export const DESKTOP_REVEAL_SCROLL_PX = 600;

export function isPastDesktopThreshold(scrollY: number): boolean {
  return scrollY > DESKTOP_REVEAL_SCROLL_PX;
}
