// Term sheets attached to lenders@ mail. The mail pipeline files a term-sheet
// attachment (PDF, XLSX, XLS, CSV) of a message routed to a deal in the vault
// as a staff-only TERM_SHEET document (lib/mail/attachments.ts). The malware
// scan releases it, the document agent (WS-L) extracts it with the TERM_SHEET
// spec, and the term-sheet intake (./service.ts ingestTermSheets) reads that
// extraction here and merges it with whatever the email body states.
//
// The extraction is already guarded: the document agent strips and scans the
// file's text before any model reads it and marks a finding with the
// `injection_suspected` warning, which the intake turns into a review flag.

import type { ExtractionRecord, ExtractionStore } from "@/lib/agents/documents/store";
import type { ExtractedField } from "@/lib/agents/documents/types";
import type { DocumentStore } from "@/lib/documents/store";
import { parseTermSheetByRules, sanitizeExtraction, type TermSheetExtraction, type TermSheetField } from "./term-sheet";
import type { PrepayKind, Recourse } from "./types";

/** A TERM_SHEET vault document filed from one message's attachments. */
export type TermSheetAttachmentRef = { documentId: string; fileName: string };

export type TermSheetAttachmentState =
  /** Still quarantined or being scanned, or clean but not extracted yet. */
  | { state: "pending" }
  /** Infected, rejected, scan failed, missing, or the extraction failed or was rejected. */
  | { state: "unreadable"; reason: string }
  | { state: "extracted"; extraction: ExtractionRecord };

export interface TermSheetAttachmentSource {
  attachmentState(documentId: string): Promise<TermSheetAttachmentState>;
}

/** The TERM_SHEET vault documents in a mail_messages.attachments array (lib/mail/attachments.ts AttachmentRecord). */
export function termSheetAttachments(value: unknown): TermSheetAttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is { documentId: string; fileName?: unknown } => !!a && typeof a === "object" && (a as { kind?: unknown }).kind === "TERM_SHEET" && typeof (a as { documentId?: unknown }).documentId === "string")
    .map((a) => ({ documentId: a.documentId, fileName: typeof a.fileName === "string" ? a.fileName : "attachment" }));
}

/** How long the intake waits for an attachment's scan and extraction before it reads the body alone. */
export const ATTACHMENT_WAIT_MS = 6 * 60 * 60_000;

const UNREADABLE_DOCUMENT = new Set(["infected", "rejected", "scan_failed"]);

/** Attachment state from the vault (documents) and the document agent's extractions. */
export function vaultTermSheetAttachments(deps: { documents: Pick<DocumentStore, "get">; extractions: Pick<ExtractionStore, "findLive" | "listForLead"> }): TermSheetAttachmentSource {
  return {
    async attachmentState(documentId) {
      const doc = await deps.documents.get(documentId);
      if (!doc) return { state: "unreadable", reason: "document not found" };
      if (UNREADABLE_DOCUMENT.has(doc.status)) return { state: "unreadable", reason: `document is ${doc.status.replace("_", " ")}` };
      if (doc.status !== "clean") return { state: "pending" };
      const live = await deps.extractions.findLive({ documentId, docType: "TERM_SHEET" });
      if (live) return { state: "extracted", extraction: live };
      // No live run: a failed or rejected one means the file cannot be read; none at all means it is still queued.
      // (A run that failed before the type was set, such as an unparseable file, has no doc_type.)
      const settled = (await deps.extractions.listForLead(doc.lead_id))
        .filter((e) => e.document_id === documentId && (e.doc_type === "TERM_SHEET" || e.doc_type === null) && (e.status === "failed" || e.status === "rejected"))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return settled ? { state: "unreadable", reason: `extraction ${settled.status}` } : { state: "pending" };
    },
  };
}

export class MemoryTermSheetAttachmentSource implements TermSheetAttachmentSource {
  constructor(readonly states: Map<string, TermSheetAttachmentState> = new Map()) {}
  async attachmentState(documentId: string): Promise<TermSheetAttachmentState> {
    return this.states.get(documentId) ?? { state: "unreadable", reason: "document not found" };
  }
}

// ---------------------------------------------------------------------------
// Document extraction (WS-L TERM_SHEET spec) → term-sheet extraction

function prepayFrom(text: string): { kind: PrepayKind; schedule: number[] | null; months: number | null } | null {
  const t = text.trim();
  if (!t) return null;
  const lockout = /\b(\d{1,3})[-\s]?(year|yr|month|mo)s?\b[^.]{0,15}\block[-\s]?out\b|\block[-\s]?out\b[^.\d]{0,15}(\d{1,3})[-\s]?(year|yr|month|mo)s?\b/i.exec(t);
  if (lockout) {
    const n = Number(lockout[1] ?? lockout[3]);
    const unit = lockout[2] ?? lockout[4] ?? "";
    return { kind: "lockout", schedule: null, months: /^y/i.test(unit) ? n * 12 : n };
  }
  if (/^(none|n\/a|open|no prepay(ment)?( penalty| premium)?)\b/i.test(t)) return { kind: "none", schedule: null, months: null };
  // The rules parser already reads step-downs, yield maintenance, defeasance and minimum interest.
  const rules = parseTermSheetByRules(`Prepayment: ${t}.`);
  return rules.prepayKind ? { kind: rules.prepayKind, schedule: rules.prepaySchedule, months: rules.prepayMonths } : null;
}

