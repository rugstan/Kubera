"use client";

import "@fontsource-variable/inter";
import "./globals.css";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last-resort boundary for errors in the root layout. It replaces the root
// layout, so it renders its own document and cannot rely on the header,
// footer or any provider. Plain <a> links force a full reload, which is what a
// broken root layout needs.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // No-op until Sentry is initialised (NEXT_PUBLIC_SENTRY_DSN set).
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <title>Something went wrong · Kubera Commercial</title>
        <main id="main-content" className="mx-auto max-w-[1280px] px-5 py-20 md:px-8 md:py-32">
          <div className="max-w-2xl">
            <p className="eyebrow">Kubera Commercial</p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.08] md:text-6xl">Something went wrong.</h1>
            <p className="mt-5 text-lg leading-relaxed text-titanium md:text-xl">
              An unexpected error stopped the site from loading. Try again, or contact a licensed advisor and we will pick up
              from there.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <button type="button" onClick={() => retry()} className="pill pill-primary">Try again</button>
              <a href="/contact" className="pill pill-glass">Talk to an advisor</a>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is intended after a root-layout crash */}
              <a href="/" className="pill pill-glass">Go to the homepage</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
