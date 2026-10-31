// Shared, env-gated Sentry options for the server, edge and browser runtimes.
// No DSN means no SDK initialisation at all (Global rule 3): the app behaves
// exactly as it does without Sentry and logs a single line saying so.

import { scrubBreadcrumb, scrubEvent, scrubSpan } from "./sentry.scrub";

export type SentryOptions = {
  dsn: string;
  environment: string;
  release?: string;
  sendDefaultPii: false;
  tracesSampleRate: number;
  maxBreadcrumbs: number;
  beforeSend: typeof scrubEvent;
  beforeSendSpan: typeof scrubSpan;
  beforeBreadcrumb: typeof scrubBreadcrumb;
};

export type SentryEnv = {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: string;
};

/** Parses a 0..1 sample rate; anything else falls back to the default. */
export function parseSampleRate(raw: string | undefined, fallback = 0.1): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** Returns null when no usable DSN is configured. */
export function buildSentryOptions(env: SentryEnv): SentryOptions | null {
  const dsn = env.dsn?.trim();
  if (!dsn || !/^https?:\/\//i.test(dsn)) return null;
  return {
    dsn,
    environment: env.environment?.trim() || "development",
    ...(env.release ? { release: env.release } : {}),
    sendDefaultPii: false,
    tracesSampleRate: parseSampleRate(env.tracesSampleRate),
    maxBreadcrumbs: 50,
    beforeSend: scrubEvent,
    beforeSendSpan: scrubSpan,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

let warned = false;
/** Logs once per process that error reporting is off. */
export function warnSentryDisabledOnce(where: string): void {
  if (warned || process.env.NODE_ENV === "test") return;
  warned = true;
  console.info(`Sentry is disabled (${where}): no DSN configured.`);
}
