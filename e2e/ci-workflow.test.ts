import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { "runs-on": string; "timeout-minutes"?: number; steps: Step[] };
const workflow = parse(read(".github/workflows/ci.yml")) as {
  name: string;
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  env: Record<string, string>;
  jobs: Record<string, Job>;
};
const runs = (job: Job) => job.steps.map((s) => s.run).filter(Boolean) as string[];
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

describe("CI workflow", () => {
  it("is valid YAML with push and pull_request triggers and a read-only token", () => {
    expect(workflow.name).toBe("CI");
    expect(Object.keys(workflow.on)).toEqual(expect.arrayContaining(["push", "pull_request"]));
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("runs the full verification pipeline on Node 22", () => {
    const verify = workflow.jobs.verify!;
    expect(workflow.env.NODE_VERSION).toBe("22");
    expect(verify.steps.some((s) => s.uses?.startsWith("actions/setup-node@") && s.with?.["node-version"] === "${{ env.NODE_VERSION }}")).toBe(true);
    expect(runs(verify)).toEqual(expect.arrayContaining(["npm ci", "npm run typecheck", "npm run lint", "npm test", "npm run test:migrations", "npm run build"]));
  });

  it("runs Playwright against Chromium in its own job", () => {
    const e2e = workflow.jobs.e2e!;
    expect(runs(e2e)).toEqual(expect.arrayContaining(["npm ci", "npx playwright install --with-deps chromium", "npm run test:e2e"]));
    expect(e2e.steps.some((s) => s.uses?.startsWith("actions/upload-artifact@"))).toBe(true);
  });

  it("only calls npm scripts that exist", () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const cmd of runs(job)) {
        const m = /^npm (?:run )?([a-z:]+)$/.exec(cmd);
        if (m && m[1] !== "ci") expect(pkg.scripts, cmd).toHaveProperty(m[1]!);
      }
    }
  });

  it("gives the production build a license number and never references repository secrets", () => {
    expect(workflow.env.NEXT_PUBLIC_DRE_CORPORATE_LICENSE).toBeTruthy();
    expect(read(".github/workflows/ci.yml")).not.toMatch(/secrets\./);
  });

  it("keeps the Playwright server port aligned with the plan", () => {
    expect(read("playwright.config.ts")).toMatch(/E2E_PORT \?\? 3999/);
  });
});

describe("vercel.json", () => {
  const vercel = JSON.parse(read("vercel.json")) as { framework?: string; crons: { path: string; schedule: string }[] };

  it("pins the Next.js framework preset so git-triggered builds never fall back to a static build", () => {
    expect(vercel.framework).toBe("nextjs");
  });

  it("schedules the rates and CRM retry crons", () => {
    expect(vercel.crons.map((c) => c.path)).toEqual(expect.arrayContaining(["/api/cron/rates", "/api/cron/crm-retry"]));
    for (const c of vercel.crons) expect(c.schedule.split(" ")).toHaveLength(5);
  });
});
