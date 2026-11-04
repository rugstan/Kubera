// Document agent (WS-L): parse, classify, extract with per-field confidence,
// review queue. Server wiring lives in ./server (server-only).

export * from "./types";
export { DOC_SPECS, DOC_TYPE_BY_VAULT_KIND, PROMPT_VERSION, specFor, BUDGET_CATEGORIES, type BudgetCategory } from "./specs";
export { parseDocument, detectFormat, textToTable, UnsupportedDocumentError } from "./parse";
export { classifyDocument } from "./classify";
export { extractWithRules, categorizeBudgetLine, bedsBathsFromType } from "./rules";
export { validateExtraction, assessExtraction, type Assessment } from "./validate";
export { mergeExtractions } from "./merge";
export { extractionSchema, systemPrompt, parseModelExtraction } from "./prompt";
export { AnthropicDocumentClient, FakeClaudeDocumentClient, buildPdfParams, type ClaudeDocumentClient, type ModelExtraction } from "./claude-pdf";
export { HttpNemoRetriever, FakeNemoRetriever, nemoFromEnv, type NemoRetrieverClient } from "./nemo";
export { extractFromText } from "./text-model";
export { extractDocument, budgetRecordFrom, DocumentNotReadyError, type ExtractionDeps, type ExtractionInput, type ExtractionOutcome } from "./pipeline";
export { listReviewQueue, correctAndApprove, rejectExtraction, applyCorrections, ReviewError, type Corrections, type ReviewDeps } from "./review";
export * from "./store";
export { documentCleanHandler, documentCleanSchema, DOCUMENT_EVENTS } from "./workflow";
