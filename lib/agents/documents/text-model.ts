// Structured extraction from document text through the model gateway (Claude
// by default; an NVIDIA model when DOCUMENT_TEXT_MODEL names one and the
// routing guard allows the document's classification).

import { MODELS, type Effort, type ModelGateway } from "@/lib/ai/gateway";
import type { ModelCall, ModelExtraction } from "./claude-pdf";
import { maxTokensFor } from "./claude-pdf";
import { extractionSchema, parseModelExtraction, systemPrompt, textUserTurn } from "./prompt";
import { specFor } from "./specs";
import type { DocType, SourceFormat } from "./types";

/** Longer text goes to Claude as a PDF (when it is one) rather than being cut. */
export const MAX_TEXT_CHARS = 600_000;

export class TextTooLongError extends Error {
  constructor(chars: number) {
    super(`document text is ${chars} characters; the text path takes at most ${MAX_TEXT_CHARS}`);
    this.name = "TextTooLongError";
  }
}

export type TextExtractionRequest = {
  docType: DocType;
  text: string;
  format: SourceFormat;
  fileName?: string;
  model?: string;
  effort?: Effort;
  subject?: { aiProcessingOptOut?: boolean };
  traceId?: string;
};

export async function extractFromText(gateway: ModelGateway, req: TextExtractionRequest): Promise<ModelExtraction> {
  if (req.text.length > MAX_TEXT_CHARS) throw new TextTooLongError(req.text.length);
  const spec = specFor(req.docType);
  const model = req.model ?? MODELS.claude;
  const res = await gateway.complete({
    model,
    purpose: "document_extraction",
    system: systemPrompt(req.docType),
    messages: [{ role: "user", content: textUserTurn(req.text, { format: req.format, ...(req.fileName ? { fileName: req.fileName } : {}) }) }],
    maxTokens: maxTokensFor(req.docType),
    effort: req.effort ?? "medium",
    jsonSchema: extractionSchema(req.docType),
    declared: { level: spec.classification, categories: ["borrower", "deal"] },
    ...(req.subject ? { subject: req.subject } : {}),
    onSensitive: "refuse",
    trace: { name: "documents.extract_text", ...(req.traceId ? { traceId: req.traceId } : {}), metadata: { docType: req.docType, format: req.format } },
  });
  const call: ModelCall = {
    provider: res.provider,
    model: res.requestedModel,
    servedModel: res.servedModel,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    stopReason: res.stopReason,
    latencyMs: res.latencyMs,
    refused: res.refused,
  };
  if (res.refused) return { result: null, call, warnings: ["model_refused"] };
  const warnings = res.stopReason === "max_tokens" ? ["model_output_truncated"] : [];
  if (res.json === undefined) return { result: null, call, warnings: [...warnings, "model_output_unparseable"] };
  return { result: parseModelExtraction(req.docType, res.json), call, warnings };
}
