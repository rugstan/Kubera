import * as Sentry from "@sentry/nextjs";
import { buildSentryOptions } from "./sentry.options";

// Browser runtime. Only NEXT_PUBLIC_* values are available here, and they are
// inlined at build time. Session replay is intentionally not enabled: forms on
// this site collect borrower financials and contact details.
const options = buildSentryOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
});

if (options) Sentry.init(options);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
