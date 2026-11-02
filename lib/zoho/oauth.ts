// Zoho Accounts OAuth access tokens shared across serverless instances.
//
// Zoho caps access-token generation per refresh token (roughly 10 per 10
// minutes) and answers a throttled refresh with an `error` body, sometimes
// with HTTP 200 or 400. Minting a token per cold instance (mail polling every
// 5 minutes, inbound processing at concurrency 5, Zoho Sign calls) hits that
// cap, so access tokens live in a shared store (Upstash Redis when
// UPSTASH_REDIS_REST_URL/TOKEN are set) keyed by a hash of the refresh token,
// with a short lock around the refresh and a shared cooldown after a throttle.
// Without Upstash each instance caches its own token (the previous behaviour).
//
// Used by lib/mail/zoho.ts (Zoho Mail) and lib/esign/zoho-sign.ts (Zoho Sign).

import { createHash, randomUUID } from "node:crypto";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Small key/value store with TTLs (Upstash Redis in production). Values are opaque strings. */
export interface ZohoTokenCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** SET NX: true when the key was absent and is now held by `value`. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Deletes `key` only while it still holds `value` (lock release, stale-token eviction). */
  deleteIf(key: string, value: string): Promise<void>;
}

export class MemoryZohoTokenCache implements ZohoTokenCache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(key: string) {
    const e = this.entries.get(key);
    if (e && e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key: string) {
    return this.live(key)?.value ?? null;
  }
  async set(key: string, value: string, ttlMs: number) {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }
  async setIfAbsent(key: string, value: string, ttlMs: number) {
    if (this.live(key)) return false;
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    return true;
  }
  async deleteIf(key: string, value: string) {
    if (this.live(key)?.value === value) this.entries.delete(key);
  }
}

type UpstashReply = { result?: unknown; error?: string };

/** Upstash Redis over its REST API (same store lib/ratelimit.ts uses). */
export class UpstashZohoTokenCache implements ZohoTokenCache {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async command(cmd: string[]): Promise<unknown> {
    const res = await this.fetchImpl(this.url.replace(/\/$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(2_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    const reply = (await res.json()) as UpstashReply;
    if (reply.error) throw new Error(`Upstash: ${reply.error}`);
    return reply.result ?? null;
  }

  async get(key: string) {
    const r = await this.command(["GET", key]);
    return typeof r === "string" ? r : null;
  }
  async set(key: string, value: string, ttlMs: number) {
    await this.command(["SET", key, value, "PX", String(Math.max(1, Math.floor(ttlMs)))]);
  }
  async setIfAbsent(key: string, value: string, ttlMs: number) {
    return (await this.command(["SET", key, value, "PX", String(Math.max(1, Math.floor(ttlMs))), "NX"])) === "OK";
  }
  async deleteIf(key: string, value: string) {
    await this.command(["EVAL", "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", "1", key, value]);
  }
}

let shared: ZohoTokenCache | null | undefined;

/**
 * The process-wide shared cache, or null without Upstash (callers then keep
 * a per-instance cache). Test hook: setZohoTokenCache.
 */
export function sharedZohoTokenCache(env: Record<string, string | undefined> = process.env): ZohoTokenCache | null {
  if (shared !== undefined) return shared;
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) shared = new UpstashZohoTokenCache(url, token);
  else {
    console.info("[zoho] UPSTASH_REDIS_REST_URL/TOKEN not set; Zoho access tokens are cached per instance");
    shared = null;
  }
  return shared;
}

export function setZohoTokenCache(cache: ZohoTokenCache | null | undefined): void {
  shared = cache;
}

// --- Errors ----------------------------------------------------------------------------------

export class ZohoOAuthError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    /** Set when Zoho throttled the refresh: wait at least this long. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ZohoOAuthError";
  }
}

const THROTTLE_TEXT = /access denied|too many|throttl|rate.?limit|limit (?:exceeded|reached)|try again/i;

/** How Zoho Accounts' reply to a refresh should be treated. */
export function classifyOAuthFailure(status: number | null, body: { error?: unknown; error_description?: unknown } | null): { retryable: boolean; throttled: boolean } {
  const text = `${typeof body?.error === "string" ? body.error : ""} ${typeof body?.error_description === "string" ? body.error_description : ""}`;
  const throttled = status === 429 || THROTTLE_TEXT.test(text);
  if (throttled) return { retryable: true, throttled: true };
  if (status === null || status >= 500 || status === 408) return { retryable: true, throttled: false };
  // invalid_client, invalid_code, invalid_grant (revoked refresh token): a person must fix the config.
  return { retryable: false, throttled: false };
}

// --- Token manager ---------------------------------------------------------------------------

export type ZohoAccessTokensOptions = {
  accountsUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: FetchLike;
  now?: () => number;
  /** Shared store; null/undefined keeps tokens in this instance only. */
  cache?: ZohoTokenCache | null;
  /** Wait between lock polls (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Cooldown after a throttled refresh. */
  throttleCooldownMs?: number;
  label?: string;
};

const SAFETY_MS = 60_000;
const LOCK_MS = 15_000;
const LOCK_POLLS = 6;
const LOCK_POLL_MS = 250;
const DEFAULT_COOLDOWN_MS = 60_000;

type Stored = { token: string; expiresAt: number };

export function refreshTokenKey(refreshToken: string, clientId: string): string {
  return createHash("sha256").update(`${clientId}:${refreshToken}`).digest("hex").slice(0, 32);
}

export class ZohoAccessTokens {
  private local: Stored | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly cache: ZohoTokenCache;
  private readonly isShared: boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly key: string;
  private warned = false;

