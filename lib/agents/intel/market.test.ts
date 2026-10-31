import { describe, expect, it } from "vitest";
import { GatewayProviderError, RoutingRefusedError } from "@/lib/ai/gateway";
import { MemoryAutonomyStore, AutonomyPolicy } from "@/lib/agents/core/autonomy";
import { checkModelNote, publicSignalPayload, renderSignalsForModel, rulesDigest, runMarketIntel, MarketIntelError, marketPrompt } from "./market";
import { StaticSignalSource } from "./signals";
import { NOW, intelSetup, testGateway } from "./testing";
import type { PublicSignal } from "./types";

const sources = (extra: { title: string; summary: string; url: string }[] = []) => [
  new StaticSignalSource("rates", { drafts: [{ source: "rates", title: "Rate benchmarks as of 2026-11-04", summary: "10-Yr Treasury 4.25%.", publishedAt: "2026-11-04", key: "rates" }] }),
  new StaticSignalSource("notices", {
    drafts: [
      { source: "federal_register", title: "HUD mortgage insurance notice", summary: "Notice: premium update.", url: "https://www.federalregister.gov/d/1", publishedAt: "2026-11-02" },
      ...extra.map((e) => ({ source: "feed" as const, ...e, publishedAt: "2026-11-03" })),
    ],
  }),
];

function idsOf(provider: ReturnType<typeof testGateway>["xai"]): string[] {
  const content = provider.requests.at(-1)!.messages[0]!.content;
  return [...content.matchAll(/\[((?:rates|federal_register|feed)-[0-9a-f]{12})\]/g)].map((m) => m[1]!);
}

const modelJson = (ids: string[], over: Record<string, unknown> = {}) => ({
  headline: "Rates eased; HUD updated premiums",
  summary: "Benchmarks moved slightly lower this week and HUD published a premium notice.",
  sections: [
    { title: "Rates", bullets: [{ text: "The 10-year Treasury was 4.25% at the latest reading.", signal_ids: [ids[0]!] }] },
    { title: "HUD", bullets: [{ text: "HUD published a notice on mortgage insurance premiums.", signal_ids: [ids[1]!] }] },
  ],
  ...over,
});

