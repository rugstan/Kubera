import { afterEach, describe, expect, it } from "vitest";
import { evaluateStaffAccess } from "@/lib/auth/policy";
import type { Profile, StaffPrincipal, StaffRole } from "@/lib/auth/types";
import { MODELS, xaiModel } from "./gateway";
import { ModelSettingError, setTaskModel } from "./model-settings-admin";
import { MemoryTaskModelStore, resetTaskModelCache, resolveTaskModel, setTaskModelSource } from "./model-settings";

const NOW = new Date("2026-11-04T18:00:00Z");
const NVIDIA = "nvidia/llama-3.3-nemotron-super-49b-v1.5";

function principal(roles: StaffRole[], over: Partial<Profile> = {}): StaffPrincipal {
  const profile: Profile = {
    id: "00000000-0000-4000-8000-0000000000ad",
    email: "ops@corin.test",
    fullName: "Ops Admin",
    title: null,
    active: true,
    dreLicenseNumber: null,
    dreLicenseType: null,
    dreLicenseExpiresOn: null,
    dreLicenseVerifiedAt: null,
    ...over,
  };
  const d = evaluateStaffAccess({ session: { userId: profile.id, email: profile.email, aal: "aal2" }, profile, roles });
  if (d.kind !== "allow") throw new Error(`expected allow, got ${d.kind}`);
  return d.principal;
}

const ADMIN = principal(["admin"]);
const BROKER = principal(["broker"], { fullName: "Dana Broker", dreLicenseNumber: "01234567", dreLicenseType: "broker", dreLicenseExpiresOn: "2029-01-01", dreLicenseVerifiedAt: "2026-01-01T00:00:00Z" });
const ANALYST = principal(["analyst"]);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ModelSettingError) return err.code;
    throw err;
  }
  return "ok";
}

afterEach(() => setTaskModelSource(undefined));

describe("setTaskModel", () => {
  it("records who, when, from, to and why, and the resolver uses it at once", async () => {
    const store = new MemoryTaskModelStore();
    setTaskModelSource(async () => store);
    expect(await resolveTaskModel("mail.triage")).toBe(MODELS.claudeBulk); // cached default
    const s = await setTaskModel(store, { task: "mail.triage", model: MODELS.claudeMid, reason: "  Haiku misfiles lender replies  " }, ADMIN, { now: NOW, env: {} });
    expect(s).toEqual({
      task: "mail.triage",
      model: MODELS.claudeMid,
      previousModel: MODELS.claudeBulk,
      setAt: NOW.toISOString(),
      setBy: ADMIN.userId,
      setByLabel: "Ops Admin",
      reason: "Haiku misfiles lender replies",
    });
    expect(store.rows).toHaveLength(1);
    // The save drops the cache, so this process runs the next call on the new model.
    expect(await resolveTaskModel("mail.triage")).toBe(MODELS.claudeMid);
  });

  it("goes back to the default with a null model, recording what it ran on before", async () => {
    const store = new MemoryTaskModelStore();
    await setTaskModel(store, { task: "crm.call_summary", model: MODELS.claude, reason: "Longer calls" }, ADMIN, { now: NOW, env: {} });
    const back = await setTaskModel(store, { task: "crm.call_summary", model: null, reason: "Back to normal" }, ADMIN, { now: NOW, env: {} });
    expect(back).toMatchObject({ model: null, previousModel: MODELS.claude });
    resetTaskModelCache();
    setTaskModelSource(async () => store);
    expect(await resolveTaskModel("crm.call_summary")).toBe(MODELS.claudeMid);
  });

  it("is for administrators only: brokers and analysts are refused and nothing is written", async () => {
    const store = new MemoryTaskModelStore();
    for (const who of [BROKER, ANALYST]) {
      expect(await code(setTaskModel(store, { task: "mail.triage", model: MODELS.claude, reason: "x" }, who, { now: NOW, env: {} }))).toBe("forbidden");
    }
    expect(store.rows).toEqual([]);
  });

  it("requires a reason", async () => {
    const store = new MemoryTaskModelStore();
    expect(await code(setTaskModel(store, { task: "mail.triage", model: MODELS.claude, reason: "" }, ADMIN, { now: NOW, env: {} }))).toBe("reason_required");
    expect(await code(setTaskModel(store, { task: "mail.triage", model: MODELS.claude, reason: "   \n " }, ADMIN, { now: NOW, env: {} }))).toBe("reason_required");
    expect(store.rows).toEqual([]);
  });

  it("rejects models the task does not allow", async () => {
    const store = new MemoryTaskModelStore();
    const tryModel = (task: string, model: string, env: Record<string, string> = {}) => code(setTaskModel(store, { task, model, reason: "try" }, ADMIN, { now: NOW, env }));
    expect(await tryModel("mail.triage", "gpt-unknown")).toBe("model_not_allowed");
    expect(await tryModel("mail.triage", xaiModel({}))).toBe("model_not_allowed"); // xAI: market intel only
    expect(await tryModel("documents.extract_text", NVIDIA, { NVIDIA_NIM_MODEL: NVIDIA })).toBe("model_not_allowed"); // restricted documents stay on Claude
    expect(await tryModel("advisor.chat", NVIDIA, { NVIDIA_NIM_MODEL: NVIDIA })).toBe("model_not_allowed"); // the assistant calls Anthropic directly
    expect(await tryModel("intel.market_draft", MODELS.claude)).toBe("model_not_allowed");
    expect(await tryModel("not.a_task", MODELS.claude)).toBe("unknown_task");
    expect(store.rows).toEqual([]);
    expect(await tryModel("mail.triage", NVIDIA, { NVIDIA_NIM_MODEL: NVIDIA })).toBe("ok");
  });

  it("refuses a change that changes nothing", async () => {
    const store = new MemoryTaskModelStore();
    expect(await code(setTaskModel(store, { task: "mail.triage", model: null, reason: "x" }, ADMIN, { now: NOW, env: {} }))).toBe("no_change");
    await setTaskModel(store, { task: "mail.triage", model: MODELS.claude, reason: "x" }, ADMIN, { now: NOW, env: {} });
    expect(await code(setTaskModel(store, { task: "mail.triage", model: MODELS.claude, reason: "again" }, ADMIN, { now: NOW, env: {} }))).toBe("no_change");
    expect(store.rows).toHaveLength(1);
  });
});
