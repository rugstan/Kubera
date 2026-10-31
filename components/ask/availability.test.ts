import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAskAvailability, markAskUnavailable, probeAskAvailability, resetAskAvailability, subscribeAskAvailability } from "./availability";

const f = (status: number, body?: unknown) => (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => resetAskAvailability());

describe("probeAskAvailability", () => {
  it("is unavailable when /api/ask answers 503", async () => {
    expect(await probeAskAvailability(f(503, { error: "not configured" }))).toBe("unavailable");
    expect(getAskAvailability()).toBe("unavailable");
  });

  it("is unavailable when the status route says so", async () => {
    expect(await probeAskAvailability(f(200, { available: false }))).toBe("unavailable");
  });

  it("is available on 200 and on the 405 a POST-only route returns", async () => {
    expect(await probeAskAvailability(f(200, { available: true }))).toBe("available");
    resetAskAvailability();
    expect(await probeAskAvailability(f(405))).toBe("available");
  });

  it("leaves state unknown on a network error", async () => {
    const boom = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await probeAskAvailability(boom)).toBe("unknown");
  });

  it("probes with a side-effect free GET", async () => {
    const spy = vi.fn(f(405));
    await probeAskAvailability(spy);
    expect((spy.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("GET");
  });
});

describe("store", () => {
  it("notifies subscribers once when the state changes", () => {
    const listener = vi.fn();
    const off = subscribeAskAvailability(listener);
    markAskUnavailable();
    markAskUnavailable();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});
