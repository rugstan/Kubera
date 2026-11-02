import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { allowedOrigins, guardPost, hashIp, isAllowedOrigin, isJsonContentType } = await import("./security");
const { MemoryRateLimiter, setRateLimiter } = await import("./ratelimit");
const { FakeTurnstileVerifier } = await import("./turnstile/fake");
const { setTurnstileVerifier } = await import("./turnstile");

const prodEnv = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("origin allowlist", () => {
  it("allows both production domains", () => {
    for (const o of ["https://corincommercial.com", "https://www.corincommercial.com", "https://kubera.loans", "https://www.kubera.loans"]) {
      expect(isAllowedOrigin(o, prodEnv)).toBe(true);
    }
  });

  it("rejects forged, lookalike, downgraded and missing origins", () => {
    for (const o of [
      "https://evil.example",
      "https://corincommercial.com.evil.example",
      "https://evilcorincommercial.com",
      "http://corincommercial.com",
      "null",
      "",
    ]) {
      expect(isAllowedOrigin(o, prodEnv), o).toBe(false);
    }
    expect(isAllowedOrigin(null, prodEnv)).toBe(false);
  });

  it("allows localhost only outside production", () => {
    expect(isAllowedOrigin("http://localhost:3000", { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:4101", { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", prodEnv)).toBe(false);
  });

  it("adds Vercel deployment URLs and explicit ALLOWED_ORIGINS", () => {
    const env = { NODE_ENV: "production", VERCEL_URL: "corin-abc123.vercel.app", ALLOWED_ORIGINS: "http://localhost:3999, https://staging.corincommercial.com" } as NodeJS.ProcessEnv;
    expect(allowedOrigins(env).has("https://corin-abc123.vercel.app")).toBe(true);
    expect(isAllowedOrigin("http://localhost:3999", env)).toBe(true);
    expect(isAllowedOrigin("https://staging.corincommercial.com", env)).toBe(true);
    expect(isAllowedOrigin("http://localhost:4000", env)).toBe(false);
  });
});

describe("content type", () => {
  it("accepts application/json with parameters only", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType("application/x-www-form-urlencoded")).toBe(false);
    expect(isJsonContentType("multipart/form-data; boundary=x")).toBe(false);
    expect(isJsonContentType("application/jsonp")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });
});

describe("hashIp", () => {
  it("is stable and does not reveal the address", () => {
    expect(hashIp("203.0.113.9")).toBe(hashIp("203.0.113.9"));
    expect(hashIp("203.0.113.9")).not.toContain("203");
    expect(hashIp("203.0.113.9")).not.toBe(hashIp("203.0.113.10"));
  });
});

describe("guardPost", () => {
  let turnstile: InstanceType<typeof FakeTurnstileVerifier>;

  beforeEach(() => {
    setRateLimiter(new MemoryRateLimiter());
    turnstile = new FakeTurnstileVerifier();
    setTurnstileVerifier(turnstile);
  });
  afterEach(() => {
    setRateLimiter(undefined);
    setTurnstileVerifier(undefined);
  });

  const post = (headers: Record<string, string>, body = JSON.stringify({ a: 1 })) =>
    new Request("https://corincommercial.com/api/x", { method: "POST", headers: { "x-forwarded-for": "198.51.100.7", ...headers }, body });
  const ok = { origin: "https://corincommercial.com", "content-type": "application/json" };
  const opts = { name: "t", rate: { limit: 2, windowMs: 60_000 }, turnstile: "qualify" as const };

  it("passes a well-formed, verified request and returns the parsed body", async () => {
    turnstile.issue("tok", "qualify");
    const r = await guardPost(post({ ...ok, "x-turnstile-token": "tok" }), opts);
    expect(r.ok && r.body).toEqual({ a: 1 });
    expect(r.ok && r.ip).toBe("198.51.100.7");
  });

  it("rejects in order: origin 403, content type 415, size 413, bad JSON 400, captcha 403, rate 429", async () => {
    const status = async (req: Request, o: Parameters<typeof guardPost>[1] = opts) => {
      const r = await guardPost(req, o);
      return r.ok ? 200 : r.response.status;
    };
    expect(await status(post({ ...ok, origin: "https://evil.example" }))).toBe(403);
    expect(await status(post({ "content-type": "application/json" }))).toBe(403);
    expect(await status(post({ ...ok, "content-type": "text/plain" }))).toBe(415);
    expect(await status(post(ok, JSON.stringify({ big: "x".repeat(70_000) })))).toBe(413);
    expect(await status(post(ok, "{not json"), { ...opts, turnstile: false })).toBe(400);
    // The 400 above consumed one of two allowed requests; this one is allowed through to Turnstile.
    expect(await status(post(ok))).toBe(403);
    expect(await status(post(ok))).toBe(429);
  });

  it("returns retry-after on 429", async () => {
    const o = { name: "r", rate: { limit: 1, windowMs: 60_000 } };
    await guardPost(post(ok), o);
    const r = await guardPost(post(ok), o);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Number(r.response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("caps chunked bodies that omit Content-Length", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(16_000).fill(32));
      },
    });
    const req = new Request("https://corincommercial.com/api/x", { method: "POST", headers: ok, body: endless, duplex: "half" } as RequestInit);
    const r = await guardPost(req, { ...opts, turnstile: false, maxBytes: 64_000 });
    expect(r.ok ? 200 : r.response.status).toBe(413);
    expect(pulls).toBeLessThan(10);
  });

  it("skips Turnstile when it is not configured", async () => {
    setTurnstileVerifier(null);
    const r = await guardPost(post(ok), opts);
    expect(r.ok).toBe(true);
  });
});