  constructor(private readonly opts: ZohoAccessTokensOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? (() => Date.now());
    this.isShared = Boolean(opts.cache);
    this.cache = opts.cache ?? new MemoryZohoTokenCache(this.now);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.key = `corin:zoho:at:${refreshTokenKey(opts.refreshToken, opts.clientId)}`;
  }

  private get lockKey() {
    return `${this.key}:lock`;
  }
  private get coolKey() {
    return `${this.key}:cooldown`;
  }

  private valid(s: Stored | null, stale?: string): s is Stored {
    return Boolean(s && s.expiresAt - SAFETY_MS > this.now() && s.token !== stale);
  }

  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn(`[zoho] shared token cache unavailable (${err instanceof Error ? err.message : String(err)}); refreshing locally`);
      }
      return fallback;
    }
  }

  private async readShared(stale?: string): Promise<Stored | null> {
    const raw = await this.safe(() => this.cache.get(this.key), null);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Stored;
      return this.valid(s, stale) ? s : null;
    } catch {
      return null;
    }
  }

  /**
   * A valid access token. `stale` is a token the API just rejected with 401:
   * it is evicted and never returned again.
   */
  async get(opts: { stale?: string } = {}): Promise<string> {
    const { stale } = opts;
    if (stale) {
      if (this.local?.token === stale) this.local = null;
      await this.safe(async () => {
        const raw = await this.cache.get(this.key);
        if (raw && (JSON.parse(raw) as Stored).token === stale) await this.cache.deleteIf(this.key, raw);
      }, undefined);
    }
    if (this.valid(this.local, stale)) return this.local.token;
    // Collapse concurrent refreshes within this instance.
    this.refreshing ??= this.obtain(stale).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async obtain(stale?: string): Promise<string> {
    const cached = await this.readShared(stale);
    if (cached) {
      this.local = cached;
      return cached.token;
    }
    const cooldown = Number(await this.safe(() => this.cache.get(this.coolKey), null));
    if (cooldown > this.now()) {
      throw new ZohoOAuthError(`Zoho OAuth refresh is throttled${this.opts.label ? ` (${this.opts.label})` : ""}; retry later`, 429, true, cooldown - this.now());
    }

    const nonce = randomUUID();
    const locked = await this.safe(() => this.cache.setIfAbsent(this.lockKey, nonce, LOCK_MS), true);
    if (!locked) {
      // Another instance is refreshing: wait for its token rather than minting a second one.
      for (let i = 0; i < LOCK_POLLS; i++) {
        await this.sleep(LOCK_POLL_MS * (i + 1));
        const s = await this.readShared(stale);
        if (s) {
          this.local = s;
          return s.token;
        }
      }
      throw new ZohoOAuthError("Zoho OAuth refresh is in progress on another instance; retry shortly", null, true, LOCK_MS);
    }
    try {
      const fresh = await this.refresh();
      this.local = fresh;
      const ttl = fresh.expiresAt - this.now();
      if (ttl > SAFETY_MS) await this.safe(() => this.cache.set(this.key, JSON.stringify(fresh), ttl), undefined);
      return fresh.token;
    } catch (err) {
      if (err instanceof ZohoOAuthError && err.retryAfterMs) {
        const until = this.now() + err.retryAfterMs;
        await this.safe(() => this.cache.set(this.coolKey, String(until), err.retryAfterMs!), undefined);
      }
      throw err;
    } finally {
      await this.safe(() => this.cache.deleteIf(this.lockKey, nonce), undefined);
    }
  }

  private async refresh(): Promise<Stored> {
    const body = new URLSearchParams({ refresh_token: this.opts.refreshToken, client_id: this.opts.clientId, client_secret: this.opts.clientSecret, grant_type: "refresh_token" });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.accountsUrl}/oauth/v2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch (err) {
      throw new ZohoOAuthError(`Zoho OAuth refresh failed: ${err instanceof Error ? err.message : String(err)}`, null, true);
    }
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    // Zoho Accounts reports some failures (throttling included) with HTTP 200 and an `error` field.
    if (!res.ok || !json.access_token || json.error) {
      const { retryable, throttled } = classifyOAuthFailure(res.ok && !json.error ? 500 : res.status, json);
      const retryAfter = Number(res.headers.get("retry-after"));
      const cooldown = throttled ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (this.opts.throttleCooldownMs ?? DEFAULT_COOLDOWN_MS)) : null;
      throw new ZohoOAuthError(`Zoho OAuth refresh failed (${res.status}${json.error ? `: ${json.error}` : ""})`, throttled && res.status < 400 ? 429 : res.status, retryable, cooldown);
    }
    return { token: json.access_token, expiresAt: this.now() + (json.expires_in ?? 3600) * 1000 };
  }

  /** True when tokens are shared across instances (Upstash configured). */
  get shared(): boolean {
    return this.isShared;
  }
}
