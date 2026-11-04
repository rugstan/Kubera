// Document viewer model and pure rules.

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  T12: "T-12 operating statement",
  RENT_ROLL: "Rent roll",
  CENSUS: "Census",
  STR_REPORT: "STR report",
  FRANCHISE_AGREEMENT: "Franchise agreement",
  PIP_BUDGET: "PIP budget",
  PFS: "Personal financial statement",
  TAX_RETURN: "Tax return",
  APPRAISAL: "Appraisal",
  TERM_SHEET: "Lender term sheet",
  OTHER: "Other",
};

export function kindLabel(kind: string): string {
  return DOCUMENT_KIND_LABELS[kind] ?? kind;
}

export type StaffDocument = {
  id: string;
  createdAt: string;
  kind: string;
  fileName: string;
  contentType: string;
  leadId: string;
  storagePath: string;
  dealId: string | null;
  dealName: string | null;
  /** Malware-scan / vault state when the vault records one (WS-K); null when unknown. */
  scanStatus: string | null;
};

/**
 * The only vault state in which a file is handed out. WS-K's documents.status
 * is one of pending_upload, quarantined, clean, infected, rejected, scan_failed;
 * anything but "clean" (including states added later) stays held.
 */
const SERVABLE_SCAN_STATE = "clean";

/** Columns the vault may use for scan state, in priority order. */
export const SCAN_STATE_COLUMNS = ["scan_status", "status"] as const;

export function scanStatusOf(row: Record<string, unknown>): string | null {
  for (const c of SCAN_STATE_COLUMNS) {
    const v = row[c];
    if (typeof v === "string" && v) return v.toLowerCase();
  }
  return null;
}

export type Servable = { ok: true } | { ok: false; status: 404 | 423; message: string };

export function servable(doc: Pick<StaffDocument, "scanStatus" | "storagePath"> | null): Servable {
  if (!doc || !doc.storagePath) return { ok: false, status: 404, message: "Document not found." };
  if (doc.scanStatus && doc.scanStatus !== SERVABLE_SCAN_STATE) {
    return { ok: false, status: 423, message: "This file is held in quarantine until its malware scan comes back clean." };
  }
  return { ok: true };
}

/** Signed URLs are short-lived: long enough to open the file, too short to share usefully. */
export const SIGNED_URL_TTL_SECONDS = 60;

/** Content-Disposition filename that cannot break out of the header. */
export function safeDispositionName(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\\r\n;]/g, "_").trim();
  return (ascii || "document").slice(0, 150);
}
