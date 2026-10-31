// Route tests for the advisor-only handling promise (privacy request type
// human_review): once a person opts out, the qualifier must not score them
// automatically (no Jev rules, no remote Jev call) and must not show an
// automated result, and an advisor conversation tied to their lead must not
// send their personal information to the model.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { BetaMessage, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";

const state = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  afterCallbacks: [] as (() => Promise<void> | void)[],
  pushLead: vi.fn(async (..._args: unknown[]) => ({ personId: "person-1", opportunityId: "opp-1" })),
}));

const LEAD = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const db = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        state.inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10" }, error: null }) }) };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
  return { supabaseAdmin: () => db, DOCUMENT_BUCKET: "deal-documents" };
});
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<void> | void) => {
    state.afterCallbacks.push(fn);
  },
}));
vi.mock("@/lib/crm/twenty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crm/twenty")>()),
  pushLead: state.pushLead,
  twentyConfigured: () => true,
}));
vi.mock("@/lib/rates", async () => {
  const { FALLBACK_BENCHMARKS } = await import("@/lib/sizing/assumptions");
  return { getMarketSnapshot: async () => ({ benchmarks: FALLBACK_BENCHMARKS, items: [], asOf: "2026-10-30", live: false }) };
});

const { MemoryRateLimiter, setRateLimiter } = await import("@/lib/ratelimit");
const { FakeTurnstileVerifier } = await import("@/lib/turnstile/fake");
const { setTurnstileVerifier } = await import("@/lib/turnstile");
const { MemoryConsentLedger, setConsentLedger } = await import("@/lib/consent/ledger");
const { MemoryConversationStore, setConversationStore } = await import("@/lib/conversations/store");
const { setAdvisorModel } = await import("@/lib/ai/advisor");
const { humanReviewSummary } = await import("@/lib/ai/jev");
const { MemoryPrivacyDb } = await import("@/lib/privacy/fake");
const { MemoryObjectStorage } = await import("@/lib/privacy/storage");
const { setPrivacyServices } = await import("@/lib/privacy/server");

const qualify = await import("./route");
const privacy = await import("../privacy/request/route");
const ask = await import("../ask/route");

const ORIGIN = "https://kuberacommercial.com";
const JEV_URL = "https://jev.test/decide";

const leadBody = {
  intake: { assetType: "ASSISTED_LIVING", transaction: "REFINANCE", loanAmount: 2_500_000, noi: 420_000, value: 3_400_000, unitCount: 58, source: "express" },
  contact: { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "415-555-0100", company: "", consent: true },
};

let turnstile: InstanceType<typeof FakeTurnstileVerifier>;
let privacyDb: InstanceType<typeof MemoryPrivacyDb>;
let conversations: InstanceType<typeof MemoryConversationStore>;
let fetchSpy: MockInstance<typeof fetch>;
let ip = 0;
let token = 0;

function request(path: string, body: unknown, action: "qualify" | "privacy" | "ask" | null) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "user-agent": "vitest",
      "x-forwarded-for": `192.0.2.${++ip % 250}`,
      ...(action ? { "x-turnstile-token": turnstile.issue(`t${++token}`, action) } : {}),
    },
    body: JSON.stringify(body),
  });
}

function installPrivacy(requests: InstanceType<typeof MemoryPrivacyDb> = privacyDb) {
  setPrivacyServices({
    requests,
    subjects: privacyDb,
    retention: privacyDb,
    storage: new MemoryObjectStorage(),
    legalHolds: privacyDb,
    verifyLeadToken: () => false,
    leadEmail: async (id) => (id === LEAD ? "pat@example.com" : null),
  });
}

async function optOut(email = "pat@example.com") {
  const res = await privacy.POST(request("/api/privacy/request", { type: "human_review", name: "Pat Lee", email, attest: true }, "privacy"));
  expect(res.status).toBe(201);
  expect(await privacyDb.getPreferences(email)).toMatchObject({ human_review_only: true, ai_processing_opt_out: true });
}

const jevCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url) === JEV_URL);
const runAfter = async () => {
  for (const fn of state.afterCallbacks.splice(0)) await fn();
};

beforeEach(() => {
  state.inserts.length = 0;
  state.afterCallbacks.length = 0;
  state.pushLead.mockClear();
  vi.stubEnv("JEV_API_URL", JEV_URL);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("LEAD_TOKEN_SECRET", "test-secret-test-secret");
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("unavailable", { status: 503 }));
  setRateLimiter(new MemoryRateLimiter());
  turnstile = new FakeTurnstileVerifier();
  setTurnstileVerifier(turnstile);
  setConsentLedger(new MemoryConsentLedger());
  conversations = new MemoryConversationStore();
  setConversationStore(conversations);
  privacyDb = new MemoryPrivacyDb();
  installPrivacy();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setRateLimiter(undefined);
  setTurnstileVerifier(undefined);
  setConsentLedger(undefined);
  setConversationStore(undefined);
  setAdvisorModel(undefined);
  setPrivacyServices(undefined);
});

