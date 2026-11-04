import { describe, expect, it, vi } from "vitest";
import { FallbackRateLimiter, MemoryRateLimiter, UpstashRateLimiter, type RateLimiter } from "./ratelimit";

const rule = { limit: 3, windowMs: 60_000 };

describe("MemoryRateLimiter", () => {
  it("allows up to the limit and blocks the next request", async () => {
    let now = 10 * 60_000; // start of a window
    const rl = new MemoryRateLimiter(() => now);
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rl.limit("ip:1", rule)).success);
    expect(results).toEqual([true, true, true, false]);
    // Separate keys do not share a budget.
    expect((await rl.limit("ip:2", rule)).success).toBe(true);
    now += 1;
    expect((await rl.limit("ip:1", rule)).success).toBe(false);
  });

  it("slides: the previous window's hits decay as the window moves on", async () => {
    let now = 10 * 60_000;
    const rl = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) await rl.limit("k", rule);
    // Just into the next window, the prior 3 hits still weigh ~3.
    now = 11 * 60_000 + 1_000;
    expect((await rl.limit("k", rule)).success).toBe(false);
    // Two thirds into the next window the prior hits weigh 1, leaving room for 2.
    now = 11 * 60_000 + 40_000;
    expect((await rl.limit("k", rule)).success).toBe(true);
    expect((await rl.limit("k", rule)).success).toBe(true);
    expect((await rl.limit("k", rule)).success).toBe(false);
    // Two windows later everything has expired.
    now = 13 * 60_000;
    expect((await rl.limit("k", rule)).success).toBe(true);
  });

  it("reports remaining and reset", async () => {
    const rl = new MemoryRateLimiter(() => 5 * 60_000);
    const r = await rl.limit("k", rule);
    expect(r.remaining).toBe(2);
    expect(r.reset).toBe(6 * 60_000);
  });
});

describe("UpstashRateLimiter", () => {
  it("sends one pipeline and computes the sliding count", async () => {
    const fetchImpl = vi.fn(async () => Response.json([{ result: 2 }, { result: 1 }, { result: "4" }]));
    const now = 10 * 60_000 + 30_000; // halfway through the window
    const rl = new UpstashRateLimiter("https://redis.example.com/", "tok", fetchImpl as unknown as typeof fetch, () => now);
    const r = await rl.limit("qualify:1.2.3.4", { limit: 5, windowMs: 60_000 });
    // 4 * 0.5 + 2 = 4 <= 5
    expect(r.success).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://redis.example.com/pipeline");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const commands = JSON.parse(String(init.body)) as string[][];
    expect(commands[0]).toEqual(["INCR", "corin:rl:qualify:1.2.3.4:60000:10"]);
    expect(commands[1]?.[0]).toBe("PEXPIRE");
    expect(commands[2]).toEqual(["GET", "corin:rl:qualify:1.2.3.4:60000:9"]);
  });

  it("blocks above the limit", async () => {
    const fetchImpl = vi.fn(async () => Response.json([{ result: 6 }, { result: 1 }, { result: null }]));
    const rl = new UpstashRateLimiter("https://r", "t", fetchImpl as unknown as typeof fetch, () => 0);
    expect((await rl.limit("k", { limit: 5, windowMs: 1000 })).success).toBe(false);
  });

  it("throws on HTTP or command errors so the fallback can take over", async () => {
    const bad = new UpstashRateLimiter("https://r", "t", (async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    await expect(bad.limit("k", rule)).rejects.toThrow(/500/);
    const cmdErr = new UpstashRateLimiter("https://r", "t", (async () => Response.json([{ error: "WRONGPASS" }])) as unknown as typeof fetch);
    await expect(cmdErr.limit("k", rule)).rejects.toThrow(/WRONGPASS/);
  });
});

describe("FallbackRateLimiter", () => {
  it("degrades to the local limiter when the shared store fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: RateLimiter = { limit: async () => Promise.reject(new Error("down")) };
    const rl = new FallbackRateLimiter(broken, new MemoryRateLimiter(() => 0));
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rl.limit("k", rule)).success);
    expect(results).toEqual([true, true, true, false]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
