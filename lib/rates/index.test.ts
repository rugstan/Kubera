import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_BENCHMARKS, FALLBACK_BENCHMARKS_AS_OF } from "@/lib/sizing/assumptions";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));

const { getMarketSnapshot } = await import("./index");

const csv = (rows: [string, number][]) => ["observation_date,X", ...rows.map(([d, v]) => `${d},${v}`)].join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMarketSnapshot", () => {
  it("dates a live snapshot by its latest observation", async () => {
    vi.stubGlobal("fetch", async () => new Response(csv([["2026-10-29", 4.1], ["2026-10-30", 4.12]])));
    const snap = await getMarketSnapshot();
    expect(snap.live).toBe(true);
    expect(snap.asOf).toBe("2026-10-30");
    expect(snap.benchmarks.tenYear).toBe(4.12);
  });

  it("never dates fallback figures with today's date when the feed is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const snap = await getMarketSnapshot();
    expect(snap.live).toBe(false);
    expect(snap.benchmarks).toEqual(FALLBACK_BENCHMARKS);
    expect(snap.asOf).toBe(FALLBACK_BENCHMARKS_AS_OF);
  });

  it("uses the fallback date when only some series fell back", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (n++ === 0 ? new Response(csv([["2099-01-02", 4]])) : new Response("", { status: 503 })));
    const snap = await getMarketSnapshot();
    expect(snap.live).toBe(false);
    expect(snap.asOf).toBe(FALLBACK_BENCHMARKS_AS_OF);
  });
});
