// Shared types and limits for the document vault (WS-K).
//
// Lifecycle of a borrower upload:
//
//   pending_upload  row minted, signed URL handed out; object lives in the quarantine bucket
//   quarantined     finalize verified size, MIME and magic bytes; waiting for the malware scan
//   clean           scanner passed it; object moved to the vault bucket; downloadable
//   infected        scanner found malware; object deleted, row kept as the record
//   rejected        finalize refused it (empty, too big, wrong type); object deleted
//   scan_failed     the scanner errored on every attempt; stays unreadable until staff review
//
// Only `clean` documents can ever be downloaded.

export const DOCUMENT_STATUSES = ["pending_upload", "quarantined", "clean", "infected", "rejected", "scan_failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_KINDS = ["T12", "RENT_ROLL", "CENSUS", "STR_REPORT", "FRANCHISE_AGREEMENT", "PIP_BUDGET", "PFS", "TAX_RETURN", "APPRAISAL", "OTHER"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Same bucket as DOCUMENT_BUCKET in lib/supabase/server.ts (asserted in tests). */
export const VAULT_BUCKET = "deal-documents";
/** Private holding bucket for uploads that have not passed the scan. */
export const QUARANTINE_BUCKET = "deal-documents-quarantine";
export type VaultBucket = typeof VAULT_BUCKET | typeof QUARANTINE_BUCKET;

/** Content types the vault accepts (matches both bucket allow-lists). */
export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** File extensions that may accompany each declared content type. */
export const EXTENSIONS_BY_TYPE: Record<AllowedContentType, readonly string[]> = {
  "application/pdf": ["pdf"],
  // Browsers on Windows report .csv as application/vnd.ms-excel, hence the overlap.
  "text/csv": ["csv"],
  "application/vnd.ms-excel": ["xls", "csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
};

export type DocumentRow = {
  id: string;
  created_at: string;
  lead_id: string;
  kind: DocumentKind;
  storage_path: string;
  file_name: string;
  content_type: string;
  extracted?: unknown;
  status: DocumentStatus;
  bucket: VaultBucket;
  declared_size_bytes: number | null;
  size_bytes: number | null;
  sha256: string | null;
  detected_mime: string | null;
  upload_expires_at: string | null;
  finalized_at: string | null;
  reject_reason: string | null;
  scanned_at: string | null;
  scan_engine: string | null;
  scan_signature: string | null;
  scan_attempts: number;
  scan_error: string | null;
  scan_lease_until: string | null;
  legal_hold?: boolean;
};

export type NewDocument = {
  lead_id: string;
  kind: DocumentKind;
  storage_path: string;
  file_name: string;
  content_type: string;
  declared_size_bytes: number;
  upload_expires_at: string;
};

export type DocumentPatch = Partial<
  Pick<
    DocumentRow,
    | "status"
    | "bucket"
    | "size_bytes"
    | "sha256"
    | "detected_mime"
    | "finalized_at"
    | "reject_reason"
    | "scanned_at"
    | "scan_engine"
    | "scan_signature"
    | "scan_error"
    | "scan_lease_until"
  >
>;

export const DOCUMENT_EVENTS = [
  "upload_minted",
  "upload_finalized",
  "upload_rejected",
  "upload_expired",
  "scan_clean",
  "scan_infected",
  "scan_error",
  "scan_failed",
  "download",
  "download_denied",
  "deleted",
] as const;
export type DocumentEventName = (typeof DOCUMENT_EVENTS)[number];

export type DocumentEvent = {
  event: DocumentEventName;
  document_id: string | null;
  lead_id: string | null;
  /** "borrower" for token-holders, "scanner", "system", or a staff label. Never a file name. */
  actor: string;
  ip_hash?: string | null;
  detail?: Record<string, string | number | boolean | null>;
};

export type VaultLimits = {
  /** Largest single file (matches the bucket limit). */
  maxFileBytes: number;
  /** Most files a lead may hold (pending, quarantined, clean, scan_failed). */
  maxFilesPerLead: number;
  /** Most bytes a lead may hold in total. */
  maxBytesPerLead: number;
  /** Lifetime of an upload token, and of the pending row it guards. */
  uploadTtlSeconds: number;
  /** Seconds a signed download URL stays valid. */
  downloadTtlSeconds: number;
  /** Scans a document may fail before it parks as scan_failed. */
  maxScanAttempts: number;
  /** How long a worker may hold a document before another may claim it. */
  scanLeaseSeconds: number;
};

export const DEFAULT_LIMITS: VaultLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxFilesPerLead: 60,
  maxBytesPerLead: 500 * 1024 * 1024,
  uploadTtlSeconds: 15 * 60,
  downloadTtlSeconds: 60,
  maxScanAttempts: 5,
  scanLeaseSeconds: 5 * 60,
};

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): VaultLimits {
  return {
    ...DEFAULT_LIMITS,
    uploadTtlSeconds: positiveInt(env.DOCUMENT_UPLOAD_TTL_SECONDS, DEFAULT_LIMITS.uploadTtlSeconds),
    maxFilesPerLead: positiveInt(env.DOCUMENT_MAX_FILES_PER_LEAD, DEFAULT_LIMITS.maxFilesPerLead),
    maxBytesPerLead: positiveInt(env.DOCUMENT_MAX_MB_PER_LEAD, DEFAULT_LIMITS.maxBytesPerLead / 1024 / 1024) * 1024 * 1024,
  };
}

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
