// The Twenty webhook route: bounded body, signature check, one crm_events row per delivery.
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Emulates the unique index on crm_events.dedupe_key: a duplicate key answers 23505.
type Row = Record<string, unknown> & { dedupe_key: string };
const rows: Row[] = [];
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: async (row: Row) => {
        if (rows.some((r) => r.dedupe_key === row.dedupe_key)) return { error: { code: "23505", message: "duplicate key" } };
        rows.push(row);
        return { error: null };
      },
    }),
  }),
}));

const { POST } = await import("./route");

const SECRET = "twenty-secret";
const URL = "https://kuberacommercial.com/api/webhooks/twenty";
const event = () => JSON.stringify({ eventName: "person.updated", record: { id: "7f1c6d52-3a64-4d0e-9b6d-0d6a5a0c2b11" } });
const sign = (ts: string, body: string, secret = SECRET) => createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
function post(body: string, opts: { timestamp?: string; secret?: string; signature?: string } = {}) {
  const timestamp = opts.timestamp ?? String(Date.now());
  const signature = opts.signature ?? sign(timestamp, body, opts.secret);
  return POST(
    new Request(URL, {
      method: "POST",
      body,
      headers: { "x-twenty-webhook-signature": signature, "x-twenty-webhook-timestamp": timestamp },
    }),
  );
}

beforeEach(() => {
  rows.length = 0;
  vi.stubEnv("TWENTY_WEBHOOK_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/twenty", () => {
  it("accepts a signed delivery and stores it once", async () => {
    expect((await post(event())).status).toBe(200);
    expect(rows).toHaveLength(1);
  });

  it("rejects a forged or malformed signature", async () => {
    expect((await post(event(), { secret: "wrong" })).status).toBe(401);
    expect((await post(event(), { signature: "bad" })).status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it("answers 413 for an oversized streamed or declared body before checking the signature", async () => {
    expect((await post("x".repeat(256 * 1024 + 1), { signature: "bad" })).status).toBe(413);
    const declared = await POST(new Request(URL, { method: "POST", body: "{}", headers: { "content-length": String(10 * 1024 * 1024) } }));
    expect(declared.status).toBe(413);
    expect(rows).toHaveLength(0);
  });

  it("stores a delivery once under sha256(timestamp:body), however many times it is redelivered or replayed", async () => {
    const body = event();
    const timestamp = String(Date.now());
    for (let i = 0; i < 3; i++) expect((await post(body, { timestamp })).status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_name: "person.updated", dedupe_key: createHash("sha256").update(`${timestamp}:${body}`).digest("hex") });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("stores a different event separately", async () => {
    await post(event(), { timestamp: String(Date.now()) });
    await post(JSON.stringify({ eventName: "person.created", record: {} }), { timestamp: String(Date.now()) });
    expect(rows).toHaveLength(2);
  });
});
