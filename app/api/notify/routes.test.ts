// Route-level wiring for the notification endpoints with no providers and no
// database configured: they must answer cleanly (never crash a build or a
// request) and refuse unauthenticated callers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));

const tier1 = await import("./tier1/route");
const leadConfirmation = await import("./lead-confirmation/route");
const stageEvent = await import("./stage-event/route");
const sweep = await import("./sweep/route");
const telnyx = await import("../webhooks/telnyx/route");

const saved = { ...process.env };
beforeEach(() => {
  for (const k of ["NOTIFY_INTERNAL_SECRET", "CRON_SECRET", "TELNYX_PUBLIC_KEY", "TELNYX_API_KEY", "RESEND_API_KEY"]) delete process.env[k];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const post = (auth?: string) =>
  new Request("https://kuberacommercial.com/api/notify/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ leadId: "3f9a12bc-0000-4000-8000-000000000001" }),
  });

describe("notify routes without configuration", () => {
  it("internal triggers answer 503 until NOTIFY_INTERNAL_SECRET is set", async () => {
    for (const route of [tier1, leadConfirmation, stageEvent]) expect((await route.POST(post("Bearer anything"))).status).toBe(503);
  });

  it("internal triggers answer 401 for the wrong secret and 404 for an unknown lead with the right one", async () => {
    process.env.NOTIFY_INTERNAL_SECRET = "s".repeat(40);
    expect((await tier1.POST(post("Bearer wrong"))).status).toBe(401);
    expect((await tier1.POST(post(`Bearer ${"s".repeat(40)}`))).status).toBe(404);
  });

  it("the sweep answers 503 without CRON_SECRET and checks nothing with it", async () => {
    expect((await sweep.GET(new Request("https://kuberacommercial.com/api/notify/sweep"))).status).toBe(503);
    process.env.CRON_SECRET = "c".repeat(40);
    const res = await sweep.GET(new Request("https://kuberacommercial.com/api/notify/sweep", { headers: { authorization: `Bearer ${"c".repeat(40)}` } }));
    expect(await res.json()).toMatchObject({ ok: true, checked: 0 });
  });

  it("the Telnyx webhook answers 503 without TELNYX_PUBLIC_KEY and 401 with an unsigned request", async () => {
    const req = () => new Request("https://kuberacommercial.com/api/webhooks/telnyx", { method: "POST", body: "{}" });
    expect((await telnyx.POST(req())).status).toBe(503);
    process.env.TELNYX_PUBLIC_KEY = Buffer.alloc(32, 7).toString("base64");
    expect((await telnyx.POST(req())).status).toBe(401);
  });
});
