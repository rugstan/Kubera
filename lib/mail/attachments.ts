// Inbound mail attachments → private quarantine storage, and (for docs@,
// deals@ and vendors@ mail routed to a lead) a `documents` row in the vault.
// lenders@ term sheets routed to a deal are filed as staff-only TERM_SHEET
// documents so the document agent (WS-L) can read them once they scan clean.
//
// Every stored attachment lands in the quarantine bucket and its vault row is
// `quarantined`, so nothing from email is downloadable until the malware
// scanner (WS-K, workers/scan) marks it clean. Types are checked by magic
// bytes, not by the sender's declared content type. Anything else is recorded
// on the message and skipped.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { documentKindsIn, type MailClassification, type MailDocumentKind } from "./classify";
import { MAILBOXES, type InboundMailbox } from "./mailboxes";
import type { MailRoute } from "./route";
import { MailProviderError, type MailMessage, type MailProvider } from "./types";

/** WS-K's private holding bucket (lib/documents/types.ts QUARANTINE_BUCKET). */
export const QUARANTINE_BUCKET = "deal-documents-quarantine";
/** Matches the vault bucket's 50 MB file_size_limit. */
export const MAX_ATTACHMENT_BYTES = 52_428_800;
export const MAX_ATTACHMENTS_PER_MESSAGE = 20;

export const ACCEPTED_TYPES = {
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
} as const;

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

function extension(fileName: string): string {
  return /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
}

/** Content type from the bytes (and extension only to tell ZIP/OLE/text formats apart); null = not accepted. */
export function sniffContentType(bytes: Uint8Array, fileName: string): string | null {
  const ext = extension(fileName);
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return ACCEPTED_TYPES.pdf;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ACCEPTED_TYPES.png;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return ACCEPTED_TYPES.jpg;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && ext === "xlsx") return ACCEPTED_TYPES.xlsx;
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) && ext === "xls") return ACCEPTED_TYPES.xls;
  if (ext === "csv" && bytes.length > 0) {
    const head = bytes.subarray(0, 4096);
    if (!head.includes(0) && new TextDecoder("utf-8", { fatal: false }).decode(head).split("\n")[0]!.includes(",")) return ACCEPTED_TYPES.csv;
  }
  return null;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(-120);
  return cleaned || "attachment";
}

export function attachmentPath(mailbox: InboundMailbox, msg: Pick<MailMessage, "providerMessageId" | "receivedAt">, sha256: string, fileName: string): string {
  const d = new Date(msg.receivedAt);
  const ym = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `inbound-mail/${mailbox}/${ym}/${msg.providerMessageId.replace(/[^\w-]/g, "_").slice(0, 80)}/${sha256.slice(0, 16)}-${sanitizeFileName(fileName)}`;
}

/** Vault kind for one file: its name first, then the message, else OTHER. */
export function documentKindFor(fileName: string, c: MailClassification): MailDocumentKind {
  const fromName = documentKindsIn(fileName.replace(/[_.-]+/g, " "));
  if (fromName.length === 1) return fromName[0]!;
  const fromMessage = c.documentKinds.filter((k) => k !== "OTHER");
  return fromMessage.length === 1 ? fromMessage[0]! : "OTHER";
}

/** Vault kind of a lenders@ term-sheet attachment (lib/documents/types.ts SYSTEM_DOCUMENT_KINDS). */
export const TERM_SHEET_KIND = "TERM_SHEET";
export type AttachmentKind = MailDocumentKind | typeof TERM_SHEET_KIND;

/** Term-sheet formats the document agent reads, filed as TERM_SHEET documents (images are kept with the message only). */
export const TERM_SHEET_TYPES: ReadonlySet<string> = new Set([ACCEPTED_TYPES.pdf, ACCEPTED_TYPES.csv, ACCEPTED_TYPES.xls, ACCEPTED_TYPES.xlsx]);

export type AttachmentStatus = "stored" | "registered" | "skipped_type" | "skipped_size" | "skipped_limit" | "failed";

export type AttachmentRecord = {
  attachmentId: string;
  fileName: string;
  size: number;
  contentType: string | null;
  sha256: string | null;
  status: AttachmentStatus;
  bucket: string | null;
  storagePath: string | null;
  documentId: string | null;
  kind: AttachmentKind | null;
  error: string | null;
  /** On "failed": whether another attempt may succeed (a 429/5xx, timeout or storage error; not a 404). */
  retryable?: boolean;
  /** On "registered" from the review queue: the lead it was filed under, so a retry after a partial failure files the rest under the same lead. */
  leadId?: string | null;
};

