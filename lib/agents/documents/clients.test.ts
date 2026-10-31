import type { BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { RoutingRefusedError } from "@/lib/ai/routing";
import { MemoryTracer } from "@/lib/langfuse";
import { AnthropicDocumentClient, buildPdfParams, MAX_PDF_BYTES, PdfTooLargeError } from "./claude-pdf";
import { HttpNemoRetriever, nemoFromEnv, parseNemoResponse } from "./nemo";
import { buildPdf } from "./parse/pdf";

function fakeAnthropic(reply: Partial<BetaMessage>) {
  const calls: BetaMessageStreamParams[] = [];
  return {
    calls,
    client: {
      beta: {
        messages: {
          stream(params: BetaMessageStreamParams) {
            calls.push(params);
            return {
              finalMessage: async () =>
                ({ id: "m", type: "message", role: "assistant", model: params.model, content: [], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 }, ...reply }) as unknown as BetaMessage,
            };
          },
        },
      },
    },
  };
}

const pdf = buildPdf([["Personal Financial Statement"]]);

describe("Claude PDF client", () => {
  it("builds the request the Claude API rules require", () => {
    const p = buildPdfParams({ docType: "RENT_ROLL", pdf }, { model: "claude-opus-5-5", effort: "medium" }) as unknown as Record<string, unknown>;
    expect(p).toMatchObject({ model: "claude-opus-5-5", max_tokens: 64_000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" } } });
    for (const banned of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools"]) expect(p).not.toHaveProperty(banned);
    const messages = p.messages as { role: string; content: { type: string; source?: { type: string; media_type: string; data: string } }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(Buffer.from(messages[0]!.content[0]!.source!.data, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect((p.system as { cache_control: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    // The bulk tier has no server-side fallback.
    expect(buildPdfParams({ docType: "T12", pdf }, { model: "claude-haiku-5-5", effort: "low" })).not.toHaveProperty("fallbacks");
  });

  it("parses structured output and records usage", async () => {
    const f = fakeAnthropic({ content: [{ type: "text", text: JSON.stringify({ netWorth: { value: 100, confidence: 0.9, evidence: "p1" }, warnings: [] }), citations: null }] as never });
    const tracer = new MemoryTracer();
    const c = new AnthropicDocumentClient({ client: f.client, tracer });
    const r = await c.extractPdf({ docType: "PFS", pdf });
    expect(r.result?.scalars.netWorth?.value).toBe(100);
    expect(r.call).toMatchObject({ provider: "anthropic", inputTokens: 100, outputTokens: 20, refused: false });
    expect(f.calls).toHaveLength(1);
    expect(JSON.stringify(tracer.traces)).not.toContain("JVBER"); // the PDF never goes to the tracer
  });

  it("handles refusals and truncation", async () => {
    const refused = new AnthropicDocumentClient({ client: fakeAnthropic({ stop_reason: "refusal" as never }).client, tracer: new MemoryTracer() });
    expect(await refused.extractPdf({ docType: "T12", pdf })).toMatchObject({ result: null, warnings: ["model_refused"] });
    const cut = new AnthropicDocumentClient({ client: fakeAnthropic({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"noi":', citations: null }] as never }).client, tracer: new MemoryTracer() });
    expect((await cut.extractPdf({ docType: "T12", pdf })).warnings).toEqual(["model_output_truncated", "model_output_unparseable"]);
  });

  it("refuses before calling for an opted-out subject, and refuses oversized PDFs", async () => {
    const f = fakeAnthropic({});
    const c = new AnthropicDocumentClient({ client: f.client, tracer: new MemoryTracer() });
    await expect(c.extractPdf({ docType: "PFS", pdf, subject: { aiProcessingOptOut: true } })).rejects.toBeInstanceOf(RoutingRefusedError);
    await expect(c.extractPdf({ docType: "PFS", pdf: new Uint8Array(MAX_PDF_BYTES + 1) })).rejects.toBeInstanceOf(PdfTooLargeError);
    expect(f.calls).toHaveLength(0);
  });

  it("is env-gated", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(new AnthropicDocumentClient().configured()).toBe(false);
    expect(new AnthropicDocumentClient({ apiKey: "k" }).configured()).toBe(true);
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  });
});

describe("NeMo Retriever client", () => {
  it("parses page text and tables", () => {
    const r = parseNemoResponse({ pages: [{ page: 1, text: "Rent roll", tables: [{ rows: [["Unit", "Rent"], ["101", 1500]] }] }, { text: "p2" }] });
    expect(r).toEqual({ text: "Rent roll\np2", pages: 2, tables: [{ name: "page 1 table 1", rows: [["Unit", "Rent"], ["101", 1500]] }] });
  });

  it("posts the document with the key, and never uploads restricted documents", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ pages: [{ text: "ok" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new HttpNemoRetriever({ baseUrl: "https://nemo.test/", apiKey: "secret", fetch: fetchImpl });
    expect((await c.extract({ bytes: pdf, contentType: "application/pdf", fileName: "t12.pdf" }, { level: "confidential" })).text).toBe("ok");
    expect(seen[0]!.url).toBe("https://nemo.test/v1/extract");
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(String(seen[0]!.init.body)).document.content_type).toBe("application/pdf");
    await expect(c.extract({ bytes: pdf, contentType: "application/pdf" }, { level: "restricted" })).rejects.toBeInstanceOf(RoutingRefusedError);
    await expect(c.extract({ bytes: pdf, contentType: "application/pdf" }, { level: "confidential", subject: { aiProcessingOptOut: true } })).rejects.toBeInstanceOf(RoutingRefusedError);
    expect(seen).toHaveLength(1);
  });

  it("is env-gated", async () => {
    expect(nemoFromEnv({}).configured()).toBe(false);
    expect(nemoFromEnv({ NVIDIA_NEMO_RETRIEVER_URL: "https://x" }).configured()).toBe(true);
    await expect(nemoFromEnv({}).extract({ bytes: pdf, contentType: "application/pdf" }, { level: "confidential" })).rejects.toThrow(/not configured/);
  });
});
