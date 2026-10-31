"use client";

import { useEffect } from "react";
import { analytics } from "@/lib/analytics/client";

/**
 * Starts cookieless analytics when NEXT_PUBLIC_ANALYTICS=vercel. Renders
 * nothing. Starting is idempotent, so it is safe to mount from several places:
 * the forms mount it themselves, and the root layout can mount it for
 * site-wide page views.
 */
export function Analytics() {
  useEffect(() => {
    analytics().start();
  }, []);
  return null;
}
