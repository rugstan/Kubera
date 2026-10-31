"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { StatusPanel } from "@/components/site/StatusPanel";

// Render errors in a marketing page. The (site) layout above this boundary
// still renders, so the header, <main id="main-content"> and footer stay put.
export default function SiteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // No-op until Sentry is initialised (NEXT_PUBLIC_SENTRY_DSN set).
    Sentry.captureException(error);
  }, [error]);

  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : undefined;

  return (
    <StatusPanel
      eyebrow="Something went wrong"
      title="This page didn't load."
      actions={
        <>
          <button type="button" onClick={() => retry()} className="pill pill-primary">Try again</button>
          <Link href="/contact" className="pill pill-glass">Talk to an advisor</Link>
        </>
      }
    >
      <p>An unexpected error stopped this page from loading. Try again, or contact a licensed advisor and we will pick up from there.</p>
      {digest && <p className="mt-3 text-[13px]">Reference: {digest}</p>}
    </StatusPanel>
  );
}
