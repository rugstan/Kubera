// The document agent: one call turns a clean vault document (or a mail
// attachment) into a stored, typed extraction.
//
//   1. load bytes (vault: only `clean` documents, read audited)
//   2. parse (magic bytes decide the parser) and classify when the type is unknown
//   3. PDF with no readable text layer -> NeMo Retriever when configured and the
//      routing guard allows it (never for PFS or unknown types)
//   4. rules over the tables; if anything is missing or unsure, a model:
//        text available -> gateway (Claude by default)
//        PDF otherwise  -> Claude with the PDF as a document block
//   5. merge, cross-check, assess; low confidence -> needs_review (the queue)
//   6. supersede the previous live extraction, store, audit, budget row
//
// Nothing here writes outside Kubera: no email, CRM or lender action, so the
// approval gate is not involved. A subject who opted out of AI processing gets
// rules-only extraction (and review).

import { createHash } from "node:crypto";
import type { AgentEventStore } from "@/lib/agents/core/events";
import { guardInbound, recordInjection, type InboundGuard } from "@/lib/agents/core/inbound";
import { GatewayProviderError, GatewayUnavailableError, MODELS, type Effort, type ModelGateway } from "@/lib/ai/gateway";
import { providerForModel, RoutingRefusedError } from "@/lib/ai/routing";
import type { DocumentEventLog, DocumentStore } from "@/lib/documents/store";
import type { VaultStorage } from "@/lib/documents/storage";
import { VAULT_BUCKET } from "@/lib/documents/types";
import type { AgentRunStore, ModelCallRecord } from "@/lib/workflows/runs";
import { PdfTooLargeError, type ClaudeDocumentClient, type ModelCall, type ModelExtraction } from "./claude-pdf";
import { classifyDocument } from "./classify";
import { mergeExtractions } from "./merge";
import type { NemoRetrieverClient } from "./nemo";
import { parseDocument, UnsupportedDocumentError } from "./parse";
import { extractionPromptRef } from "./prompt";
import { extractWithRules } from "./rules";
import { DOC_TYPE_BY_VAULT_KIND, PROMPT_VERSION, specFor } from "./specs";
import { isRestrictedExtraction, RestrictedExtractionError, type ConstructionBudgetRecord, type ConstructionBudgetStore, type ExtractionEventLog, type ExtractionRecord, type ExtractionStore, type NewExtraction } from "./store";
import { extractFromText, TextTooLongError } from "./text-model";
import { systemClock, type Clock, type DocType, type ExtractionResult, type ParsedSource, type SourceFormat } from "./types";
import { assessExtraction, validateExtraction, type Assessment } from "./validate";
import { round } from "./values";

export const AGENT_ACTOR = "document-agent";
/** Largest file the agent reads (matches the vault limit). */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
/** Below this, the PDF text layer is not trusted for extraction. */
export const MIN_TEXT_QUALITY = 0.5;
/** Below this classifier confidence, the type is not guessed. */
export const MIN_CLASSIFIER_CONFIDENCE = 0.6;

export type ExtractionConfig = { textModel?: string; effort?: Effort; minTextQuality?: number };

export function extractionConfigFromEnv(env: Record<string, string | undefined> = process.env): ExtractionConfig {
  const effort = env.DOCUMENT_EXTRACTION_EFFORT?.trim();
  return {
    textModel: env.DOCUMENT_TEXT_MODEL?.trim() || MODELS.claude,
    ...(effort && ["low", "medium", "high", "xhigh", "max"].includes(effort) ? { effort: effort as Effort } : {}),
  };
}

export type ExtractionDeps = {
  store: ExtractionStore;
  events: ExtractionEventLog;
  budgets?: ConstructionBudgetStore;
  gateway?: ModelGateway;
  claude?: ClaudeDocumentClient;
  nemo?: NemoRetrieverClient;
  vault?: { documents: DocumentStore; storage: VaultStorage; events?: DocumentEventLog };
  /** Has the data subject (lead) opted out of AI processing (privacy_preferences)? */
  aiOptOut?: (leadId: string | null) => Promise<boolean>;
  runs?: AgentRunStore;
  /** agent_events (lib/agents/core): injection findings in document text are recorded here. */
  agentEvents?: Pick<AgentEventStore, "append"> | null;
  clock?: Clock;
  config?: ExtractionConfig;
};

