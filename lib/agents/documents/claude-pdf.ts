// Claude over the PDF itself (document content block), for scans and PDFs
// whose text layer cannot be read. The gateway carries text-only messages, so
// this client builds the same request shape the gateway's Claude provider
// builds (beta stream + finalMessage, server-side refusal fallback, explicit
// effort, structured output via output_config.format) with a base64 document
// block in the user turn. The routing guard runs first: the PDF is treated as
// restricted borrower data, which only Claude may receive and only for
// document extraction. Lazy SDK construction; env-gated on ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MODELS, type Effort } from "@/lib/ai/gateway";
import { CLAUDE_FALLBACK_BETA, claudeResult, supportsServerFallback, type AnthropicLike } from "@/lib/ai/gateway/anthropic";
import { assertRoutable } from "@/lib/ai/routing";
import { getTracer, type Tracer } from "@/lib/langfuse";
import { extractionPrompt, extractionSchema, parseModelExtraction, PDF_USER_INSTRUCTION } from "./prompt";
import { specFor } from "./specs";
import type { DocType, ExtractionResult } from "./types";

/** Base64 inflates by 4/3; the request limit is 32 MB. */
export const MAX_PDF_BYTES = 22 * 1024 * 1024;

export type ModelCall = {
  provider: string;
  model: string;
  servedModel: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  latencyMs: number;
  refused: boolean;
};

export type ModelExtraction = { result: ExtractionResult | null; call: ModelCall; warnings: string[] };

export type PdfExtractionRequest = {
  docType: DocType;
  pdf: Uint8Array;
  fileName?: string;
  subject?: { aiProcessingOptOut?: boolean };
  traceId?: string;
  signal?: AbortSignal;
};

export interface ClaudeDocumentClient {
  configured(): boolean;
  extractPdf(req: PdfExtractionRequest): Promise<ModelExtraction>;
}

export class PdfTooLargeError extends Error {
  constructor(bytes: number) {
    super(`PDF is ${Math.round(bytes / 1024 / 1024)} MB; the model limit is ${MAX_PDF_BYTES / 1024 / 1024} MB. Split it or upload the spreadsheet.`);
    this.name = "PdfTooLargeError";
  }
}

export function maxTokensFor(docType: DocType): number {
  return specFor(docType).rows ? 64_000 : 8_000;
}

/** Pure request builder, so tests can pin exactly what is sent. */
export function buildPdfParams(req: PdfExtractionRequest, opts: { model: string; effort: Effort }): BetaMessageStreamParams {
  const fallback = supportsServerFallback(opts.model);
  return {
    model: opts.model,
    max_tokens: maxTokensFor(req.docType),
    ...(fallback ? { betas: [CLAUDE_FALLBACK_BETA], fallbacks: "default" as const } : {}),
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: extractionSchema(req.docType) } },
    system: [{ type: "text", text: extractionPrompt(req.docType).system, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(req.pdf).toString("base64") } },
          { type: "text", text: PDF_USER_INSTRUCTION },
        ],
      },
    ],
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return undefined;
  }
}

export class AnthropicDocumentClient implements ClaudeDocumentClient {
  private client: AnthropicLike | undefined;

  constructor(
    private readonly opts: { client?: AnthropicLike; apiKey?: string; model?: string; effort?: Effort; tracer?: Tracer; now?: () => number } = {},
  ) {
    this.client = opts.client;
  }

  configured(): boolean {
    return Boolean(this.opts.client || this.opts.apiKey || process.env.ANTHROPIC_API_KEY);
  }

  private sdk(): AnthropicLike {
    this.client ??= new Anthropic(this.opts.apiKey ? { apiKey: this.opts.apiKey } : {});
    return this.client;
  }

  async extractPdf(req: PdfExtractionRequest): Promise<ModelExtraction> {
    if (req.pdf.byteLength > MAX_PDF_BYTES) throw new PdfTooLargeError(req.pdf.byteLength);
    const model = this.opts.model ?? MODELS.claude;
    const effort = this.opts.effort ?? "medium";
    const system = extractionPrompt(req.docType).system;
    // Routing guard before a byte leaves: the raw file is restricted borrower data.
    assertRoutable({
      model,
      provider: "anthropic",
      purpose: "document_extraction",
      payload: { system, instruction: PDF_USER_INSTRUCTION, document: { docType: req.docType, fileName: req.fileName ?? null } },
      declared: { level: "restricted", categories: ["borrower", "deal"] },
      table: "documents",
      ...(req.subject ? { subject: req.subject } : {}),
    });
    const now = this.opts.now ?? (() => Date.now());
    const tracer = this.opts.tracer ?? getTracer();
    const trace = tracer.trace({ ...(req.traceId ? { id: req.traceId } : {}), name: "documents.extract_pdf", tags: ["anthropic", "document_extraction"], metadata: { docType: req.docType } });
    const started = now();
    try {
      const stream = this.sdk().beta.messages.stream(buildPdfParams(req, { model, effort }), req.signal ? { signal: req.signal } : undefined);
      const res = claudeResult(await stream.finalMessage());
      const latencyMs = now() - started;
      const refused = res.stopReason === "refusal";
      trace.generation({
        name: "documents.extract_pdf",
        model: res.servedModel,
        provider: "anthropic",
        startTime: new Date(started),
        endTime: new Date(started + latencyMs),
        usage: res.usage,
        level: refused ? "WARNING" : "DEFAULT",
        metadata: { stopReason: res.stopReason, docType: req.docType },
      });
      trace.end({ metadata: { stopReason: res.stopReason } });
      const call: ModelCall = {
        provider: "anthropic",
        model,
        servedModel: res.servedModel,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        stopReason: res.stopReason,
        latencyMs,
        refused,
      };
      if (refused) return { result: null, call, warnings: ["model_refused"] };
      const json = parseJson(res.text);
      const warnings = res.stopReason === "max_tokens" ? ["model_output_truncated"] : [];
      if (json === undefined) return { result: null, call, warnings: [...warnings, "model_output_unparseable"] };
      return { result: parseModelExtraction(req.docType, json), call, warnings };
    } catch (err) {
      trace.end({ level: "ERROR" });
      throw err;
    } finally {
      await tracer.flush();
    }
  }
}

/** Test double: answers from a function, records requests. */
export class FakeClaudeDocumentClient implements ClaudeDocumentClient {
  readonly requests: PdfExtractionRequest[] = [];
  constructor(
    private readonly answer: (req: PdfExtractionRequest) => unknown | Promise<unknown>,
    private readonly isConfigured = true,
  ) {}
  configured() {
    return this.isConfigured;
  }
  async extractPdf(req: PdfExtractionRequest): Promise<ModelExtraction> {
    this.requests.push(req);
    const json = await this.answer(req);
    const call: ModelCall = { provider: "anthropic", model: MODELS.claude, servedModel: MODELS.claude, inputTokens: 1000, outputTokens: 200, stopReason: json === "refusal" ? "refusal" : "end_turn", latencyMs: 5, refused: json === "refusal" };
    if (json === "refusal") return { result: null, call, warnings: ["model_refused"] };
    return { result: parseModelExtraction(req.docType, json), call, warnings: [] };
  }
}
