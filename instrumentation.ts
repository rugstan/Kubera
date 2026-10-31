import * as Sentry from "@sentry/nextjs";

// Runs once per server instance. Sentry is env-gated inside each config file,
// so this is a no-op until a DSN is set.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

// Reports errors from Server Components, route handlers and proxy.
export const onRequestError = Sentry.captureRequestError;
