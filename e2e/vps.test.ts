import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { MAX_UPLOAD_BYTES } from "@/lib/checklists/uploads";
import { site } from "@/lib/site";
import { CRON_RELAY_JOBS } from "@/lib/workflows/cron-relay";

// The VPS bridge: .github/workflows/vps.yml runs ops/vps/* over SSH from
// GitHub's runners. These checks keep the scripts, the server config and the
// app in step.

const read = (p: string) => readFileSync(p, "utf8");
const OPS = "ops/vps";

type Step = { name?: string; run?: string; env?: Record<string, string>; if?: string; uses?: string };
const workflow = parse(read(".github/workflows/vps.yml")) as {
  on: { workflow_dispatch: { inputs: { task: { options: string[] } } }; push: { branches: string[]; tags: string[] } };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { steps: Step[] }>;
};
const steps = Object.values(workflow.jobs).flatMap((j) => j.steps);

describe("VPS workflow", () => {
  it("runs from the Actions tab, vps/* tags and pushes to main, one task at a time, with a read-only token", () => {
    expect(workflow.on.workflow_dispatch.inputs.task.options).toEqual(["inspect", "setup", "deploy", "rollback", "status", "run", "tls", "harden"]);
    expect(workflow.on.push.tags).toEqual(["vps/**"]);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({ group: "vps", "cancel-in-progress": false });
  });

  it("never expands secrets, inputs or tag text inside a shell script", () => {
    // Values reach the shell through env, so a quote in a secret or a tag message cannot inject commands.
    for (const s of steps.filter((x) => x.run)) {
      expect(s.run, s.name).not.toMatch(/\$\{\{\s*(secrets|inputs|vars|github\.event|steps\.[^}]*outputs)/);
    }
  });

  it("only reads the documented secrets", () => {
    const used = new Set([...read(".github/workflows/vps.yml").matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(["CORIN_BUILD_ENV", "CORIN_ENV", "VPS_HOST", "VPS_KNOWN_HOSTS", "VPS_PORT", "VPS_SSH_KEY", "VPS_USER"]);
  });

  it("builds the standalone server only when the deploy asks for it", () => {
    const build = steps.find((s) => s.name === "Build the release");
    expect(build?.env?.NEXT_OUTPUT_STANDALONE).toBe("1");
    expect(build?.env?.DEPLOY_ENV).toBe("production");
    expect(read("next.config.ts")).toMatch(/process\.env\.NEXT_OUTPUT_STANDALONE === "1" \? \{ output: "standalone"/);
  });
});

describe("ops/vps scripts", () => {
  const scripts = readdirSync(OPS).filter((f) => f.endsWith(".sh") || f === "corin-cron");

  it.each(scripts)("%s is valid bash", (f) => {
    const res = spawnSync("bash", ["-n", `${OPS}/${f}`], { encoding: "utf8" });
    expect(res.status, res.stderr).toBe(0);
  });

  it("setup.sh installs only files that exist here", () => {
    const refs = [...read(`${OPS}/setup.sh`).matchAll(/"\$SRC\/([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(5);
    const present = new Set(readdirSync(OPS));
    for (const r of refs) expect(present.has(r), r).toBe(true);
  });
});

describe("server config", () => {
  const service = read(`${OPS}/corin.service`);
  const nginx = read(`${OPS}/nginx-corin.conf`);

  it("runs the app in production on the port nginx proxies to", () => {
    expect(service).toMatch(/^Environment=DEPLOY_ENV=production$/m);
    expect(service).toMatch(/^Environment=PORT=3000$/m);
    expect(nginx).toMatch(/server 127\.0\.0\.1:3000;/);
  });

  it("does not bind the app to 127.0.0.1, which breaks Next's internal proxy rewrites", () => {
    // With HOSTNAME=127.0.0.1 the express-domain rewrite and the unknown-slug 404
    // are treated as another origin: kubera.loans loops on a 308 and unknown slugs 500.
    expect(service).not.toMatch(/^Environment=HOSTNAME=127\.0\.0\.1$/m);
  });

  it("serves both domains and accepts the largest borrower upload", () => {
    for (const host of [site.primaryDomain, `www.${site.primaryDomain}`, site.expressDomain, `www.${site.expressDomain}`]) {
      expect(nginx).toContain(` ${host}`);
    }
    const mb = Number(/client_max_body_size (\d+)m;/.exec(nginx)?.[1]);
    expect(mb * 1024 * 1024).toBeGreaterThanOrEqual(MAX_UPLOAD_BYTES);
  });

  it("schedules every job the app expects, as the app user", () => {
    const lines = read(`${OPS}/cron.d-corin`).split("\n").filter((l) => /^[\d*]/.test(l));
    const entries = lines.map((l) => l.trim().split(/\s+/));
    for (const e of entries) {
      expect(e.slice(5, 7)).toEqual(["corin", "corin-cron"]);
    }
    const paths = new Set(entries.map((e) => e[7]));
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    for (const p of [...CRON_RELAY_JOBS.map((j) => j.path), ...vercel.crons.map((c) => c.path)]) {
      expect(paths.has(p), p).toBe(true);
    }
  });
});
