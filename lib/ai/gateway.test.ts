import type { BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryTracer } from "@/lib/langfuse";
import { createGateway, GatewayUnavailableError, MODELS, providerModelId, RoutingRefusedError } from "./gateway";
import { AnthropicProvider, buildClaudeParams, supportsServerFallback, type AnthropicLike } from "./gateway/anthropic";
import { FakeModelProvider } from "./gateway/fake";
import { buildChatBody, OpenAICompatibleProvider } from "./gateway/openai-compatible";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const anthropic = new FakeModelProvider("anthropic", { text: "claude says hi" });
  const nvidia = new FakeModelProvider("nvidia", { text: "nim says hi" });
  const xai = new FakeModelProvider("xai", { text: "grok says hi" });
  const tracer = new MemoryTracer();
  let t = 1_000;
  const gateway = createGateway({ providers: { anthropic, nvidia, xai }, tracer, now: () => (t += 25) });
  return { gateway, anthropic, nvidia, xai, tracer };
}

const borrowerEmail = "From: Pat Lee <pat@example.com>\nPhone 415-555-0100\nWe need a bridge loan for our assisted living facility.";

describe("routing guard in the gateway", () => {
  it("refuses restricted data to xAI and never calls the provider", async () => {
    const { gateway, xai } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      gateway.complete({
        model: "grok-4",
        purpose: "market_intel",
        declared: { level: "public" },
        messages: [{ role: "user", content: "Borrower SSN 123-45-6789, account 000123456789. Summarize the market." }],
        maxTokens: 500,
      }),
    ).rejects.toBeInstanceOf(RoutingRefusedError);
    expect(xai.requests).toHaveLength(0);
  });

  it("refuses borrower contact data to xAI even in redact mode", async () => {
    const { gateway, xai } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = await gateway
      .complete({ model: "grok-4", purpose: "market_intel", declared: { categories: ["borrower"] }, messages: [{ role: "user", content: borrowerEmail }], maxTokens: 500, onSensitive: "redact" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RoutingRefusedError);
    expect((err as RoutingRefusedError).decision.reasons).toContain("borrower_data_to_xai");
    expect(xai.requests).toHaveLength(0);
  });

  it("refuses a structured borrower record to xAI", async () => {
    const { gateway, xai } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      gateway.complete({ model: "grok-4", purpose: "market_intel", table: "leads", messages: [{ role: "user", content: JSON.stringify({ contact: { email: "pat@example.com" } }) }], maxTokens: 100 }),
    ).rejects.toBeInstanceOf(RoutingRefusedError);
    expect(xai.requests).toHaveLength(0);
  });

  it("lets public market signals reach xAI", async () => {
    const { gateway, xai } = setup();
    const res = await gateway.complete({
      model: "grok-4",
      purpose: "market_intel",
      declared: { level: "public" },
      messages: [{ role: "user", content: "10-year Treasury moved 12 bps this week; summarize CRE lending sentiment." }],
      maxTokens: 500,
    });
    expect(res.provider).toBe("xai");
    expect(res.text).toBe("grok says hi");
    expect(xai.requests).toHaveLength(1);
  });

  it("refuses restricted data to NVIDIA and to Claude outside document extraction", async () => {
    const { gateway, nvidia, anthropic } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ssn = [{ role: "user" as const, content: "SSN 123-45-6789" }];
    await expect(gateway.complete({ model: "nvidia/llama-3.3-nemotron-super-49b-v1.5", purpose: "document_extraction", messages: ssn, maxTokens: 100 })).rejects.toBeInstanceOf(RoutingRefusedError);
    await expect(gateway.complete({ model: MODELS.claudeBulk, purpose: "classification", messages: ssn, maxTokens: 100 })).rejects.toBeInstanceOf(RoutingRefusedError);
    expect(nvidia.requests).toHaveLength(0);
    expect(anthropic.requests).toHaveLength(0);
    const ok = await gateway.complete({ model: MODELS.claude, purpose: "document_extraction", messages: ssn, maxTokens: 100 });
    expect(ok.provider).toBe("anthropic");
  });

  it("redact mode masks restricted values for Claude classification", async () => {
    const { gateway, anthropic } = setup();
    const res = await gateway.complete({
      model: MODELS.claudeBulk,
      purpose: "classification",
      messages: [{ role: "user", content: "Wire to account 000123456789, SSN 123-45-6789" }],
      maxTokens: 100,
      onSensitive: "redact",
    });
    expect(res.redacted).toBe(true);
    const sent = anthropic.requests[0]!.messages[0]!.content;
    expect(sent).not.toContain("123-45-6789");
    expect(sent).toContain("[REDACTED:");
  });

  it("honors an AI-processing opt-out", async () => {
    const { gateway, anthropic } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      gateway.complete({ model: MODELS.claudeBulk, purpose: "classification", subject: { aiProcessingOptOut: true }, messages: [{ role: "user", content: borrowerEmail }], maxTokens: 100, onSensitive: "redact" }),
    ).rejects.toBeInstanceOf(RoutingRefusedError);
    expect(anthropic.requests).toHaveLength(0);
  });

  it("refuses an unknown model", async () => {
    const { gateway } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(gateway.complete({ model: "gpt-5", purpose: "drafting", messages: [{ role: "user", content: "hi" }], maxTokens: 10 })).rejects.toBeInstanceOf(RoutingRefusedError);
  });
});

