// Where the floating "Ask Kubera AI" button may appear.

/** Focused funnels where an AI side door competes with the form itself. */
const HIDDEN_PREFIXES = ["/express", "/partners"] as const;

export function isAskButtonRouteHidden(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Scroll distance (px) after which the desktop floating button appears. */
export const DESKTOP_REVEAL_SCROLL_PX = 600;

export function isPastDesktopThreshold(scrollY: number): boolean {
  return scrollY > DESKTOP_REVEAL_SCROLL_PX;
}
