// Content Security Policy and security headers, applied by next.config.ts.
//
// Cache Components serves a prerendered static shell, so there is no
// per-request nonce to stamp on Next's inline bootstrap scripts; script-src
// therefore allows 'unsafe-inline' and restricts *where* scripts load from.
// Everything else (frames, connections, form targets, object/base) is locked
// down to the services the site actually uses.

export type CspEnv = {
  NODE_ENV?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  CSP_REPORT_URI?: string;
  ZOHO_SIGN_DC?: string;
};

const TURNSTILE = "https://challenges.cloudflare.com";
const CAL = ["https://app.cal.com", "https://cal.com"];
const VERCEL_ANALYTICS = "https://va.vercel-scripts.com";
const SENTRY = ["https://*.ingest.sentry.io", "https://*.ingest.us.sentry.io", "https://*.ingest.de.sentry.io"];

// Zoho Sign data centers (same list lib/esign/zoho-sign.ts accepts). Embedded
// signing frames and its API calls must reach the configured one.
const ZOHO_SIGN_DCS = new Set(["com", "eu", "in", "com.au", "jp", "ca", "sa", "com.cn"]);

function zohoSignOrigins(env: CspEnv): string[] {
  const dc = env.ZOHO_SIGN_DC && ZOHO_SIGN_DCS.has(env.ZOHO_SIGN_DC) ? env.ZOHO_SIGN_DC : "com";
  return Array.from(new Set(["https://sign.zoho.com", `https://sign.zoho.${dc}`]));
}

function supabaseOrigins(env: CspEnv): string[] {
  const configured = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (configured) {
    try {
      const u = new URL(configured);
      return [u.origin, `wss://${u.host}`];
    } catch {
      // fall through to the wildcard
    }
  }
  return ["https://*.supabase.co", "wss://*.supabase.co"];
}

export function buildCsp(env: CspEnv = process.env): string {
  const dev = env.NODE_ENV !== "production";
  const supabase = supabaseOrigins(env);
  const zohoSign = zohoSignOrigins(env);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // React dev tooling needs eval; production never does.
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), TURNSTILE, "https://app.cal.com", VERCEL_ANALYTICS],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...supabase.filter((s) => s.startsWith("https:"))],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...supabase, TURNSTILE, ...CAL, ...SENTRY, ...zohoSign, ...(dev ? ["ws:"] : [])],
    "frame-src": ["'self'", TURNSTILE, ...CAL, ...zohoSign],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  if (env.CSP_REPORT_URI) parts.push(`report-uri ${env.CSP_REPORT_URI}`);
  return parts.join("; ");
}

export function securityHeaders(env: CspEnv = process.env): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: buildCsp(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    // No payment APIs anywhere: Corin never handles funds.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    // same-origin-allow-popups keeps Cal.com and Turnstile popups working.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "X-DNS-Prefetch-Control", value: "on" },
  ];
}
