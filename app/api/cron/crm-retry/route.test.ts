import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the Next server bundle; neutralise it for unit tests.
vi.mock("server-only", () => ({}));

const admin = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => admin.value }));
vi.mock("@/lib/rates", async () => {
  const { FALLBACK_BENCHMARKS } = await import("@/lib/sizing/assumptions");
  return { getMarketSnapshot: async () => ({ benchmarks: FALLBACK_BENCHMARKS, items: [], asOf: "2026-11-01", live: false }) };
});

import { GET } from "./route";

const call = (authorization?: string) => GET(new Request("https://kuberacommercial.com/api/cron/crm-retry", { headers: authorization ? { authorization } : {} }));

/** Chainable stand-in for the supabase-js query builder; every query resolves to `result`. */
function fakeDb(result: { data: unknown[]; error: null }) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "or", "not", "is", "lt", "order", "limit", "update", "eq"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return { from: () => builder };
}

describe("GET /api/cron/crm-retry", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("TWENTY_API_URL", "https://twenty.example.com");
    vi.stubEnv("TWENTY_API_KEY", "key");
    admin.value = fakeDb({ data: [], error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects requests without the cron bearer secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
  });

  it("rejects everything when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("skips quietly when Twenty is not configured", async () => {
    vi.stubEnv("TWENTY_API_URL", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "twenty-not-configured" });
  });

  it("skips quietly when Supabase is not configured", async () => {
    admin.value = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call("Bearer s3cret");
    expect(await res.json()).toEqual({ ok: true, skipped: "supabase-not-configured" });
  });

  it("runs the retry and returns a summary when authorised", async () => {
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, stoppedEarly: false });
    expect(body.leads.candidates).toBe(0);
  });
});
