import * as Sentry from "@sentry/nextjs";
import { buildSentryOptions, warnSentryDisabledOnce } from "./sentry.options";

// Loaded from instrumentation.ts for the Edge runtime (proxy.ts).
const options = buildSentryOptions({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
});

if (options) Sentry.init(options);
else warnSentryDisabledOnce("edge");