/** Agent id and version stamped on the extraction agent's core events. */
export const DOCUMENTS_AGENT = { id: "documents", version: "1.1.0", task: "document_extraction" } as const;
/** Warning on an extraction whose document text tried to instruct the model (always reviewed). */
export const INJECTION_WARNING = "injection_suspected";

type Common = { docType?: DocType; dealId?: string | null; actor?: string };
export type ExtractionInput =
  | (Common & { source: "vault_document"; documentId: string })
  | (Common & { source: "mail_attachment"; mailMessageId: string; attachmentName: string; bytes: Uint8Array; contentType: string; leadId?: string | null })
  | (Common & { source: "manual"; bytes: Uint8Array; contentType: string; fileName: string; leadId?: string | null });

export type ExtractionOutcome = {
  extraction: ExtractionRecord;
  result: ExtractionResult | null;
  assessment: Assessment | null;
  modelCalls: ModelCall[];
};

export class DocumentNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentNotReadyError";
  }
}

type Loaded = { bytes: Uint8Array; contentType: string; fileName: string; leadId: string | null; vaultKind: string | null; pip: boolean };

async function load(deps: ExtractionDeps, input: ExtractionInput): Promise<Loaded> {
  if (input.source !== "vault_document") {
    if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new DocumentNotReadyError("document is larger than the extraction limit");
    return {
      bytes: input.bytes,
      contentType: input.contentType,
      fileName: input.source === "manual" ? input.fileName : input.attachmentName,
      leadId: input.leadId ?? null,
      vaultKind: null,
      pip: false,
    };
  }
  if (!deps.vault) throw new DocumentNotReadyError("vault access is not configured");
  const doc = await deps.vault.documents.get(input.documentId);
  if (!doc) throw new DocumentNotReadyError(`document ${input.documentId} not found`);
  // Only scanned-clean documents in the vault bucket are ever read.
  if (doc.status !== "clean" || doc.bucket !== VAULT_BUCKET) throw new DocumentNotReadyError(`document ${doc.id} is ${doc.status}; only clean documents are extracted`);
  const bytes = await deps.vault.storage.read(VAULT_BUCKET, doc.storage_path, MAX_DOCUMENT_BYTES);
  if (!bytes) throw new DocumentNotReadyError(`document ${doc.id} has no stored object`);
  await deps.vault.events
    ?.record({ event: "download", document_id: doc.id, lead_id: doc.lead_id, actor: input.actor ?? AGENT_ACTOR, detail: { purpose: "extraction" } })
    .catch((err: unknown) => console.error("[documents-agent] could not audit the read:", err instanceof Error ? err.message : err));
  return { bytes, contentType: doc.content_type, fileName: doc.file_name, leadId: doc.lead_id, vaultKind: doc.kind, pip: doc.kind === "PIP_BUDGET" };
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function toRunCall(c: ModelCall): ModelCallRecord {
  return { ...c, purpose: "document_extraction", redacted: false };
}

const RETRYABLE = (err: unknown) => err instanceof GatewayProviderError && err.retryable;

function emptyResult(docType: DocType): ExtractionResult {
  return { docType, scalars: {}, rows: [], warnings: [] };
}

export function budgetRecordFrom(rec: ExtractionRecord, kind: ConstructionBudgetRecord["budget_kind"]): ConstructionBudgetRecord {
  const s = rec.fields.scalars;
  const n = (k: string) => (typeof s[k]?.value === "number" ? (s[k]!.value as number) : null);
  const hard = n("hardCosts");
  const contingency = n("contingency");
  return {
    extraction_id: rec.id,
    deal_id: rec.deal_id,
    lead_id: rec.lead_id,
    budget_kind: kind,
    status: rec.status === "approved" ? "approved" : rec.status === "needs_review" ? "needs_review" : rec.status === "rejected" ? "rejected" : rec.status === "superseded" ? "superseded" : "extracted",
    land_cost: n("landCost"),
    hard_costs: hard,
    soft_costs: n("softCosts"),
    contingency,
    developer_fee: n("developerFee"),
    financing_costs: n("financingCosts"),
    total_cost: n("totalCost"),
    contingency_pct_of_hard: hard && contingency !== null ? round(contingency / hard, 4) : null,
    gmp_contract: typeof s.gmpContract?.value === "boolean" ? (s.gmpContract.value as boolean) : null,
    line_items: rec.fields.rows
      .filter((r) => typeof r.values.amount === "number")
      .map((r) => ({
        description: String(r.values.description ?? ""),
        category: (r.values.category as ConstructionBudgetRecord["line_items"][number]["category"]) ?? "hard",
        amount: r.values.amount as number,
        confidence: r.confidence,
      })),
  };
}

export async function extractDocument(deps: ExtractionDeps, input: ExtractionInput): Promise<ExtractionOutcome> {
  const clock = deps.clock ?? systemClock;
  const actor = input.actor ?? AGENT_ACTOR;
  const cfg = { minTextQuality: MIN_TEXT_QUALITY, ...deps.config, textModel: deps.config?.textModel || MODELS.claude };
  const runId = await deps.runs
    ?.start(
      {
        workflow: "document-extraction",
        subjectType: input.source,
        subjectId: input.source === "vault_document" ? input.documentId : input.source === "mail_attachment" ? `${input.mailMessageId}:${input.attachmentName}` : input.fileName,
        dealId: input.dealId ?? null,
      },
      clock(),
    )
    .catch(() => undefined);

  const loaded = await load(deps, input);
  const optOut = (await deps.aiOptOut?.(loaded.leadId)) ?? false;
  const subject = optOut ? { aiProcessingOptOut: true } : undefined;
  const base = {
    source_type: input.source,
    document_id: input.source === "vault_document" ? input.documentId : null,
    mail_message_id: input.source === "mail_attachment" ? input.mailMessageId : null,
    attachment_name: input.source === "mail_attachment" ? input.attachmentName.slice(0, 300) : null,
    lead_id: loaded.leadId,
    deal_id: input.dealId ?? null,
    source_sha256: sha256(loaded.bytes),
  } satisfies Partial<NewExtraction>;

  const failRecord = async (format: SourceFormat, docType: DocType | null, error: string, warnings: string[] = []): Promise<ExtractionOutcome> => {
    const rec = await deps.store.insert({
      ...base,
      doc_type: docType,
      source_format: format,
      status: "failed",
      engine: "none",
      model: null,
      prompt_version: PROMPT_VERSION,
      fields: { scalars: {}, rows: [] },
      row_count: 0,
      overall_confidence: null,
      low_confidence_fields: [],
      warnings,
      error: error.slice(0, 1000),
    });
    await deps.events.record({ extraction_id: rec.id, event_type: "failed", actor, detail: { reason: error.slice(0, 200) } });
    if (runId) await deps.runs!.finish(runId, { status: "failed", error }, clock()).catch(() => undefined);
    return { extraction: rec, result: null, assessment: null, modelCalls: [] };
  };

  // 2. Parse and classify.
  let parsed: ParsedSource;
  try {
    parsed = parseDocument(loaded.bytes, loaded.contentType);
  } catch (err) {
    if (err instanceof UnsupportedDocumentError) return failRecord("text", input.docType ?? null, err.message);
    throw err;
  }
  let docType: DocType | null = input.docType ?? (loaded.vaultKind ? (DOC_TYPE_BY_VAULT_KIND[loaded.vaultKind] ?? null) : null);
  const warnings = [...parsed.warnings];
  if (!docType) {
    const c = classifyDocument(parsed, loaded.fileName);
    if (c.docType && c.confidence >= MIN_CLASSIFIER_CONFIDENCE) {
      docType = c.docType;
      warnings.push("doc_type_inferred");
    } else {
      return failRecord(parsed.format, null, "document type could not be determined; set the type and run the extraction again", ["unclassified"]);
    }
  }
  const spec = specFor(docType);
  const modelCalls: ModelCall[] = [];
  const engineParts: string[] = [];
  let routingRefused = false;

  // 3. Unreadable PDF text layer: NeMo Retriever, when allowed.
  let tables = parsed.tables;
  let text = parsed.text;
  let textQuality = parsed.textQuality;
  if (parsed.format === "pdf" && textQuality < cfg.minTextQuality && deps.nemo?.configured()) {
    // A type inferred from the file (not declared) is treated as restricted: it could be a PFS.
    const level = spec.classification === "restricted" || warnings.includes("doc_type_inferred") ? "restricted" : "confidential";
    try {
      const nemo = await deps.nemo.extract({ bytes: loaded.bytes, contentType: "application/pdf", fileName: loaded.fileName }, { level, ...(subject ? { subject } : {}) });
      tables = [...nemo.tables, ...(nemo.text ? parseDocument(new TextEncoder().encode(nemo.text), "text/plain").tables : [])];
      text = nemo.text;
      textQuality = nemo.text ? 1 : 0;
      engineParts.push("nemo");
    } catch (err) {
      if (err instanceof RoutingRefusedError) {
        routingRefused = true;
        warnings.push("nemo_routing_refused");
      } else {
        warnings.push("nemo_unavailable");
        console.warn("[documents-agent] NeMo Retriever failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  // 4. Rules, then a model when the rules leave gaps.
  const rules = tables.length ? extractWithRules(docType, tables) : emptyResult(docType);
  const rulesAssessment = assessExtraction(validateExtraction(rules));
  let model: ModelExtraction | null = null;
  let modelName: string | null = null;
  // Restricted documents (PFS) may only go to Claude, whatever text model is configured.
  const textModel = spec.classification === "restricted" && providerForModel(cfg.textModel) !== "anthropic" ? MODELS.claude : cfg.textModel;
  let guard: InboundGuard | null = null;
  if (rulesAssessment.status === "needs_review" && !optOut) {
    // The document is untrusted: strip instruction-like sentences and scan before any model
    // sees it. The PDF path sends the file itself, so a finding in its text layer still
    // taints the run and sends the extraction to review.
    guard = guardInbound("document", { text }, { label: docType });
    if (guard.flagged) warnings.push(INJECTION_WARNING);
  }
  if (rulesAssessment.status === "needs_review") {
    try {
      if (optOut) {
        warnings.push("ai_processing_opt_out");
      } else if (text.trim() && textQuality >= cfg.minTextQuality && deps.gateway?.available(textModel)) {
        model = await extractFromText(deps.gateway, {
          docType,
          text: guard?.texts.text ?? text,
          format: parsed.format,
          fileName: loaded.fileName,
          model: textModel,
          ...(cfg.effort ? { effort: cfg.effort } : {}),
          ...(runId ? { traceId: runId } : {}),
        });
        modelName = textModel;
        engineParts.push("text_model");
      } else if (parsed.format === "pdf" && deps.claude?.configured()) {
        model = await deps.claude.extractPdf({ docType, pdf: loaded.bytes, fileName: loaded.fileName, ...(runId ? { traceId: runId } : {}) });
        modelName = model.call.model;
        engineParts.push("claude_pdf");
      } else {
        warnings.push("model_unavailable");
      }
    } catch (err) {
      if (err instanceof RoutingRefusedError) {
        routingRefused = true;
        warnings.push("model_routing_refused");
      } else if (err instanceof GatewayUnavailableError) {
        warnings.push("model_unavailable");
      } else if (err instanceof TextTooLongError || err instanceof PdfTooLargeError) {
        warnings.push("document_too_large_for_model");
      } else if (RETRYABLE(err)) {
        if (runId) await deps.runs!.finish(runId, { status: "failed", error: err instanceof Error ? err.message : String(err) }, clock()).catch(() => undefined);
        throw err; // transient: let the workflow retry
      } else {
        warnings.push("model_error");
        console.error("[documents-agent] model extraction failed:", err instanceof Error ? err.message : err);
      }
    }
    if (model) {
      modelCalls.push(model.call);
      warnings.push(...model.warnings);
    }
  }
  const rulesHadFields = Object.keys(rules.scalars).length > 0 || rules.rows.length > 0;
  if (!model?.result || rulesHadFields) engineParts.splice(engineParts[0] === "nemo" ? 1 : 0, 0, "rules");
  const merged = model?.result ? (rulesHadFields ? mergeExtractions(rules, model.result) : model.result) : rules;
  const result = validateExtraction({ ...merged, warnings: [...new Set([...merged.warnings, ...warnings])] });
  const assessment = assessExtraction(result);

  // A restricted extraction (PFS, or an inferred type) is only stored sealed; without
  // the encryption key it is refused before anything (the previous run included) changes.
  if (isRestrictedExtraction({ doc_type: docType, warnings: result.warnings }) && deps.store.acceptsRestricted && !deps.store.acceptsRestricted()) {
    throw new RestrictedExtractionError("PII_ENCRYPTION_KEY is not configured; refusing to store a personal financial statement extraction unencrypted");
  }

  // 5. Store: supersede the previous live run first (one live extraction per document and type).
  const previous =
    input.source === "vault_document"
      ? await deps.store.findLive({ documentId: input.documentId, docType })
      : input.source === "mail_attachment"
        ? await deps.store.findLive({ mailMessageId: input.mailMessageId, attachmentName: base.attachment_name!, docType })
        : null;
  if (previous) await deps.store.update(previous.id, { status: "superseded" }, ["pending", "extracted", "needs_review", "approved"]);

  const rec = await deps.store.insert({
    ...base,
    doc_type: docType,
    source_format: parsed.format,
    status: assessment.status,
    engine: engineParts.join("+").slice(0, 40) || "rules",
    model: modelName,
    prompt_version: PROMPT_VERSION,
    fields: { scalars: result.scalars, rows: result.rows },
    row_count: result.rows.length,
    overall_confidence: assessment.overallConfidence,
    low_confidence_fields: assessment.lowConfidenceFields.slice(0, 500),
    warnings: result.warnings.slice(0, 100),
    error: null,
  });
  if (previous) {
    await deps.store.update(previous.id, { superseded_by: rec.id });
    await deps.events.record({ extraction_id: previous.id, event_type: "superseded", actor, detail: { by: rec.id } });
    if (deps.budgets && previous.doc_type === "CONSTRUCTION_BUDGET") await deps.budgets.setStatus(previous.id, "superseded");
  }

  // 6. Audit and the construction budget target.
  if (guard) {
    await recordInjection(
      deps.agentEvents,
      {
        agent: DOCUMENTS_AGENT.id,
        agentVersion: DOCUMENTS_AGENT.version,
        task: DOCUMENTS_AGENT.task,
        prompt: extractionPromptRef(docType),
        model: modelName,
        runId: runId ?? null,
        dealId: rec.deal_id,
        leadId: rec.lead_id,
        label: docType,
      },
      guard,
    );
  }
  if (routingRefused) await deps.events.record({ extraction_id: rec.id, event_type: "routing_refused", actor, detail: { warnings: result.warnings.filter((w) => w.includes("routing")) } });
  await deps.events.record({
    extraction_id: rec.id,
    event_type: "extracted",
    actor,
    detail: { engine: rec.engine, fields: Object.keys(result.scalars), rows: result.rows.length, overall: assessment.overallConfidence },
  });
  if (assessment.status === "needs_review") {
    await deps.events.record({ extraction_id: rec.id, event_type: "queued_for_review", actor, detail: { fields: assessment.lowConfidenceFields.slice(0, 50), warnings: result.warnings } });
  }
  if (docType === "CONSTRUCTION_BUDGET" && deps.budgets) await deps.budgets.upsert(budgetRecordFrom(rec, loaded.pip ? "pip" : "ground_up"));

  if (runId) {
    await deps
      .runs!.finish(
        runId,
        {
          status: assessment.status === "needs_review" ? "needs_review" : "succeeded",
          summary: { extractionId: rec.id, docType, engine: rec.engine, overall: assessment.overallConfidence, review: assessment.lowConfidenceFields.length },
          modelCalls: modelCalls.map(toRunCall),
          routingRefusals: routingRefused ? 1 : 0,
          dealId: rec.deal_id,
          leadId: rec.lead_id,
        },
        clock(),
      )
      .catch(() => undefined);
  }
  return { extraction: rec, result, assessment, modelCalls };
}
