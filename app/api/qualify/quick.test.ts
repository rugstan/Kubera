// Route tests for the short request form on every /financing page. It posts to
// POST /api/qualify with `kind: "quick"` and must take the qualifier's own path:
// the guard, a leads row, a consent row only when the box is ticked, and the
// Twenty push after the response, carrying the page the lead came from.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; patch: Record<string, unknown> }[],
  afterCallbacks: [] as (() => Promise<void> | void)[],
  pushLead: vi.fn(async (..._args: unknown[]) => ({ personId: "person-1", opportunityId: "opp-1" })),
}));

const LEAD = "0d6f2a6e-5c1b-4b8e-9d2f-6f1a2b3c4d5e";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const db = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        state.inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: LEAD }, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => {
        state.updates.push({ table, patch });
        return { eq: async () => ({ error: null }) };
      },
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
const { CONSENT_TEXTS, CURRENT_CONSENT } = await import("@/lib/consent/texts");
const { humanReviewSummary } = await import("@/lib/ai/jev");
const { MemoryPrivacyDb } = await import("@/lib/privacy/fake");
const { MemoryObjectStorage } = await import("@/lib/privacy/storage");
const { setPrivacyServices } = await import("@/lib/privacy/server");
const { intakeSchema } = await import("@/lib/validation");

const qualify = await import("./route");

const ORIGIN = "https://corincommercial.com";
let turnstile: InstanceType<typeof FakeTurnstileVerifier>;
let ledger: InstanceType<typeof MemoryConsentLedger>;
let ip = 0;
let token = 0;

const quickBody = (over: { quick?: Record<string, unknown>; contact?: Record<string, unknown> } = {}) => ({
  kind: "quick",
  quick: { assetType: "OFFICE", transaction: "PURCHASE", loanAmount: 4_500_000, timelineDays: 90, notes: "Two-story building, 80% leased.", slug: "office-loans", ...over.quick },
  contact: { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "415-555-0100", company: "Lee Holdings", consent: true, ...over.contact },
  consentMeta: { textVersion: CURRENT_CONSENT.qualifier, page: "/financing/office-loans" },
});

function request(body: unknown, opts: { turnstile?: boolean; origin?: string } = {}) {
  return new Request(`${ORIGIN}/api/qualify`, {
    method: "POST",
    headers: {
      origin: opts.origin ?? ORIGIN,
      "content-type": "application/json",
      "user-agent": "vitest",
      "x-forwarded-for": `198.51.100.${++ip % 250}`,
      ...(opts.turnstile === false ? {} : { "x-turnstile-token": turnstile.issue(`q${++token}`, "qualify") }),
    },
    body: JSON.stringify(body),
  });
}

const runAfter = async () => {
  for (const fn of state.afterCallbacks.splice(0)) await fn();
};
const leadRow = () => state.inserts.find((i) => i.table === "leads")?.row;

