"use client";

import { useEffect } from "react";

/**
 * Publishes the sticky staff header's real height as `--staff-header-height`
 * on <html>, which app/globals.css turns into scroll-padding-top for staff
 * pages. The header is two rows (brand and account, then the nav) and the nav
 * wraps onto more rows between sm and lg, so a fixed value would leave a
 * focused field under the header at some widths (WCAG 2.2 SC 2.4.11).
 */
export function HeaderScrollOffset({ headerId }: { headerId: string }) {
  useEffect(() => {
    const header = document.getElementById(headerId);
    if (!header) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--staff-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    update();
    if (typeof ResizeObserver === "undefined") return () => root.style.removeProperty("--staff-header-height");
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--staff-header-height");
    };
  }, [headerId]);
  return null;
}