function recourseFrom(text: string): Recourse | null {
  if (/\bnon[-\s]?recourse\b/i.test(text)) return "non_recourse";
  if (/\bnegotiable\b/i.test(text)) return "negotiable";
  if (/\bpartial\b|\b\d{1,3}\s?%/i.test(text)) return "partial";
  if (/\bfull\b|\bfull(y)? guarant|^\s*recourse\s*$/i.test(text)) return "full";
  return null;
}

/**
 * Maps the document agent's TERM_SHEET fields (percent kinds stored as
 * fractions, amortization in years) onto the lenders parser's extraction,
 * keeping each field's confidence. Values go through the same range checks
 * as a parsed email.
 */
export function extractionFromDocument(scalars: Record<string, ExtractedField>): TermSheetExtraction {
  const raw: Record<string, unknown> = {};
  const confidence: Partial<Record<TermSheetField, number>> = {};
  const set = (field: TermSheetField, value: unknown, from: ExtractedField | undefined) => {
    if (value === null || value === undefined || !from) return;
    raw[field] = value;
    confidence[field] = from.confidence;
  };
  const num = (k: string) => (typeof scalars[k]?.value === "number" ? (scalars[k]!.value as number) : null);
  const str = (k: string) => (typeof scalars[k]?.value === "string" ? (scalars[k]!.value as string) : null);
  const pct = (k: string) => {
    const v = num(k);
    return v === null ? null : Math.round(v * 100 * 10_000) / 10_000;
  };

  set("lenderName", str("lenderName"), scalars.lenderName);
  set("loanAmount", num("loanAmount"), scalars.loanAmount);
  set("ratePct", num("interestRatePct"), scalars.interestRatePct);
  const rateType = str("rateType");
  set("rateType", rateType && /\b(float|floating|variable|adjustable)\b/i.test(rateType) ? "floating" : rateType && /\bfixed\b/i.test(rateType) ? "fixed" : null, scalars.rateType);
  set("indexName", str("indexName"), scalars.indexName);
  set("spreadBps", num("spreadBps"), scalars.spreadBps);
  const amortYears = num("amortizationYears");
  if (amortYears === 0) set("interestOnlyFullTerm", true, scalars.amortizationYears);
  else if (amortYears !== null) set("amortizationMonths", Math.round(amortYears * 12), scalars.amortizationYears);
  set("ioMonths", num("interestOnlyMonths"), scalars.interestOnlyMonths);
  set("termMonths", num("termMonths"), scalars.termMonths);
  set("originationFeePct", pct("originationFeePct"), scalars.originationFeePct);
  set("exitFeePct", pct("exitFeePct"), scalars.exitFeePct);
  set("maxLtvPct", pct("maxLtv"), scalars.maxLtv);
  set("minDscr", num("minDscr"), scalars.minDscr);
  set("minDebtYieldPct", pct("minDebtYield"), scalars.minDebtYield);
  const prepay = prepayFrom(str("prepayment") ?? "");
  if (prepay) {
    set("prepayKind", prepay.kind, scalars.prepayment);
    set("prepaySchedule", prepay.schedule, scalars.prepayment);
    set("prepayMonths", prepay.months, scalars.prepayment);
  }
  set("recourse", recourseFrom(str("recourse") ?? ""), scalars.recourse);

  // Every field present (null, confidence 0) before the document's values go on top.
  const empty = parseTermSheetByRules("");
  return sanitizeExtraction({ ...empty, ...raw, notes: null, confidence: { ...empty.confidence, ...confidence } }) ?? empty;
}

/**
 * Field by field, the better-supported of the email body and the attached
 * document: the document's value wins unless the body states the field with
 * higher confidence. Notes come from the body.
 */
export function mergeTermSheetExtractions(body: TermSheetExtraction, doc: TermSheetExtraction): TermSheetExtraction {
  const values: Record<string, unknown> = { ...body };
  const confidence = { ...body.confidence };
  for (const f of Object.keys(body.confidence) as TermSheetField[]) {
    const d = doc[f];
    if (d === null || d === undefined) continue;
    if (body[f] === null || doc.confidence[f] >= body.confidence[f]) {
      values[f] = d;
      confidence[f] = doc.confidence[f];
    }
  }
  return { ...(values as TermSheetExtraction), confidence };
}

/**
 * The document agent's warning on an extraction whose text tried to instruct
 * the model (lib/agents/documents/pipeline.ts INJECTION_WARNING; kept as a
 * literal so the lenders desk does not load the extraction pipeline).
 */
export const DOCUMENT_INJECTION_WARNING = "injection_suspected";

/** True when the document agent found instruction-like text in the attachment. */
export function extractionInjectionSuspected(e: Pick<ExtractionRecord, "warnings">): boolean {
  return e.warnings.includes(DOCUMENT_INJECTION_WARNING);
}
