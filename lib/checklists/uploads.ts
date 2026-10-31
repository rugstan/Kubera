// Checklist uploads from the borrower portal. Files go straight from the
// browser to the private vault bucket through a short-lived signed upload URL;
// the server checks the declared type and size first, then sniffs the first
// bytes of the stored object before the item is marked received. Malware
// scanning and quarantine are the vault's job (lib/documents, WS-K).

import { randomUUID } from "node:crypto";
import { z } from "zod";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Matches the deal-documents bucket limit.
export const MAX_FILES_PER_ITEM = 20;

export const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png",
  "image/jpeg": "jpg",
} as const;
export type AllowedType = keyof typeof ALLOWED_TYPES;

export const uploadRequestSchema = z.object({
  itemId: z.uuid(),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(Object.keys(ALLOWED_TYPES) as [AllowedType, ...AllowedType[]], { message: "Upload a PDF, Excel, CSV, PNG or JPEG file." }),
  sizeBytes: z.number().int().min(1, "The file is empty.").max(MAX_UPLOAD_BYTES, "Files can be up to 50 MB."),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadCompleteSchema = z.object({ fileId: z.uuid() });

/** File name safe for an object key: ASCII, no path parts, extension matching the type. */
export function safeFileName(name: string, contentType: AllowedType): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const stem = base
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${stem || "file"}.${ALLOWED_TYPES[contentType]}`;
}

export function checklistStoragePath(dealId: string, itemId: string, fileName: string, contentType: AllowedType, id: string = randomUUID()): string {
  return `deals/${dealId}/checklist/${itemId}/${id}-${safeFileName(fileName, contentType)}`;
}

/** Content type implied by the file's first bytes, or null when unrecognized. */
export function sniffContentType(bytes: Uint8Array): AllowedType | "zip" | "ole" | "text" | null {
  const b = bytes;
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"; // %PDF-
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "zip"; // XLSX is a ZIP container
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "ole"; // legacy XLS
  if (b.length > 0 && [...b].every((c) => c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c !== 0x7f))) return "text";
  return null;
}

/** True when the sniffed bytes are consistent with the declared type. */
export function bytesMatchType(bytes: Uint8Array, declared: AllowedType): boolean {
  const s = sniffContentType(bytes);
  switch (declared) {
    case "application/pdf":
    case "image/png":
    case "image/jpeg":
      return s === declared;
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return s === "zip";
    case "application/vnd.ms-excel":
      return s === "ole";
    case "text/csv":
      return s === "text";
  }
}
