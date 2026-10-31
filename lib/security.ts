import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Per-instance sliding window. Good enough to blunt casual abuse of the AI and
// intake endpoints; put a shared limiter (Upstash, Vercel WAF) in front for
// production traffic.
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.clear();
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

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
