// Shared rate limiter for the public intake and AI endpoints.
//
// Production: Upstash Redis over its REST API (no SDK needed), so every
// serverless instance sees the same counters. When the Upstash env vars are
// missing (local dev, previews without Redis) we degrade to a per-instance
// in-memory limiter and log once. Both use a sliding-window approximation:
// the previous fixed window's count is weighted by how much of it still
// overlaps the trailing window.

export type RateLimitRule = {
  /** Maximum requests allowed per window. */
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window rolls over. */
  reset: number;
};

export interface RateLimiter {
  limit(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

type Clock = () => number;

function slidingCount(current: number, previous: number, now: number, windowMs: number): number {
  const elapsed = (now % windowMs) / windowMs;
  return previous * (1 - elapsed) + current;
}

function result(rule: RateLimitRule, count: number, windowStart: number, success: boolean): RateLimitResult {
  return {
    success,
    limit: rule.limit,
    remaining: Math.max(0, Math.floor(rule.limit - count)),
    reset: windowStart + rule.windowMs,
  };
}

/** Per-instance limiter. Used as the fallback and as the test fake (inject a clock). */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, number>();

  constructor(
    private readonly now: Clock = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  async limit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = this.now();
    const window = Math.floor(now / rule.windowMs);
    const currentKey = `${key}:${rule.windowMs}:${window}`;
    const previousKey = `${key}:${rule.windowMs}:${window - 1}`;
    const current = this.buckets.get(currentKey) ?? 0;
    const previous = this.buckets.get(previousKey) ?? 0;
    const windowStart = window * rule.windowMs;

    // Count the attempt only if it is allowed, so a blocked client recovers
    // as soon as the window slides instead of extending its own penalty.
    if (slidingCount(current + 1, previous, now, rule.windowMs) > rule.limit) {
      return result(rule, slidingCount(current, previous, now, rule.windowMs), windowStart, false);
    }
    if (this.buckets.size >= this.maxKeys) this.prune(window, rule.windowMs);
    this.buckets.set(currentKey, current + 1);
    return result(rule, slidingCount(current + 1, previous, now, rule.windowMs), windowStart, true);
  }

  private prune(window: number, windowMs: number) {
    for (const k of this.buckets.keys()) {
      const parts = k.split(":");
      const w = Number(parts.at(-1));
      const ms = Number(parts.at(-2));
      if (ms !== windowMs || w < window - 1) this.buckets.delete(k);
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

type UpstashReply = { result?: unknown; error?: string };

/** Upstash Redis REST limiter (https://upstash.com/docs/redis/features/restapi). */
export class UpstashRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: Clock = Date.now,
    private readonly prefix = "corin:rl",
  ) {}

  async limit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = this.now();
    const window = Math.floor(now / rule.windowMs);
    const base = `${this.prefix}:${key}:${rule.windowMs}`;
    const currentKey = `${base}:${window}`;
    const previousKey = `${base}:${window - 1}`;
    const windowStart = window * rule.windowMs;

    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", currentKey],
        ["PEXPIRE", currentKey, String(rule.windowMs * 2)],
        ["GET", previousKey],
      ]),
      signal: AbortSignal.timeout(1_500),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    const replies = (await res.json()) as UpstashReply[];
    const failed = replies.find((r) => r.error);
    if (failed) throw new Error(`Upstash: ${failed.error}`);
    const current = Number(replies[0]?.result ?? 0);
    const previous = Number(replies[2]?.result ?? 0) || 0;
    const count = slidingCount(current, previous, now, rule.windowMs);
    return result(rule, count, windowStart, count <= rule.limit);
  }
}

/**
 * Wraps a shared limiter so a Redis outage degrades to the local limiter
 * rather than failing every intake request (or letting everything through).
 */
export class FallbackRateLimiter implements RateLimiter {
  private warned = false;

  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter,
  ) {}

  async limit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    try {
      return await this.primary.limit(key, rule);
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.error("rate limiter: shared store unavailable, using in-memory fallback", err instanceof Error ? err.message : err);
      }
      return this.fallback.limit(key, rule);
    }
  }
}

let instance: RateLimiter | undefined;

export function rateLimiter(): RateLimiter {
  if (instance) return instance;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const memory = new MemoryRateLimiter();
  if (url && token) {
    instance = new FallbackRateLimiter(new UpstashRateLimiter(url, token), memory);
  } else {
    console.warn("rate limiter: UPSTASH_REDIS_REST_URL/TOKEN not set; using per-instance in-memory limits");
    instance = memory;
  }
  return instance;
}

/** Test hook: swap the process-wide limiter (pass undefined to reset). */
export function setRateLimiter(limiter: RateLimiter | undefined) {
  instance = limiter;
}

/** Convenience wrapper: true when the request may proceed. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  return (await rateLimiter().limit(key, { limit, windowMs })).success;
}
