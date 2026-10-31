// Checklist uploads from the borrower portal: the request checks (declared
// type and size). The bytes go straight from the browser to the WS-K vault's
// quarantine bucket; finalize (magic bytes, size, quota) and the malware scan
// run in lib/documents and workers/scan (see ./vault.ts), and the item is
// received only once the scan reports clean.

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