describe("runMarketIntel", () => {
  it("writes a cited note from public signals through xAI and queues it for review", async () => {
    const { gateway, xai } = testGateway();
    xai.reply((req) => {
      void req;
      return { text: JSON.stringify(modelJson(idsOf(xai))) };
    });
    // The reply function above runs after the request is recorded, so ids are readable.
    const { store, events } = intelSetup();
    const r = await runMarketIntel({ gateway, sources: sources(), store, events, now: () => NOW, model: "grok-4" }, { actor: "staff:ana@kubera.test" });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.usedModel).toBe(true);
    expect(r.draft).toMatchObject({ status: "pending_review", generatedBy: "model", weekStart: "2026-11-02", version: 1, model: "grok-4", createdBy: "staff:ana@kubera.test" });
    expect(r.draft.sections.flatMap((s) => s.bullets).every((b) => b.signalIds.length > 0)).toBe(true);
    expect(r.draft.promptId).toBe("intel.market_draft");
    expect(r.draft.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.draft.signals.map((s) => s.source).sort()).toEqual(["federal_register", "rates"]);

    // The request went to xAI as market intel with a JSON schema, and the audit trail has the prompt version.
    const sent = xai.requests[0]!;
    expect(sent.model).toBe("grok-4");
    expect(sent.jsonSchema).toBeDefined();
    expect(sent.system).toContain("PUBLIC signals only");
    const ev = events.all().find((e) => e.eventType === "intel.draft_generated")!;
    expect(ev).toMatchObject({ agent: "intel", task: "intel.market_draft", outcome: "recorded", promptId: "intel.market_draft" });
    expect(JSON.stringify(ev.detail)).not.toContain("Treasury");
  });

  it("drops bullets that cite no signal we sent, and bullets that trip the output guardrails", async () => {
    const { gateway, xai } = testGateway();
    xai.reply(() => {
      const ids = idsOf(xai);
      return {
        text: JSON.stringify(
          modelJson(ids, {
            sections: [
              {
                title: "Mixed",
                bullets: [
                  { text: "Supported by a signal.", signal_ids: [ids[0]!] },
                  { text: "Cites a signal that was never sent.", signal_ids: ["feed-000000000000"] },
                  { text: "No citation at all.", signal_ids: [] },
                  { text: "Your loan is approved and the rate is locked.", signal_ids: [ids[1]!] },
                ],
              },
            ],
          }),
        ),
      };
    });
    const { store } = intelSetup();
    const r = await runMarketIntel({ gateway, sources: sources(), store, now: () => NOW, model: "grok-4" }, { actor: "x" });
    if (r.status !== "drafted") throw new Error("expected a draft");
    expect(r.draft.sections[0]!.bullets.map((b) => b.text)).toEqual(["Supported by a signal."]);
    expect(r.draft.guardrailHits.length).toBeGreaterThan(0);
  });

  it("falls back to a rules digest when no xAI key is configured", async () => {
    const { gateway, xai } = testGateway({ xai: false });
    const { store, events } = intelSetup();
    const r = await runMarketIntel({ gateway, sources: sources(), store, events, now: () => NOW, model: "grok-4" }, { actor: "agent:intel" });
    if (r.status !== "drafted") throw new Error("expected a draft");
    expect(r.usedModel).toBe(false);
    expect(r.draft.generatedBy).toBe("rules");
    expect(r.draft.note).toMatch(/No xAI key/);
    expect(r.draft.model).toBeNull();
    expect(xai.requests).toHaveLength(0);
    expect(events.all()[0]!.reasonCodes).toContain("provider_unconfigured");
  });

  it("falls back to the digest on a model refusal, truncation, provider error and invalid output", async () => {
    for (const [reply, code] of [
      [{ text: "", stopReason: "refusal" as const }, "model_refusal"],
      [{ text: "{}", stopReason: "max_tokens" as const }, "model_truncated"],
      [{ text: JSON.stringify({ headline: "x", summary: "y", sections: [] }) }, "model_output_invalid"],
      [{ text: "not json at all" }, "model_output_invalid"],
    ] as const) {
      const { gateway, xai } = testGateway();
      xai.reply(reply);
      const { store, events } = intelSetup();
      const r = await runMarketIntel({ gateway, sources: sources(), store, events, now: () => NOW, model: "grok-4" }, { actor: "x" });
      if (r.status !== "drafted") throw new Error("expected a draft");
      expect(r.draft.generatedBy).toBe("rules");
      expect(events.all()[0]!.reasonCodes).toContain(code);
    }
    const { gateway, xai } = testGateway();
    xai.reply(() => Promise.reject(new GatewayProviderError("xai", 503, "overloaded", true)));
    const { store, events } = intelSetup();
    const failed = await runMarketIntel({ gateway, sources: sources(), store, events, now: () => NOW, model: "grok-4" }, { actor: "x" });
    if (failed.status !== "drafted") throw new Error("expected a draft");
    expect(failed.draft.generatedBy).toBe("rules");
    expect(events.all()[0]!.reasonCodes).toContain("provider_error");

    // An unexpected bug is not swallowed.
    const { gateway: g2, xai: x2 } = testGateway();
    x2.reply(() => Promise.reject(new TypeError("boom")));
    await expect(runMarketIntel({ gateway: g2, sources: sources(), store: intelSetup().store, now: () => NOW, model: "grok-4" }, { actor: "x" })).rejects.toThrow("boom");
  });

  it("never sends personal data to xAI: emails, phone numbers and SSNs in signals and focus are masked first", async () => {
    const { gateway, xai } = testGateway();
    xai.reply(() => ({ text: JSON.stringify(modelJson(idsOf(xai))) }));
    const { store } = intelSetup();
    const dirty = sources([{ title: "Press note", summary: "Contact jane.doe@example.com, 310-555-0199 or SSN 123-45-6789 for details.", url: "https://example.com/n" }]);
    const r = await runMarketIntel({ gateway, sources: dirty, store, now: () => NOW, model: "grok-4" }, { actor: "x", focus: "Call me at 415-555-0101 or bob@example.com about hotels" });
    expect(r.status).toBe("drafted");
    const sent = JSON.stringify(xai.requests[0]);
    expect(sent).not.toMatch(/jane\.doe|bob@|555-01|123-45-6789/);
  });

  it("is blocked by the routing guard when restricted or deal data reaches the payload", async () => {
    const { gateway, xai } = testGateway();
    // A caller-supplied extra field on a signal is caught before the gateway is called.
    const signal = { id: "feed-aaaaaaaaaaaa", source: "feed", title: "t", summary: "s", url: null, publishedAt: null } as PublicSignal;
    expect(() => publicSignalPayload([{ ...signal, borrowerEmail: "a@b.co" } as PublicSignal])).not.toThrow(); // extra keys are dropped by the whitelist
    expect(publicSignalPayload([{ ...signal, borrowerEmail: "a@b.co" } as PublicSignal]).signals[0]).not.toHaveProperty("borrowerEmail");
    expect(() => publicSignalPayload([{ ...signal, summary: "SSN 123-45-6789" }])).toThrow(MarketIntelError);

    // And the gateway itself refuses borrower, deal and restricted data for xAI market intel, without calling the provider.
    await expect(
      gateway.complete({ model: "grok-4", provider: "xai", purpose: "market_intel", messages: [{ role: "user", content: "Borrower Jane Doe, jane@example.com, SSN 123-45-6789, loan $5,000,000" }], maxTokens: 100, declared: { level: "public" } }),
    ).rejects.toBeInstanceOf(RoutingRefusedError);
    await expect(
      gateway.complete({ model: "grok-4", provider: "xai", purpose: "market_intel", messages: [{ role: "user", content: "summarize" }], maxTokens: 100, declared: { level: "confidential", categories: ["deal"] } }),
    ).rejects.toBeInstanceOf(RoutingRefusedError);
    expect(xai.requests).toHaveLength(0);
  });

  it("degrades to the digest, and says why, if the routing guard refuses the payload", async () => {
    const { gateway, xai } = testGateway();
    const { store, events } = intelSetup();
    // Account numbers survive masking when written in a form the detectors do not catch as an account; use a declared floor via focus? Instead, simulate a refusing gateway.
    const refusing = {
      available: () => true,
      complete: async () => {
        throw new RoutingRefusedError({ allowed: false, provider: "xai", level: "confidential", categories: ["borrower"], ceiling: "public", reasons: ["borrower_data_to_xai"], findings: [] }, { model: "grok-4", purpose: "market_intel" });
      },
    };
    const r = await runMarketIntel({ gateway: refusing, sources: sources(), store, events, now: () => NOW, model: "grok-4" }, { actor: "x" });
    if (r.status !== "drafted") throw new Error("expected a draft");
    expect(r.draft.generatedBy).toBe("rules");
    expect(r.draft.note).toMatch(/routing guard refused/);
    expect(events.all()[0]!.reasonCodes).toEqual(expect.arrayContaining(["routing_refused", "routing.borrower_data_to_xai"]));
    expect(xai.requests).toHaveLength(0);
    void gateway;
  });

  it("returns no_signals without writing anything when every source is empty or down", async () => {
    const { gateway } = testGateway();
    const { store } = intelSetup();
    const r = await runMarketIntel({ gateway, sources: [new StaticSignalSource("x", { drafts: [], error: "x: down" })], store, now: () => NOW }, { actor: "x" });
    expect(r).toEqual({ status: "no_signals", errors: ["x: down"] });
    expect(await store.listDrafts()).toEqual([]);
  });

  it("versions a week and supersedes the earlier draft that was still waiting", async () => {
    const { gateway } = testGateway({ xai: false });
    const { store } = intelSetup();
    const deps = { gateway, sources: sources(), store, now: () => NOW, model: "grok-4" };
    const a = await runMarketIntel(deps, { actor: "x" });
    const b = await runMarketIntel(deps, { actor: "x" });
    if (a.status !== "drafted" || b.status !== "drafted") throw new Error("expected drafts");
    expect(b.draft.version).toBe(2);
    expect((await store.getDraft(a.draft.id))!.status).toBe("superseded");
    expect((await store.getDraft(b.draft.id))!.status).toBe("pending_review");
  });

  it("in audit mode proposes the note to the audit trail and stores nothing", async () => {
    const { gateway } = testGateway({ xai: false });
    const { store, events } = intelSetup();
    const autonomy = new AutonomyPolicy(new MemoryAutonomyStore());
    // Default level for this task is assist; a broker lowers it to audit.
    await autonomy.set("intel.market_draft", "audit", { userId: null, label: "Pat Broker", dreLicense: "01234567" }, "shadow week");
    const r = await runMarketIntel({ gateway, sources: sources(), store, events, autonomy, now: () => NOW }, { actor: "x" });
    expect(r).toMatchObject({ status: "audit_only", usedModel: false });
    expect(await store.listDrafts()).toEqual([]);
    expect(events.all()[0]).toMatchObject({ outcome: "proposed", autonomy: "audit" });
  });

  it("runs under the default assist level with the real autonomy policy", async () => {
    const { gateway } = testGateway({ xai: false });
    const { store } = intelSetup();
    const autonomy = new AutonomyPolicy(new MemoryAutonomyStore());
    const r = await runMarketIntel({ gateway, sources: sources(), store, autonomy, now: () => NOW }, { actor: "x" });
    expect(r.status).toBe("drafted");
  });
});

