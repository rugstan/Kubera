import { readFileSync } from "node:fs";
import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { CRON_RELAY_JOBS, createCronRelayFunctions, runCronJob } from "./cron-relay";

type Fn = { id: (prefix?: string) => string; opts: { triggers?: { cron?: string }[]; retries?: number } };

/** Whether `expr` can fire more than once a day (any field but day/month/weekday is not a single number). */
const moreThanDaily = (expr: string) => expr.split(" ").slice(0, 2).some((f) => !/^\d+$/.test(f));

describe("cron relay", () => {
  it("calls the route handler with the cron bearer and reports its status", async () => {
    const GET = vi.fn(async (req: Request) => {
      expect(req.headers.get("authorization")).toBe("Bearer s3cret");
      expect(new URL(req.url).pathname).toBe("/api/cron/rates");
      return Response.json({ ok: true });
    });
    await expect(runCronJob({ path: "/api/cron/rates", load: async () => ({ GET }) }, { CRON_SECRET: "s3cret" })).resolves.toEqual({
      path: "/api/cron/rates",
      status: 200,
    });
    expect(GET).toHaveBeenCalledTimes(1);
  });

  it("fails the run when the handler answers an error", async () => {
    const load = async () => ({ GET: async () => Response.json({ error: "down" }, { status: 500 }) });
    await expect(runCronJob({ path: "/api/notify/sweep", load }, { CRON_SECRET: "s" })).rejects.toThrow("/api/notify/sweep answered 500");
  });

  it("does not retry or load the handler without CRON_SECRET", async () => {
    const load = vi.fn();
    await expect(runCronJob({ path: "/api/cron/rates", load }, {})).rejects.toBeInstanceOf(NonRetriableError);
    expect(load).not.toHaveBeenCalled();
  });

  it("runs every frequent job, and only those, on its own schedule", () => {
    const fns = createCronRelayFunctions() as unknown as Fn[];
    expect(fns.map((f) => f.id())).toEqual(CRON_RELAY_JOBS.map((j) => j.id));
    for (const [i, f] of fns.entries()) {
      expect(f.opts.triggers).toEqual([{ cron: CRON_RELAY_JOBS[i]?.cron }]);
      expect(f.opts.retries).toBe(0);
    }
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    // Vercel Hobby rejects any cron that runs more than once a day.
    for (const c of vercel.crons) expect(moreThanDaily(c.schedule), `${c.path} ${c.schedule}`).toBe(false);
    // Every relayed job keeps a daily Vercel run as a floor.
    const vercelPaths = new Set(vercel.crons.map((c) => c.path));
    for (const j of CRON_RELAY_JOBS) expect(vercelPaths.has(j.path), j.path).toBe(true);
  });
});
