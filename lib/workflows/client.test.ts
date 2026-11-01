import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["INNGEST_DEV", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY", "VERCEL_ENV", "DEPLOY_ENV", "INNGEST_BASE_URL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

async function freshClient() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("Inngest dev mode is refused in production", () => {
  it("ignores INNGEST_DEV=1 in production: configuration follows the keys and the client stays in cloud mode", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.INNGEST_DEV = "1";
    const { workflowsConfigured, inngest, inngestDevMode } = await freshClient();
    expect(inngestDevMode()).toBe(false);
    expect(workflowsConfigured()).toBe(false);
    expect(inngest().mode).toBe("cloud");

    process.env.INNGEST_EVENT_KEY = "evt";
    process.env.INNGEST_SIGNING_KEY = "signkey-prod-0000";
    expect(workflowsConfigured()).toBe(true);
    expect(inngest().mode).toBe("cloud");
  });

  it("ignores a dev-server URL in INNGEST_DEV in production, even next to real keys", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.INNGEST_DEV = "http://localhost:8288";
    process.env.INNGEST_EVENT_KEY = "evt";
    process.env.INNGEST_SIGNING_KEY = "signkey-prod-0000";
    const { workflowsConfigured, inngest } = await freshClient();
    expect(workflowsConfigured()).toBe(true);
    expect(inngest().mode).toBe("cloud");

    delete process.env.INNGEST_SIGNING_KEY;
    expect(workflowsConfigured()).toBe(false);
  });

  it("also refuses dev mode when DEPLOY_ENV=production (non-Vercel hosts)", async () => {
    process.env.DEPLOY_ENV = "production";
    process.env.INNGEST_DEV = "true";
    const { workflowsConfigured, inngest } = await freshClient();
    expect(workflowsConfigured()).toBe(false);
    expect(inngest().mode).toBe("cloud");
  });

  it("logs the refusal once", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.INNGEST_DEV = "1";
    const warn = vi.mocked(console.warn);
    const { inngestDevMode } = await freshClient();
    inngestDevMode();
    inngestDevMode();
    const refusals = warn.mock.calls.filter((c) => String(c[0]).includes("INNGEST_DEV is ignored in production"));
    expect(refusals).toHaveLength(1);
  });
});

describe("Inngest dev mode outside production", () => {
  it("uses dev mode for INNGEST_DEV=1 without keys", async () => {
    process.env.INNGEST_DEV = "1";
    const { workflowsConfigured, inngest } = await freshClient();
    expect(workflowsConfigured()).toBe(true);
    expect(inngest().mode).toBe("dev");
  });

  it("uses dev mode for a dev-server URL", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.INNGEST_DEV = "http://localhost:8288";
    const { workflowsConfigured, inngest } = await freshClient();
    expect(workflowsConfigured()).toBe(true);
    expect(inngest().mode).toBe("dev");
  });

  it("stays in cloud mode when INNGEST_DEV is unset, 0 or false", async () => {
    for (const value of [undefined, "0", "false"]) {
      if (value === undefined) delete process.env.INNGEST_DEV;
      else process.env.INNGEST_DEV = value;
      const { workflowsConfigured, inngest } = await freshClient();
      expect(workflowsConfigured()).toBe(false);
      expect(inngest().mode).toBe("cloud");
    }
  });
});
