import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureConstruction, resetConstructionConfig } from "@/lib/construction/server";
import { addLeaseUpSnapshot, createProject, updateConversion } from "@/lib/construction/service";
import { MemoryConstructionStore } from "@/lib/construction/store";
import { makeDeps, projectInput } from "@/lib/construction/test-fixtures";

vi.mock("server-only", () => ({}));

const { GET } = await import("./route");

const SECRET = "cron-secret-for-tests-0123456789";
const call = (auth?: string) => GET(new Request("https://kuberacommercial.com/api/cron/construction-takeouts", { headers: auth ? { authorization: auth } : {} }));

describe("construction take-out sweep cron", () => {
  beforeEach(() => vi.stubEnv("CRON_SECRET", SECRET));
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConstructionConfig();
  });

  it("requires the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
  });

  it("records take-out triggers for projects that reached stabilization", async () => {
    const deps = makeDeps();
    const store = deps.store as MemoryConstructionStore;
    const project = await createProject(deps, "broker@kubera.test", projectInput({ name: "Harbor View" }));
    await store.updateProject(project.id, { phase: "under_construction" }, deps.now());
    await updateConversion(deps, "a", project.id, { unitsTotal: "120", coDate: "2026-05-01", loanMaturityDate: "", extensionDeadline: "", payoffTargetDate: "" });
    await addLeaseUpSnapshot(deps, "a", project.id, { asOf: "2026-07-01", unitsLeased: "115", unitsOccupied: "110" });
    await addLeaseUpSnapshot(deps, "a", project.id, { asOf: "2026-10-15", unitsLeased: "117", unitsOccupied: "114" });
    // Forget the trigger the snapshot recorded so the sweep has something to find.
    const conversion = (await store.getConversion(project.id))!;
    expect(await store.getTakeout(conversion.id)).not.toBeNull();
    (store as unknown as { takeouts: Map<string, unknown> }).takeouts.delete(conversion.id);
    configureConstruction({ store, deals: deps.deals, gate: deps.gate });
    const res = await call(`Bearer ${SECRET}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, checked: 1 });
    expect(await store.getTakeout(conversion.id)).not.toBeNull();
  });
});