describe("gateway behavior", () => {
  it("accepts AI Gateway-style provider/model ids", async () => {
    const { gateway, anthropic, xai } = setup();
    await gateway.complete({ model: "anthropic/claude-haiku-5-5", purpose: "classification", messages: [{ role: "user", content: "hi" }], maxTokens: 10 });
    await gateway.complete({ model: "xai/grok-4", purpose: "market_intel", declared: { level: "public" }, messages: [{ role: "user", content: "rates" }], maxTokens: 10 });
    expect(anthropic.requests[0]!.model).toBe("claude-haiku-5-5");
    expect(xai.requests[0]!.model).toBe("grok-4");
    expect(providerModelId("nvidia/llama-3.3-nemotron-super-49b-v1.5", "nvidia")).toBe("nvidia/llama-3.3-nemotron-super-49b-v1.5");
  });

  it("throws GatewayUnavailableError when the provider has no key", async () => {
    const gateway = createGateway({ providers: { anthropic: new FakeModelProvider("anthropic", {}, false) }, tracer: new MemoryTracer() });
    expect(gateway.available(MODELS.claude)).toBe(false);
    await expect(gateway.complete({ model: MODELS.claude, purpose: "drafting", messages: [{ role: "user", content: "hi" }], maxTokens: 10 })).rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it("parses structured output and flags refusals", async () => {
    const { gateway, anthropic } = setup();
    anthropic.reply({ text: '{"category":"term_sheet"}' }, { text: "", stopReason: "refusal", refusalCategory: "cyber" });
    const schema = { type: "object" as const, properties: { category: { type: "string" } }, required: ["category"], additionalProperties: false as const };
    const a = await gateway.complete({ model: MODELS.claudeBulk, purpose: "classification", messages: [{ role: "user", content: "x" }], maxTokens: 100, jsonSchema: schema });
    expect(a.json).toEqual({ category: "term_sheet" });
    expect(anthropic.requests[0]!.jsonSchema).toEqual(schema);
    const b = await gateway.complete({ model: MODELS.claudeBulk, purpose: "classification", messages: [{ role: "user", content: "x" }], maxTokens: 100, jsonSchema: schema });
    expect(b.refused).toBe(true);
    expect(b.json).toBeUndefined();
  });

  it("traces each call with metadata", async () => {
    const { gateway, tracer } = setup();
    await gateway.complete({ model: MODELS.claudeBulk, purpose: "classification", messages: [{ role: "user", content: "hello" }], maxTokens: 10, trace: { name: "mail.classify", traceId: "run-1" } });
    expect(tracer.traces[0]!.id).toBe("run-1");
    expect(tracer.generations[0]).toMatchObject({ name: "mail.classify", model: MODELS.claudeBulk, provider: "anthropic", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(tracer.flushes).toBe(1);
  });

  it("records failed calls as error generations and rethrows", async () => {
    const { gateway, anthropic, tracer } = setup();
    anthropic.reply(() => {
      throw new Error("boom");
    });
    await expect(gateway.complete({ model: MODELS.claude, purpose: "drafting", messages: [{ role: "user", content: "hi" }], maxTokens: 10 })).rejects.toThrow("boom");
    expect(tracer.generations[0]!.level).toBe("ERROR");
  });
});

describe("Claude request shape", () => {
  it("uses the fallback beta, explicit effort and cached system on Opus", () => {
    const p = buildClaudeParams({ model: MODELS.claude, purpose: "drafting", system: "S", messages: [{ role: "user", content: "hi" }], maxTokens: 2000, effort: "high" });
    expect(p).toMatchObject({ model: "claude-opus-5-5", max_tokens: 2000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "high" } });
    expect(p.system).toEqual([{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
    for (const banned of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) expect(p).not.toHaveProperty(banned);
  });

  it("sends no fallbacks to Haiku and puts the schema in output_config.format", () => {
    const schema = { type: "object" as const, properties: {}, additionalProperties: false as const };
    const p = buildClaudeParams({ model: MODELS.claudeBulk, purpose: "classification", messages: [{ role: "user", content: "x" }], maxTokens: 300, effort: "low", jsonSchema: schema });
    expect(p).not.toHaveProperty("fallbacks");
    expect(p).not.toHaveProperty("betas");
    expect(p.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema } });
    expect(supportsServerFallback(MODELS.claudeMid)).toBe(true);
    expect(supportsServerFallback(MODELS.claudeBulk)).toBe(false);
  });

  it("streams through the SDK seam and maps refusals", async () => {
    const seen: BetaMessageStreamParams[] = [];
    const message = (stop: string, text: string) =>
      ({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: text ? [{ type: "text", text, citations: null }] : [], stop_reason: stop, stop_details: stop === "refusal" ? { type: "refusal", category: "bio", explanation: null } : null, usage: { input_tokens: 12, output_tokens: 3 } }) as unknown as BetaMessage;
    const replies = [message("end_turn", "hello"), message("refusal", "")];
    const client: AnthropicLike = { beta: { messages: { stream: (params) => (seen.push(params), { finalMessage: async () => replies.shift()! }) } } };
    const provider = new AnthropicProvider({ client });
    const ok = await provider.complete({ model: MODELS.claude, purpose: "drafting", messages: [{ role: "user", content: "hi" }], maxTokens: 100 });
    expect(ok).toMatchObject({ text: "hello", stopReason: "end_turn", usage: { inputTokens: 12, outputTokens: 3 } });
    const refused = await provider.complete({ model: MODELS.claude, purpose: "drafting", messages: [{ role: "user", content: "hi" }], maxTokens: 100 });
    expect(refused).toMatchObject({ stopReason: "refusal", refusalCategory: "bio" });
    expect(seen[0]!.output_config).toEqual({ effort: "medium" });
  });
});

describe("OpenAI-compatible providers", () => {
  it("posts chat completions with a bearer key and maps the reply", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ model: "nvidia/x", choices: [{ message: { content: "{\"a\":1}" }, finish_reason: "length" }], usage: { prompt_tokens: 7, completion_tokens: 2 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ provider: "nvidia", baseUrl: "https://nim.test/v1/", apiKey: "k", fetch: fetchImpl });
    const res = await p.complete({ model: "nvidia/x", purpose: "embedding", system: "sys", messages: [{ role: "user", content: "q" }], maxTokens: 50 });
    expect(calls[0]!.url).toBe("https://nim.test/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(String(calls[0]!.init.body)).messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "q" }]);
    expect(res).toMatchObject({ text: '{"a":1}', stopReason: "max_tokens", usage: { inputTokens: 7, outputTokens: 2 } });
  });

  it("marks 429/5xx as retryable and reports unconfigured providers", async () => {
    const fetchImpl = (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ provider: "xai", baseUrl: "https://x.test/v1", apiKey: "k", fetch: fetchImpl });
    await expect(p.complete({ model: "grok-4", purpose: "market_intel", messages: [{ role: "user", content: "q" }], maxTokens: 5 })).rejects.toMatchObject({ status: 429, retryable: true });
    expect(new OpenAICompatibleProvider({ provider: "xai", baseUrl: "https://x.test", apiKey: undefined }).configured()).toBe(false);
  });

  it("requests json_schema output when a schema is given", () => {
    const body = buildChatBody({ model: "grok-4", purpose: "market_intel", messages: [], maxTokens: 5, jsonSchema: { type: "object", properties: {} } });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
  });
});
