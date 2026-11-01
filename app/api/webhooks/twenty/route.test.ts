// The Twenty webhook route: bounded body, signature check, one crm_events row per delivery.
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const rows: Row[] = [];
const upsert = vi.fn(async (row: Row, opts: { onConflict: string; ignoreDuplicates: boolean }) => {
  expect(opts).toEqual({ onConflict: "dedupe_key", ignoreDuplicates: true });
  if (!rows.some((r) => r.dedupe_key === row.dedupe_key)) rows.push(row);
  return { error: null };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => ({ from: () => ({ upsert }) }) }));

const { POST } = await import("./route");

const SECRET = "twenty-secret";
const event = () => JSON.stringify({ eventName: "person.updated", record: { id: "7f1c6d52-3a64-4d0e-9b6d-0d6a5a0c2b11" } });
function post(body: string, opts: { timestamp?: string; secret?: string } = {}) {
  const timestamp = opts.timestamp ?? String(Date.now());
  const signature = createHmac("sha256", opts.secret ?? SECRET).update(`${timestamp}:${body}`).digest("hex");
  return POST(
    new Request("https://kuberacommercial.com/api/webhooks/twenty", {
      method: "POST",
      body,
      headers: { "x-twenty-webhook-signature": signature, "x-twenty-webhook-timestamp": timestamp },
    }),
  );
}

beforeEach(() => {
  rows.length = 0;
  upsert.mockClear();
  vi.stubEnv("TWENTY_WEBHOOK_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/twenty", () => {
  it("rejects a forged signature", async () => {
    expect((await post(event(), { secret: "wrong" })).status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it("answers 413 for an oversized streamed or declared body before checking the signature", async () => {
    expect((await post("x".repeat(256 * 1024 + 1))).status).toBe(413);
    const declared = await POST(new Request("https://kuberacommercial.com/api/webhooks/twenty", { method: "POST", body: "{}", headers: { "content-length": String(10 * 1024 * 1024) } }));
    expect(declared.status).toBe(413);
    expect(rows).toHaveLength(0);
  });

  it("stores a delivery once under sha256(timestamp:body), however many times Twenty redelivers it", async () => {
    const body = event();
    const timestamp = String(Date.now());
    for (let i = 0; i < 3; i++) expect((await post(body, { timestamp })).status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_name: "person.updated", dedupe_key: createHash("sha256").update(`${timestamp}:${body}`).digest("hex") });
  });

  it("stores a different event separately", async () => {
    await post(event(), { timestamp: String(Date.now()) });
    await post(JSON.stringify({ eventName: "person.created", record: {} }), { timestamp: String(Date.now()) });
    expect(rows).toHaveLength(2);
  });
});
