import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const seen = new Set<string>();
const inserts: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: async (row: { dedupe_key: string }) => {
        if (seen.has(row.dedupe_key)) return { error: { code: "23505", message: "duplicate key" } };
        seen.add(row.dedupe_key);
        inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

const { POST } = await import("./route");

const SECRET = "twenty-secret";
const sign = (ts: string, body: string) => createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");
const post = (body: string, ts = String(Date.now()), signature = sign(ts, body)) =>
  POST(new Request("https://kuberacommercial.com/api/webhooks/twenty", {
    method: "POST",
    body,
    headers: { "x-twenty-webhook-signature": signature, "x-twenty-webhook-timestamp": ts },
  }));

beforeEach(() => {
  vi.stubEnv("TWENTY_WEBHOOK_SECRET", SECRET);
  seen.clear();
  inserts.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/twenty", () => {
  const body = JSON.stringify({ eventName: "person.updated", record: { id: "00000000-0000-0000-0000-000000000001" } });

  it("accepts a signed delivery and stores it once", async () => {
    expect((await post(body)).status).toBe(200);
    expect(inserts).toHaveLength(1);
  });

  it("treats a replayed delivery as a no-op", async () => {
    const ts = String(Date.now());
    expect((await post(body, ts)).status).toBe(200);
    expect((await post(body, ts)).status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("rejects an oversized body with 413 before checking the signature", async () => {
    const res = await post("x".repeat(256 * 1024 + 1), undefined, "bad");
    expect(res.status).toBe(413);
  });

  it("rejects a bad signature", async () => {
    expect((await post(body, undefined, "bad")).status).toBe(401);
    expect(inserts).toHaveLength(0);
  });
});
