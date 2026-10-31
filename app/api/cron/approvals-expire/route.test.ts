import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApprovalService } from "@/lib/approvals/server";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";

vi.mock("server-only", () => ({}));

const { GET } = await import("./route");

const T0 = new Date("2026-11-03T17:00:00Z");
const call = (auth?: string) => GET(new Request("https://kuberacommercial.com/api/cron/approvals-expire", { headers: auth ? { authorization: auth } : {} }));

describe("approvals-expire cron", () => {
  beforeEach(() => vi.stubEnv("CRON_SECRET", "cron-secret-for-tests-0123456789"));
  afterEach(() => {
    vi.unstubAllEnvs();
    setApprovalService(undefined);
  });

  it("requires the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
  });

  it("expires pending approvals past their deadline", async () => {
    let now = T0;
    const service = new ApprovalService(new MemoryApprovalStore(), () => now);
    await service.request({ kind: "email", idempotencyKey: "email:cron-expire:1", summary: "Send", payload: { to: "a@b.co" }, requestedBy: "agent:test", ttlMinutes: 30 });
    setApprovalService(service);
    now = new Date(T0.getTime() + 3_600_000);
    const res = await call("Bearer cron-secret-for-tests-0123456789");
    expect(await res.json()).toEqual({ ok: true, expired: 1 });
  });

  it("skips when the queue is not configured", async () => {
    setApprovalService(null);
    expect(await (await call("Bearer cron-secret-for-tests-0123456789")).json()).toEqual({ ok: true, skipped: "approvals-not-configured" });
  });
});