export interface AttachmentSink {
  /** Idempotent: storing the same path twice is not an error. */
  store(input: { bucket: string; path: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  /** Registers a quarantined vault document; idempotent on storage path. */
  registerDocument(input: { leadId: string; kind: AttachmentKind; bucket: string; path: string; fileName: string; contentType: string; sizeBytes: number; sha256: string }): Promise<{ documentId: string }>;
}

export async function processAttachments(
  msg: MailMessage,
  c: MailClassification,
  route: MailRoute,
  deps: { provider: MailProvider; sink: AttachmentSink },
): Promise<AttachmentRecord[]> {
  const box = MAILBOXES[msg.mailbox];
  const routed = route.status === "processed" && Boolean(route.leadId) && !c.suspicious;
  const register = box.vaultAttachments && routed;
  // A term sheet tied to a deal: filed (staff only) for the document agent and the lenders desk.
  const termSheet = !register && box.termSheetAttachments && routed && c.category === "term_sheet" && Boolean(route.dealId);
  const out: AttachmentRecord[] = [];
  for (const [i, a] of msg.attachments.entries()) {
    const base: AttachmentRecord = { attachmentId: a.attachmentId, fileName: a.fileName, size: a.size, contentType: null, sha256: null, status: "failed", bucket: null, storagePath: null, documentId: null, kind: null, error: null };
    if (i >= MAX_ATTACHMENTS_PER_MESSAGE) {
      out.push({ ...base, status: "skipped_limit" });
      continue;
    }
    if (a.size > MAX_ATTACHMENT_BYTES) {
      out.push({ ...base, status: "skipped_size" });
      continue;
    }
    try {
      const { bytes } = await deps.provider.fetchAttachment(msg.mailbox, msg, a.attachmentId);
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        out.push({ ...base, size: bytes.byteLength, status: "skipped_size" });
        continue;
      }
      const contentType = sniffContentType(bytes, a.fileName);
      if (!contentType) {
        out.push({ ...base, size: bytes.byteLength, status: "skipped_type" });
        continue;
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const path = attachmentPath(msg.mailbox, msg, sha256, a.fileName);
      await deps.sink.store({ bucket: QUARANTINE_BUCKET, path, bytes, contentType });
      const rec: AttachmentRecord = { ...base, size: bytes.byteLength, contentType, sha256, status: "stored", bucket: QUARANTINE_BUCKET, storagePath: path };
      if ((register || (termSheet && TERM_SHEET_TYPES.has(contentType))) && route.leadId) {
        const kind: AttachmentKind = register ? documentKindFor(a.fileName, c) : TERM_SHEET_KIND;
        const { documentId } = await deps.sink.registerDocument({ leadId: route.leadId, kind, bucket: QUARANTINE_BUCKET, path, fileName: sanitizeFileName(a.fileName), contentType, sizeBytes: bytes.byteLength, sha256 });
        Object.assign(rec, { status: "registered", documentId, kind });
      }
      out.push(rec);
    } catch (err) {
      // The caller (processInboundMessage) retries the message for a transient failure, so nothing is lost silently.
      out.push({ ...base, error: err instanceof Error ? err.message.slice(0, 300) : String(err), retryable: !(err instanceof MailProviderError) || err.retryable });
    }
  }
  return out;
}

// --- Sinks -----------------------------------------------------------------------------

export class MemoryAttachmentSink implements AttachmentSink {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly documents: { id: string; leadId: string; kind: AttachmentKind; path: string; status: "quarantined"; sha256: string }[] = [];

  async store(input: { bucket: string; path: string; bytes: Uint8Array; contentType: string }): Promise<void> {
    this.objects.set(`${input.bucket}/${input.path}`, { bytes: input.bytes, contentType: input.contentType });
  }

  async registerDocument(input: { leadId: string; kind: AttachmentKind; path: string; sha256: string }): Promise<{ documentId: string }> {
    const existing = this.documents.find((d) => d.path === input.path);
    if (existing) return { documentId: existing.id };
    const id = globalThis.crypto.randomUUID();
    this.documents.push({ id, leadId: input.leadId, kind: input.kind, path: input.path, status: "quarantined", sha256: input.sha256 });
    return { documentId: id };
  }
}

export function supabaseAttachmentSink(db: SupabaseClient): AttachmentSink {
  return {
    async store({ bucket, path, bytes, contentType }) {
      const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
      // Same content-addressed path already uploaded on an earlier attempt.
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`storage upload failed: ${error.message}`);
    },
    async registerDocument(d) {
      const row = {
        lead_id: d.leadId,
        kind: d.kind,
        storage_path: d.path,
        file_name: d.fileName,
        content_type: d.contentType,
        status: "quarantined",
        bucket: d.bucket,
        declared_size_bytes: d.sizeBytes,
        size_bytes: d.sizeBytes,
        sha256: d.sha256,
      };
      const ins = await db.from("documents").insert(row).select("id").single();
      if (!ins.error) return { documentId: (ins.data as { id: string }).id };
      if (ins.error.code === "23505") {
        const existing = await db.from("documents").select("id").eq("storage_path", d.path).single();
        if (!existing.error) return { documentId: (existing.data as { id: string }).id };
      }
      throw new Error(`documents insert failed: ${ins.error.message}`);
    },
  };
}
