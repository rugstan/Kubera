import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("lender runtime", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is not configured without Supabase (pages render the not-configured state)", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { lenderRuntime } = await import("./runtime");
    expect(lenderRuntime()).toBeNull();
    // The first import loads the deal desk, documents and spreads wiring; slow on a busy machine.
  }, 20_000);

  it("reads optional index levels and ignores implausible ones", async () => {
    const { indexRatesFromEnv } = await import("./runtime");
    expect(indexRatesFromEnv({ LENDER_INDEX_SOFR_PCT: "4.31", LENDER_INDEX_PRIME_PCT: "abc", LENDER_INDEX_TREASURY_PCT: "99" })).toEqual({ SOFR: 4.31 });
    expect(indexRatesFromEnv({})).toEqual({});
  });
});