describe("POST /api/qualify with advisor-only handling", () => {
  it("scores a person with no preference on file automatically", async () => {
    const res = await qualify.POST(request("/api/qualify", leadBody, "qualify"));
    expect(res.status).toBe(200);
    expect(jevCalls()).toHaveLength(1);
    const lead = state.inserts.find((i) => i.table === "leads")!.row;
    expect(lead.engine).toBe("rules");
    expect(lead.decision).toHaveProperty("leadUrgencyTier");
    await runAfter();
    expect(state.pushLead.mock.calls[0]![2]).not.toBeNull();
  });

  it("skips Jev and the automated result once the person opts out", async () => {
    await optOut();
    // Email matching is case-insensitive.
    const res = await qualify.POST(request("/api/qualify", { ...leadBody, contact: { ...leadBody.contact, email: "PAT@Example.com" } }, "qualify"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // No remote Jev model call and no automated result.
    expect(jevCalls()).toHaveLength(0);
    expect(body.result).toEqual(humanReviewSummary());
    expect(body.result).toMatchObject({ qualified: false, program: null, indicativeLoan: 0, indicativeRatePct: null });
    expect(body.leadId).toBe(LEAD);

    // Stored for an advisor with no decision.
    const lead = state.inserts.find((i) => i.table === "leads")!.row;
    expect(lead).toMatchObject({ engine: "human_review", decision: {}, rationale: [], latency_ms: 0 });

    // Pushed to the CRM without a decision.
    await runAfter();
    expect(state.pushLead).toHaveBeenCalledTimes(1);
    expect(state.pushLead.mock.calls[0]![2]).toBeNull();
  });

  it("fails closed when the preference lookup errors", async () => {
    const broken = new MemoryPrivacyDb();
    broken.getPreferences = async () => {
      throw new Error("database unavailable");
    };
    installPrivacy(broken);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await qualify.POST(request("/api/qualify", leadBody, "qualify"));
    expect(res.status).toBe(200);
    expect(jevCalls()).toHaveLength(0);
    expect((await res.json()).result.qualified).toBe(false);
  });
});

describe("POST /api/qualify with a hard money intake", () => {
  it("does not flag a low-LTV hard money request without an ARV as an exit shortfall", async () => {
    const body = {
      ...leadBody,
      intake: { assetType: "RESIDENTIAL_2_4", transaction: "HARD_MONEY", loanAmount: 400_000, noi: 0, value: 1_000_000, unitCount: 3, occupancyPct: 0, source: "express" },
    };
    const res = await qualify.POST(request("/api/qualify", body, "qualify"));
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.program).toBeTruthy();
    expect(result.flag).not.toBe("EXIT_SHORTFALL_NEEDS_RESTRUCTURE");
    const lead = state.inserts.find((i) => i.table === "leads")!.row;
    expect(lead.decision).toMatchObject({ assetVertical: "HARD_MONEY_PRIVATE", primaryProgramFit: "HARD_MONEY" });
    expect(lead.decision).not.toMatchObject({ sizingOptimizationFlag: "EXIT_SHORTFALL_NEEDS_RESTRUCTURE" });
    expect(lead.rationale).toEqual(expect.arrayContaining([expect.stringMatching(/sale exit was not tested/)]));
  });
});

describe("POST /api/ask for a conversation tied to an opted-out lead", () => {
  function fakeModel() {
    const calls: unknown[] = [];
    setAdvisorModel({
      stream(params) {
        calls.push(params);
        return {
          async *[Symbol.asyncIterator](): AsyncIterator<BetaRawMessageStreamEvent> {
            yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Sure." } } as BetaRawMessageStreamEvent;
          },
          finalMessage: async () => ({ stop_reason: "end_turn", model: "claude-opus-5-5" }) as BetaMessage,
          abort() {},
        };
      },
    });
    return calls;
  }

  async function startConversation(leadId: string | null) {
    const created = await conversations.create({ ipHash: "h", userAgent: null, page: null });
    conversations.rows.get(created.id)!.leadId = leadId;
    return created.id;
  }

  const message = "My email is pat@example.com and my cell is 415-555-0100. What does HUD 232 need?";

  it("does not send personal information to the model", async () => {
    await optOut();
    const calls = fakeModel();
    const conversationId = await startConversation(LEAD);
    const res = await ask.POST(request("/api/ask", { conversationId, message }, null));
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/can't send that message/);
    expect(calls).toHaveLength(0);
  });

  it("still answers when the lead has no preference on file", async () => {
    const calls = fakeModel();
    const conversationId = await startConversation(LEAD);
    const res = await ask.POST(request("/api/ask", { conversationId, message }, null));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Sure.");
    expect(calls).toHaveLength(1);
  });
});
