import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callSummaryPrompt, CALL_SUMMARY_MODEL, summarizeCall } from "@/lib/agents/crm/call-notes";
import { extractionPrompt } from "@/lib/agents/documents/prompt";
import { marketPrompt } from "@/lib/agents/intel/market";
import { introPrompt } from "@/lib/agents/intel/outreach";
import { parseTermSheet, termSheetPrompt, TERM_SHEET_MODEL } from "@/lib/agents/lenders/term-sheet";
import { approvedModels } from "@/lib/agents/core/registry";
import { createGateway, MODELS, xaiModel } from "@/lib/ai/gateway";
import { FakeModelProvider } from "@/lib/ai/gateway/fake";
import { MemoryTracer } from "@/lib/langfuse";
import { classifierPrompt, CLASSIFIER_MODEL, classifyMail } from "@/lib/mail/classify";
import { FakeMailProvider } from "@/lib/mail/fake";
import { SAMPLE_EMAILS } from "@/lib/mail/fixtures";
import { levelRank } from "@/lib/privacy/classification";
import {
  AI_TASK_IDS,
  AI_TASKS,
  allowedModels,
  effectiveTaskModel,
  memoryTaskModelStore,
  MemoryTaskModelStore,
  modelRefusal,
  resetTaskModelCache,
  resolveTaskModel,
  resolveTaskModelDetail,
  setTaskModelSource,
  TASK_MODEL_CACHE_MS,
  taskModelOverview,
  taskModelStore,
  type TaskModelSetting,
} from "./model-settings";
import { routeCeiling, providerForModel } from "./routing";

const CLAUDE = [MODELS.claude, MODELS.claudeMid, MODELS.claudeBulk];
const NVIDIA = "nvidia/llama-3.3-nemotron-super-49b-v1.5";
const WITH_NVIDIA = { NVIDIA_NIM_MODEL: NVIDIA };
const ids = (task: (typeof AI_TASK_IDS)[number], env: Record<string, string | undefined> = {}) => allowedModels(task, env).map((m) => m.id);

const setting = (task: string, model: string | null, over: Partial<TaskModelSetting> = {}): TaskModelSetting => ({
  task,
  model,
  previousModel: "claude-haiku-5-5",
  setAt: "2026-11-04T17:00:00.000Z",
  setBy: "00000000-0000-4000-8000-0000000000ad",
  setByLabel: "Demo Admin",
  reason: "testing",
  ...over,
});

function storeWith(...rows: TaskModelSetting[]) {
  const store = new MemoryTaskModelStore();
  store.rows.push(...rows);
  return store;
}