beforeEach(() => {
  state.inserts.length = 0;
  state.updates.length = 0;
  state.afterCallbacks.length = 0;
  state.pushLead.mockClear();
  vi.stubEnv("JEV_API_URL", "");
  vi.stubEnv("LEAD_TOKEN_SECRET", "test-secret-test-secret");
  setRateLimiter(new MemoryRateLimiter());
  turnstile = new FakeTurnstileVerifier();
  setTurnstileVerifier(turnstile);
  ledger = new MemoryConsentLedger();
  setConsentLedger(ledger);
  const privacyDb = new MemoryPrivacyDb();
  setPrivacyServices({
    requests: privacyDb,
    subjects: privacyDb,
    retention: privacyDb,
    storage: new MemoryObjectStorage(),
    legalHolds: privacyDb,
    verifyLeadToken: () => false,
    leadEmail: async () => null,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setRateLimiter(undefined);
  setTurnstileVerifier(undefined);
  setConsentLedger(undefined);
  setPrivacyServices(undefined);
});

describe("POST /api/qualify with the financing-page form (kind: quick)", () => {
  it("stores the lead with its source page, marked for broker review", async () => {
    const res = await qualify.POST(request(quickBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leadId).toBe(LEAD);
    // No automated result and no upload token: an advisor reviews every financing-page lead.
    expect(body.result).toEqual(humanReviewSummary());
    expect(body.uploadToken).toBeNull();

    const row = leadRow()!;
    expect(row.source).toBe("financing_page");
    expect(row.engine).toBe("rules");
    expect(row.decision).toMatchObject({ sizingOptimizationFlag: "NEEDS_BROKER_REVIEW", leadUrgencyTier: "TIER_3_NURTURE", assetVertical: "GENERAL_CRE_OR_CONSTRUCTION" });
    expect(row.rationale).toEqual(expect.arrayContaining([expect.stringMatching(/^Broker review: short form on \/financing\/office-loans \(Office building loans\)/)]));
    expect(row.intake).toMatchObject({
      assetType: "OFFICE",
      transaction: "PURCHASE",
      loanAmount: 4_500_000,
      noi: 0,
      timelineDays: 90,
      notes: "Two-story building, 80% leased.",
      source: "financing_page",
      origin: { form: "financing_page", slug: "office-loans", path: "/financing/office-loans", page: "Office building loans", transaction: "PURCHASE" },
    });
    // The stored intake is one the crm-retry cron can parse again.
    expect(intakeSchema.safeParse(row.intake).success).toBe(true);
    expect(row.contact).toMatchObject({ firstName: "Pat", lastName: "Lee", email: "pat@example.com", company: "Lee Holdings", consent: true });
  });

  it("writes a consent row with the qualifier's wording and the page when the box is ticked", async () => {
    await qualify.POST(request(quickBody()));
    expect(ledger.events).toHaveLength(1);
    const event = ledger.events[0]!;
    expect(event).toMatchObject({ form: "qualifier", textVersion: CURRENT_CONSENT.qualifier, email: "pat@example.com", page: "/financing/office-loans", leadId: LEAD });
    expect(event.channels).toEqual(CONSENT_TEXTS[CURRENT_CONSENT.qualifier].channels);
  });

  it("writes no consent row when the box is not ticked", async () => {
    const res = await qualify.POST(request(quickBody({ contact: { consent: false, phone: "" } })));
    expect(res.status).toBe(200);
    expect(ledger.events).toHaveLength(0);
    expect(leadRow()!.contact).toMatchObject({ consent: false });
  });

  it("pushes the lead to Twenty after the response, with the source page on the intake", async () => {
    await qualify.POST(request(quickBody()));
    expect(state.pushLead).not.toHaveBeenCalled();
    await runAfter();
    expect(state.pushLead).toHaveBeenCalledTimes(1);
    const [intake, contact, jev, opts] = state.pushLead.mock.calls[0]! as [Record<string, unknown>, Record<string, unknown>, { decision: Record<string, unknown> }, { consentEventId: string | null }];
    expect(intake).toMatchObject({ assetType: "OFFICE", origin: { path: "/financing/office-loans", page: "Office building loans" } });
    expect(contact).toMatchObject({ email: "pat@example.com" });
    expect(jev.decision).toMatchObject({ sizingOptimizationFlag: "NEEDS_BROKER_REVIEW" });
    expect(opts.consentEventId).toBe(ledger.events[0]!.id);
    // The Twenty ids are saved on the lead row; the crm-retry cron is the backstop on failure.
    expect(state.updates).toEqual(expect.arrayContaining([{ table: "leads", patch: { twenty_person_id: "person-1", twenty_opportunity_id: "opp-1" } }]));
  });

  it("records a failed push on the lead for the crm-retry cron", async () => {
    state.pushLead.mockRejectedValueOnce(new Error("Twenty POST /opportunities: 503"));
    await qualify.POST(request(quickBody()));
    await runAfter();
    expect(state.updates).toEqual(expect.arrayContaining([{ table: "leads", patch: { crm_error: "Twenty POST /opportunities: 503" } }]));
  });

  it("keeps the visitor's 'Other' answer on the origin and sizes it as a refinance", async () => {
    await qualify.POST(request(quickBody({ quick: { transaction: "OTHER", assetType: "SELF_STORAGE", slug: "self-storage-loans" } })));
    expect(leadRow()!.intake).toMatchObject({ assetType: "SELF_STORAGE", transaction: "REFINANCE", origin: { transaction: "OTHER", path: "/financing/self-storage-loans" } });
  });

  it("works from a hub and from an existing program page", async () => {
    for (const [slug, assetType, page] of [
      ["commercial", "RETAIL", "Commercial property financing"],
      ["hud-223f-multifamily", "MULTIFAMILY", "HUD 223(f) multifamily"],
    ] as const) {
      state.inserts.length = 0;
      const res = await qualify.POST(request(quickBody({ quick: { slug, assetType } })));
      expect(res.status, slug).toBe(200);
      expect(leadRow()!.intake, slug).toMatchObject({ origin: { slug, path: `/financing/${slug}`, page } });
    }
  });

  it("rejects an unknown page, a missing field and a bad property type with field paths", async () => {
    const unknown = await qualify.POST(request(quickBody({ quick: { slug: "not-a-page" } })));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).issues).toEqual([{ path: "quick.slug", message: "Unknown financing page" }]);

    const small = await qualify.POST(request(quickBody({ quick: { loanAmount: 100_000 } })));
    expect(small.status).toBe(400);
    expect((await small.json()).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "quick.loanAmount" })]));

    const asset = await qualify.POST(request(quickBody({ quick: { assetType: "CASINO" } })));
    expect(asset.status).toBe(400);
    expect((await asset.json()).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "quick.assetType" })]));

    const email = await qualify.POST(request(quickBody({ contact: { email: "nope" } })));
    expect((await email.json()).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "contact.email" })]));
    expect(state.inserts).toHaveLength(0);
  });

  it("runs the same guard as the qualifier: a foreign origin is refused before anything is stored", async () => {
    const res = await qualify.POST(request(quickBody(), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(state.inserts).toHaveLength(0);
  });

  it("still accepts the qualifier's full intake, with or without kind: full", async () => {
    const full = {
      intake: { assetType: "OFFICE", transaction: "REFINANCE", loanAmount: 3_000_000, noi: 420_000, value: 5_000_000, source: "express" },
      contact: { firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "", company: "", consent: false },
    };
    for (const body of [full, { ...full, kind: "full" }]) {
      state.inserts.length = 0;
      const res = await qualify.POST(request(body));
      expect(res.status).toBe(200);
      const row = leadRow()!;
      expect(row.source).toBe("express");
      expect(row.intake).not.toHaveProperty("origin");
      expect(row.decision).not.toMatchObject({ sizingOptimizationFlag: "NEEDS_BROKER_REVIEW" });
    }
    const bad = await qualify.POST(request({ ...full, kind: "short" }));
    expect(bad.status).toBe(400);
  });
});
