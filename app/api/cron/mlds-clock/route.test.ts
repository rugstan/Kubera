import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { GET } = await import("./route");

const SECRET = "cron-secret-for-tests-0123456789";
const call = (auth?: string) => GET(new Request("https://corincommercial.com/api/cron/mlds-clock", { headers: auth ? { authorization: auth } : {} }));

describe("MLDS delivery clock cron", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("AUTH_PROVIDER", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
  });

  it("skips (and sends nothing) when the deal desk is not configured", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "deal-desk-not-configured" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
