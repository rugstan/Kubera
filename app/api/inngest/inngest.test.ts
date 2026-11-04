import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null, DOCUMENT_BUCKET: "deal-documents" }));

const ENV_KEYS = ["INNGEST_DEV", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("/api/inngest", () => {
  it("answers 503 when Inngest is not configured", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const { GET, POST, PUT } = await import("./route");
    for (const handler of [GET, POST, PUT]) {
      const res = await handler(new Request("https://corincommercial.com/api/inngest", { method: "POST", body: "{}" }), {});
      expect(res.status).toBe(503);
    }
  });

  it("serves the workflow and agent functions when configured", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { workflowFunctions } = await import("@/lib/workflows/server");
    const fns = workflowFunctions();
    expect(fns.map((f) => f.id())).toEqual([
      "outbound-action",
      "mail-poll",
      "inbound-mail",
      "document-extract",
      "spreads-recalculate",
      "crm-mail-routed",
      "lender-term-sheets",
      "speed-to-lead",
      "outreach-sweep",
      "intel-weekly",
      "prospect-scan",
      "prospect-outreach-settle",
      "cron-rates",
      "cron-crm-retry",
      "cron-approvals-expire",
      "cron-notify-sweep",
      "cron-documents-scan",
      "cron-outreach-sweep",
      "cron-mlds-clock",
    ]);
  });

  it("drops events (without throwing) when no event key is set", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendWorkflowEvent, workflowsConfigured } = await import("@/lib/workflows/client");
    expect(workflowsConfigured()).toBe(false);
    await expect(sendWorkflowEvent({ name: "corin/mail.poll.requested", data: {} })).resolves.toEqual({ sent: 0 });
    process.env.INNGEST_EVENT_KEY = "evt";
    process.env.INNGEST_SIGNING_KEY = "signkey-prod-0000";
    expect(workflowsConfigured()).toBe(true);
  });
});