afterEach(() => {
  setTaskModelSource(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("AI task registry", () => {
  it("lists every AI task once, each with a label, description and data note", () => {
    expect(AI_TASK_IDS).toEqual([
      "advisor.chat",
      "mail.triage",
      "documents.extract_text",
      "documents.extract_pdf",
      "lenders.term_sheet",
      "prospecting.intro",
      "crm.call_summary",
      "intel.market_draft",
    ]);
    for (const id of AI_TASK_IDS) {
      const t = AI_TASKS[id];
      expect(t.label.length, id).toBeGreaterThan(3);
      expect(t.description.length, id).toBeGreaterThan(20);
      expect(t.dataNote.length, id).toBeGreaterThan(10);
      expect(t.providers.length, id).toBeGreaterThan(0);
    }
  });

  it("defaults to today's constants, so nothing changes until an administrator chooses", () => {
    const d = (id: (typeof AI_TASK_IDS)[number]) => AI_TASKS[id].defaultModel({});
    expect(d("advisor.chat")).toBe("claude-opus-5-5"); // ADVISOR_MODEL (lib/ai/advisor.ts, server-only)
    expect(d("mail.triage")).toBe(CLASSIFIER_MODEL);
    expect(d("documents.extract_text")).toBe(MODELS.claude);
    expect(d("documents.extract_pdf")).toBe(MODELS.claude);
    expect(d("lenders.term_sheet")).toBe(TERM_SHEET_MODEL);
    expect(d("prospecting.intro")).toBe(MODELS.claudeMid);
    expect(d("crm.call_summary")).toBe(CALL_SUMMARY_MODEL);
    expect(d("intel.market_draft")).toBe(xaiModel({}));
  });

  it("keeps the env overrides as the default layer", () => {
    expect(AI_TASKS["documents.extract_text"].defaultModel({ DOCUMENT_TEXT_MODEL: ` ${NVIDIA} ` })).toBe(NVIDIA);
    expect(AI_TASKS["documents.extract_text"].defaultModel({ DOCUMENT_TEXT_MODEL: "" })).toBe(MODELS.claude);
    expect(AI_TASKS["intel.market_draft"].defaultModel({ XAI_MODEL: "grok-5" })).toBe("grok-5");
    expect(AI_TASKS["documents.extract_text"].defaultEnv).toBe("DOCUMENT_TEXT_MODEL");
    expect(AI_TASKS["intel.market_draft"].defaultEnv).toBe("XAI_MODEL");
  });

  it("matches the purpose each task's registered prompt declares", () => {
    expect(AI_TASKS["mail.triage"].purpose).toBe(classifierPrompt().purpose);
    expect(AI_TASKS["documents.extract_text"].purpose).toBe(extractionPrompt("T12").purpose);
    expect(AI_TASKS["lenders.term_sheet"].purpose).toBe(termSheetPrompt().purpose);
    expect(AI_TASKS["crm.call_summary"].purpose).toBe(callSummaryPrompt().purpose);
    expect(AI_TASKS["prospecting.intro"].purpose).toBe("drafting");
    expect(AI_TASKS["intel.market_draft"].purpose).toBe("market_intel");
  });
});

describe("allowed models", () => {
  it("offers the Claude tiers wherever Claude may go, and only the xAI model for market intel", () => {
    for (const id of AI_TASK_IDS.filter((t) => t !== "intel.market_draft")) expect(ids(id), id).toEqual(CLAUDE);
    expect(ids("intel.market_draft")).toEqual([xaiModel({})]);
    expect(ids("intel.market_draft", { XAI_MODEL: "grok-5" })).toEqual(["grok-5"]);
  });

  it("offers a configured NVIDIA model only where the call path and the routing guard allow it", () => {
    for (const id of ["mail.triage", "lenders.term_sheet", "prospecting.intro", "crm.call_summary"] as const) expect(ids(id, WITH_NVIDIA), id).toEqual([...CLAUDE, NVIDIA]);
    // Restricted documents (PFS, tax returns) may only go to Claude.
    expect(ids("documents.extract_text", WITH_NVIDIA)).toEqual(CLAUDE);
    expect(modelRefusal("documents.extract_text", NVIDIA, WITH_NVIDIA)).toMatchObject({ code: "routing_refused", reasons: expect.arrayContaining(["exceeds_provider_ceiling"]) });
    // The assistant and the PDF reader call Anthropic directly; market intel is pinned to xAI.
    expect(modelRefusal("advisor.chat", NVIDIA, WITH_NVIDIA)).toEqual({ code: "provider_not_supported" });
    expect(modelRefusal("documents.extract_pdf", NVIDIA, WITH_NVIDIA)).toEqual({ code: "provider_not_supported" });
    expect(modelRefusal("intel.market_draft", MODELS.claude, {})).toEqual({ code: "provider_not_supported" });
  });

  it("never offers xAI outside market intel, or anything off the approved list", () => {
    for (const id of AI_TASK_IDS.filter((t) => t !== "intel.market_draft")) expect(modelRefusal(id, xaiModel({}), {}), id).toEqual({ code: "xai_market_intel_only" });
    expect(modelRefusal("mail.triage", "gpt-unknown", {})).toEqual({ code: "not_approved" });
    expect(modelRefusal("mail.triage", NVIDIA, {})).toEqual({ code: "not_approved" }); // NVIDIA_NIM_MODEL unset
    expect(modelRefusal("mail.triage", MODELS.claudeMid, {})).toBeNull();
  });

  it("never offers a provider whose routing ceiling is below the task's data", () => {
    const env = { NVIDIA_NIM_MODEL: NVIDIA, XAI_MODEL: "grok-4" };
    for (const id of AI_TASK_IDS) {
      const task = AI_TASKS[id];
      for (const m of allowedModels(id, env)) {
        const provider = providerForModel(m.id)!;
        expect(task.providers, `${id} ${m.id}`).toContain(provider);
        expect(levelRank(routeCeiling(provider, task.purpose)), `${id} ${m.id}`).toBeGreaterThanOrEqual(levelRank(task.dataCeiling));
      }
    }
  });

  it("includes every code default (with no env overrides)", () => {
    for (const id of AI_TASK_IDS) expect(ids(id), id).toContain(AI_TASKS[id].defaultModel({}));
  });
});

describe("effectiveTaskModel", () => {
  it("uses the default with no setting, or a setting back to the default", () => {
    expect(effectiveTaskModel("mail.triage", null, {})).toMatchObject({ model: MODELS.claudeBulk, source: "default", ignored: null });
    expect(effectiveTaskModel("mail.triage", setting("mail.triage", null), {})).toMatchObject({ model: MODELS.claudeBulk, source: "default", ignored: null });
  });

  it("uses an allowed stored model", () => {
    expect(effectiveTaskModel("mail.triage", setting("mail.triage", MODELS.claudeMid), {})).toMatchObject({ model: MODELS.claudeMid, source: "setting", defaultModel: MODELS.claudeBulk });
  });

  it("re-checks at read time: a model removed from the approved list falls back to the default", () => {
    const stored = setting("mail.triage", NVIDIA);
    expect(effectiveTaskModel("mail.triage", stored, WITH_NVIDIA)).toMatchObject({ model: NVIDIA, source: "setting" });
    expect(effectiveTaskModel("mail.triage", stored, {})).toMatchObject({ model: MODELS.claudeBulk, source: "default", ignored: { model: NVIDIA, refusal: { code: "not_approved" } } });
    // A row the guard would refuse (written before a rule tightened, or by hand) is ignored too.
    expect(effectiveTaskModel("documents.extract_pdf", setting("documents.extract_pdf", NVIDIA), WITH_NVIDIA)).toMatchObject({ model: MODELS.claude, source: "default" });
  });
});

describe("resolveTaskModel", () => {
  beforeEach(() => resetTaskModelCache());

  it("returns the default when Supabase is not configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("AUTH_PROVIDER", "");
    expect(await taskModelStore()).toBeNull();
    for (const id of AI_TASK_IDS) expect(await resolveTaskModel(id), id).toBe(AI_TASKS[id].defaultModel(process.env));
    expect(await resolveTaskModelDetail("mail.triage")).toMatchObject({ source: "default", setting: null });
  });

  it("uses the in-memory store in fake-auth mode", async () => {
    vi.stubEnv("AUTH_PROVIDER", "fake");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const mem = memoryTaskModelStore();
    expect(await taskModelStore()).toBe(mem);
    const before = mem.rows.length;
    mem.rows.push(setting("crm.call_summary", MODELS.claude));
    try {
      expect(await resolveTaskModel("crm.call_summary")).toBe(MODELS.claude);
    } finally {
      mem.rows.splice(before);
    }
  });

  it("returns the latest stored model", async () => {
    setTaskModelSource(async () => storeWith(setting("mail.triage", MODELS.claude), setting("mail.triage", MODELS.claudeMid)));
    expect(await resolveTaskModel("mail.triage")).toBe(MODELS.claudeMid);
    expect(await resolveTaskModel("lenders.term_sheet")).toBe(MODELS.claude);
  });

  it("falls back to the default, with one warning, when a stored model is no longer allowed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setTaskModelSource(async () => storeWith(setting("crm.call_summary", "claude-retired-4")));
    expect(await resolveTaskModel("crm.call_summary")).toBe(MODELS.claudeMid);
    expect(await resolveTaskModel("crm.call_summary")).toBe(MODELS.claudeMid);
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes("claude-retired-4"));
    expect(hits).toHaveLength(1);
    expect(String(hits[0]![0])).toMatch(/no longer allowed \(not_approved\)/);
  });

  it("caches settings for about a minute, and a reset reads again", async () => {
    const store = storeWith(setting("mail.triage", MODELS.claudeMid));
    const current = vi.spyOn(store, "current");
    setTaskModelSource(async () => store);
    const t0 = 1_000_000;
    expect(await resolveTaskModel("mail.triage", { now: t0 })).toBe(MODELS.claudeMid);
    store.rows.push(setting("mail.triage", MODELS.claude));
    expect(await resolveTaskModel("mail.triage", { now: t0 + TASK_MODEL_CACHE_MS - 1 })).toBe(MODELS.claudeMid);
    expect(current).toHaveBeenCalledTimes(1);
    expect(await resolveTaskModel("mail.triage", { now: t0 + TASK_MODEL_CACHE_MS })).toBe(MODELS.claude);
    expect(current).toHaveBeenCalledTimes(2);
    store.rows.push(setting("mail.triage", null));
    resetTaskModelCache();
    expect(await resolveTaskModel("mail.triage", { now: t0 + TASK_MODEL_CACHE_MS + 1 })).toBe(MODELS.claudeBulk);
  });

  it("never caches a read that started before a save", async () => {
    const store = storeWith(setting("mail.triage", MODELS.claudeMid));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setTaskModelSource(async () => {
      const snapshot = storeWith(...store.rows); // what the read sees
      await gate;
      return snapshot;
    });
    const inFlight = resolveTaskModel("mail.triage", { now: 0 });
    // A save lands while the read is in flight.
    store.rows.push(setting("mail.triage", MODELS.claude));
    resetTaskModelCache();
    release();
    expect(await inFlight).toBe(MODELS.claudeMid);
    expect(await resolveTaskModel("mail.triage", { now: 1 })).toBe(MODELS.claude);
  });

  it("reads the store once for concurrent calls", async () => {
    const store = storeWith(setting("mail.triage", MODELS.claudeMid));
    const current = vi.spyOn(store, "current");
    setTaskModelSource(async () => store);
    const models = await Promise.all(AI_TASK_IDS.map((id) => resolveTaskModel(id)));
    expect(models[1]).toBe(MODELS.claudeMid);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("never throws: a read error means the last known settings, or the defaults", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let fail = true;
    setTaskModelSource(async () => {
      if (fail) throw new Error("ai_task_models read failed: connection refused");
      return storeWith(setting("mail.triage", MODELS.claudeMid));
    });
    expect(await resolveTaskModel("mail.triage", { now: 0 })).toBe(MODELS.claudeBulk);
    fail = false;
    expect(await resolveTaskModel("mail.triage", { now: TASK_MODEL_CACHE_MS })).toBe(MODELS.claudeMid);
    fail = true;
    expect(await resolveTaskModel("mail.triage", { now: 2 * TASK_MODEL_CACHE_MS })).toBe(MODELS.claudeMid);
  });
});

describe("call sites run on the resolved model and record it", () => {
  beforeEach(() => resetTaskModelCache());
  const gatewayFor = (answer: Record<string, unknown>) => {
    const anthropic = new FakeModelProvider("anthropic", () => ({ text: JSON.stringify(answer) }));
    return { anthropic, gateway: createGateway({ providers: { anthropic }, tracer: new MemoryTracer() }) };
  };

  it("mail triage", async () => {
    setTaskModelSource(async () => storeWith(setting("mail.triage", MODELS.claudeMid)));
    const { anthropic, gateway } = gatewayFor({ category: "new_inquiry", summary: "s", dealReference: null, propertyName: null, counterparty: null, documentKinds: [], urgency: "normal", needsBroker: true, suspicious: false, confidence: 0.9 });
    const res = await classifyMail(new FakeMailProvider().add(SAMPLE_EMAILS.newInquiry), { gateway });
    expect(anthropic.requests[0]!.model).toBe(MODELS.claudeMid);
    // Same prompt version and hash; the ref (agent_events) and mail_messages.classifier_model carry the model used.
    expect(res.prompt).toMatchObject({ id: "mail.classify", version: classifierPrompt().version, sha256: classifierPrompt().sha256, model: MODELS.claudeMid });
    expect(res.classification.model).toBe(MODELS.claudeMid);
  });

  it("term-sheet parser and CRM call summary", async () => {
    setTaskModelSource(async () => storeWith(setting("lenders.term_sheet", MODELS.claudeMid), setting("crm.call_summary", MODELS.claudeBulk)));
    const ts = gatewayFor({});
    const parsed = await parseTermSheet({ from: "Lender <l@bank.example>", subject: "Term sheet", body: "Loan amount $5,000,000 at 6.25% for 10 years.", receivedAt: "2026-11-04T00:00:00Z" }, { gateway: ts.gateway });
    expect(ts.anthropic.requests[0]!.model).toBe(MODELS.claudeMid);
    expect(parsed.prompt).toMatchObject({ id: "lenders.term_sheet", model: MODELS.claudeMid });

    const crm = gatewayFor({ summary: "Talked about a refinance.", agreed: [], followUps: [] });
    const call = await summarizeCall({ callId: "c1", direction: "inbound", startedAt: "2026-11-04T00:00:00Z", durationSeconds: 120, dealId: null, leadId: null, transcript: "We discussed a refinance." }, { gateway: crm.gateway });
    expect(crm.anthropic.requests[0]!.model).toBe(MODELS.claudeBulk);
    expect(call).toMatchObject({ model: MODELS.claudeBulk, prompt: { id: "crm.call_summary", model: MODELS.claudeBulk } });
  });

  it("prospect intro and market intel keep one registered prompt version per text", () => {
    const a = introPrompt(MODELS.claude);
    const b = introPrompt();
    expect(a).toMatchObject({ model: MODELS.claude, version: b.version, sha256: b.sha256 });
    expect(b.model).toBe(MODELS.claudeMid);
    expect(marketPrompt(xaiModel()).registered).toBe(true);
  });

  it("uses the defaults with no settings", async () => {
    setTaskModelSource(async () => null);
    const { anthropic, gateway } = gatewayFor({ category: "other", summary: "s", dealReference: null, propertyName: null, counterparty: null, documentKinds: [], urgency: "normal", needsBroker: true, suspicious: false, confidence: 0.9 });
    await classifyMail(new FakeMailProvider().add(SAMPLE_EMAILS.newInquiry), { gateway });
    expect(anthropic.requests[0]!.model).toBe(CLASSIFIER_MODEL);
  });
});

describe("taskModelOverview", () => {
  it("shows every task on its default without a store", async () => {
    const rows = await taskModelOverview(null, { env: {} });
    expect(rows.map((r) => r.id)).toEqual([...AI_TASK_IDS]);
    for (const r of rows) {
      expect(r.resolution).toMatchObject({ source: "default", model: AI_TASKS[r.id].defaultModel({}) });
      expect(r.history).toEqual([]);
      expect(r.defaultFromEnv).toBeNull();
    }
  });

  it("reads history newest first, the current choice and env-set defaults", async () => {
    const store = storeWith(setting("mail.triage", MODELS.claude, { reason: "first" }), setting("mail.triage", MODELS.claudeMid, { reason: "second" }));
    const rows = await taskModelOverview(store, { env: { DOCUMENT_TEXT_MODEL: MODELS.claudeMid } });
    const mail = rows.find((r) => r.id === "mail.triage")!;
    expect(mail.history.map((h) => h.reason)).toEqual(["second", "first"]);
    expect(mail.resolution).toMatchObject({ model: MODELS.claudeMid, source: "setting" });
    expect(mail.allowed.map((m) => m.id)).toEqual(CLAUDE);
    const docs = rows.find((r) => r.id === "documents.extract_text")!;
    expect(docs).toMatchObject({ defaultFromEnv: "DOCUMENT_TEXT_MODEL", resolution: { model: MODELS.claudeMid, source: "default" } });
  });
});

describe("approved list", () => {
  it("is the registry's own list (no second allow-list)", () => {
    expect(new Set(allowedModels("mail.triage", WITH_NVIDIA).map((m) => m.id))).toEqual(new Set(approvedModels(WITH_NVIDIA).filter((m) => m.tier !== "xai").map((m) => m.id)));
  });
});
