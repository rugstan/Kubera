import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { rateLimiter, type RateLimitRule } from "@/lib/ratelimit";
import { TURNSTILE_HEADER, turnstileVerifier, type TurnstileAction } from "@/lib/turnstile";

// Request hardening shared by the public POST endpoints: Origin allowlist,
// JSON-only bodies with a size cap, a shared rate limiter, and Cloudflare
// Turnstile. `guardPost` composes them in that order so the cheap checks run
// before we spend a Redis round-trip or a siteverify call.

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Salted one-way IP fingerprint for records that do not need the raw address. */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT || process.env.LEAD_TOKEN_SECRET || "corin";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

// --- Origin allowlist --------------------------------------------------------

const PRODUCTION_ORIGINS = [
  "https://corincommercial.com",
  "https://www.corincommercial.com",
  "https://kubera.loans",
  "https://www.kubera.loans",
];

function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Origins allowed to call the intake APIs: both production domains, the
 * configured site URL, Vercel deployment URLs for this project, anything in
 * ALLOWED_ORIGINS (comma-separated), and localhost outside production.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const out = new Set(PRODUCTION_ORIGINS);
  const add = (v: string | undefined, prefix = "") => {
    if (!v) return;
    const o = normalizeOrigin(prefix + v);
    if (o) out.add(o);
  };
  add(env.NEXT_PUBLIC_SITE_URL);
  for (const host of (env.EXPRESS_HOSTS ?? "").split(",")) add(host.trim() || undefined, "https://");
  add(env.VERCEL_URL, "https://");
  add(env.VERCEL_BRANCH_URL, "https://");
  add(env.VERCEL_PROJECT_PRODUCTION_URL, "https://");
  for (const o of (env.ALLOWED_ORIGINS ?? "").split(",")) add(o.trim() || undefined);
  return out;
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return false;
  const o = normalizeOrigin(origin);
  if (!o) return false;
  if (allowedOrigins(env).has(o)) return true;
  return env.NODE_ENV !== "production" && isLocalOrigin(o);
}

/** Hostnames a Turnstile token may have been minted on (derived from the origin allowlist). */
export function allowedHostnames(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...allowedOrigins(env)].map((o) => new URL(o).hostname);
}

// --- Content type -----------------------------------------------------------------

export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const [type = ""] = value.split(";");
  return type.trim().toLowerCase() === "application/json";
}

// --- Composite guard ---------------------------------------------------------------

export type GuardOptions = {
  /** Rate-limit bucket name, e.g. "qualify". */
  name: string;
  rate: RateLimitRule;
  rateLimitMessage?: string;
  /** Require a Turnstile token for this request (verified only when Turnstile is configured). */
  turnstile?: TurnstileAction | false;
  /** Maximum body size in bytes. */
  maxBytes?: number;
};

export type GuardResult<T = unknown> = { ok: true; body: T; ip: string } | { ok: false; response: NextResponse };

const json = (status: number, error: string, headers?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } });

/**
 * Runs the shared checks for a browser-originated JSON POST and returns the
 * parsed body. Order: Origin → content type → size → rate limit → JSON parse
 * → Turnstile (oversized bodies are refused before they cost a rate-limit hit).
 */
export async function guardPost(req: Request, opts: GuardOptions): Promise<GuardResult> {
  if (!isAllowedOrigin(req.headers.get("origin"))) {
    return { ok: false, response: json(403, "Requests must come from the Corin Commercial website.") };
  }
  if (!isJsonContentType(req.headers.get("content-type"))) {
    return { ok: false, response: json(415, "Content-Type must be application/json.") };
  }
  const maxBytes = opts.maxBytes ?? 64_000;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: json(413, "Request is too large.") };

  const raw = await readBodyCapped(req, maxBytes);
  if (raw === null) return { ok: false, response: json(413, "Request is too large.") };

  const ip = clientIp(req);
  const rl = await rateLimiter().limit(`${opts.name}:${ip}`, opts.rate);
  if (!rl.success) {
    const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
    return { ok: false, response: json(429, opts.rateLimitMessage ?? "Too many requests. Please try again later.", { "retry-after": String(retryAfter) }) };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, response: json(400, "Invalid JSON.") };
  }

  if (opts.turnstile) {
    const failure = await checkTurnstile(req, opts.turnstile, ip);
    if (failure) return { ok: false, response: failure };
  }
  return { ok: true, body, ip };
}

/**
 * Reads the body as UTF-8, stopping (and returning null) as soon as it exceeds
 * maxBytes, so a chunked upload without Content-Length cannot exhaust memory.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return "";
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Verifies the request's Turnstile token. Returns an error response, or null when it passes (or Turnstile is off). */
export async function checkTurnstile(req: Request, action: TurnstileAction, ip = clientIp(req)): Promise<NextResponse | null> {
  const verifier = turnstileVerifier();
  if (!verifier) return null;
  const token = req.headers.get(TURNSTILE_HEADER)?.trim() ?? "";
  if (!token) return json(403, "Please complete the verification check and try again.");
  // Hostname pinning only in production: Cloudflare's dummy test keys report a
  // placeholder hostname, and dev runs on localhost.
  const hostnames = process.env.NODE_ENV === "production" ? allowedHostnames() : [];
  const verdict = await verifier.verify({ token, remoteIp: ip, action, allowedHostnames: hostnames });
  if (!verdict.success) return json(403, "Verification failed. Please refresh the page and try again.");
  return null;
}

// --- Capability tokens ----------------------------------------------------------------

function secret(): string {
  const s = process.env.LEAD_TOKEN_SECRET;
  if (!s) throw new Error("LEAD_TOKEN_SECRET is not set");
  return s;
}

/** Capability token returned to the borrower so only they can attach documents to their lead. */
export function signLeadToken(leadId: string): string {
  return createHmac("sha256", secret()).update(`lead:${leadId}`).digest("base64url");
}

export function verifyLeadToken(leadId: string, token: string): boolean {
  const expected = Buffer.from(signLeadToken(leadId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