describe("checkModelNote", () => {
  const ids = new Set(["rates-aaaaaaaaaaaa"]);
  it("rejects output that does not match the schema", () => {
    expect(checkModelNote({ headline: 1 }, ids, "fallback")).toBeNull();
    expect(checkModelNote(undefined, ids, "fallback")).toBeNull();
  });
  it("replaces a headline that trips a guardrail", () => {
    const n = checkModelNote({ headline: "Your loan is approved today", summary: "Rates moved.", sections: [{ title: "Rates", bullets: [{ text: "Ten-year at 4.25%.", signal_ids: ["rates-aaaaaaaaaaaa"] }] }] }, ids, "Market intel: week of 2026-11-02");
    expect(n?.headline).toBe("Market intel: week of 2026-11-02");
    expect(n?.guardrailHits.length).toBeGreaterThan(0);
  });
});

describe("rules digest and prompt", () => {
  it("groups signals by source and keeps every bullet cited", () => {
    const signals: PublicSignal[] = [
      { id: "rates-1", source: "rates", title: "Rates", summary: "4.25%", url: null, publishedAt: "2026-11-04" },
      { id: "federal_register-1", source: "federal_register", title: "Notice", summary: "", url: null, publishedAt: "2026-11-02" },
    ];
    const d = rulesDigest(signals, "2026-11-02");
    expect(d.headline).toBe("Market intel: week of 2026-11-02");
    expect(d.sections.map((s) => s.title)).toEqual(["Rates", "HUD and SBA notices"]);
    expect(d.sections.flatMap((s) => s.bullets).every((b) => b.signalIds.length === 1)).toBe(true);
  });

  it("isolates signals as untrusted data and names the week", () => {
    const text = renderSignalsForModel([{ id: "feed-1", source: "feed", title: "<b>x</b>", summary: "s", url: null, publishedAt: null }], "2026-11-02", "hotel debt");
    expect(text).toMatch(/<untrusted_[0-9a-f]+ source="web"/);
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(text).toContain("week starting 2026-11-02");
    expect(text).toContain("hotel debt");
  });

  it("registers an immutable prompt (or reports it unregistered) with a stable hash", () => {
    const a = marketPrompt("grok-4");
    const b = marketPrompt("grok-4");
    expect(a.sha256).toBe(b.sha256);
    expect(a).toMatchObject({ id: "intel.market_draft", version: "1.0.0" });
    expect(a.system).not.toMatch(/temperature|prefill/i);
  });
});
