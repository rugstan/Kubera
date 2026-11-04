import { buildSentryOptions } from "./sentry.options";

// Browser runtime. Only NEXT_PUBLIC_* values are available here, and they are
// inlined at build time. Session replay is intentionally not enabled: forms on
// this site collect borrower financials and contact details.
//
// The SDK is loaded only when a DSN is configured. This file runs before every
// page becomes interactive, and a static import put the whole SDK (tracing
// included) into that first script even with Sentry switched off, which delayed
// the first tap on the header menu. With a DSN, the SDK arrives a moment after
// start-up instead.
const options = buildSentryOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
});

type SentrySdk = typeof import("@sentry/nextjs");
let sdk: SentrySdk | null = null;

if (options) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(options);
    sdk = Sentry;
  });
}

export function onRouterTransitionStart(...args: Parameters<SentrySdk["captureRouterTransitionStart"]>): void {
  sdk?.captureRouterTransitionStart(...args);
}
