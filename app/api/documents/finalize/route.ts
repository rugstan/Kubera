import { after, NextResponse } from "next/server";
import { z } from "zod";
import { failureResponse, NO_STORE } from "@/lib/documents/http";
import { finalizeWithToken } from "@/lib/documents/finalize";
import { documentServices, hashIp } from "@/lib/documents/server";
import { guardPost } from "@/lib/security";
import { announceDocumentClean, runScanCycle, scannerFromEnv } from "@/workers/scan";

export const maxDuration = 120;

const bodySchema = z.object({
  documentId: z.uuid(),
  token: z.string().min(20).max(1000),
});

/**
 * Step 2 of an upload, after the browser has PUT the file to the signed URL.
 * Needs the expiring upload token from step 1. Verifies size, declared type
 * against the file's magic bytes and the lead's quota; on success the document
 * is `quarantined` and queued for the malware scan (which also starts right
 * after the response when a scanner is configured). A document stays
 * undownloadable until the scan marks it clean.
 */
export async function POST(req: Request) {
  const guard = await guardPost(req, {
    name: "docs-finalize",
    rate: { limit: 120, windowMs: 60 * 60_000 },
    rateLimitMessage: "Too many uploads",
    turnstile: false,
    maxBytes: 4_000,
  });
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(guard.body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  const deps = documentServices();
  if (!deps) return NextResponse.json({ error: "Document vault not configured" }, { status: 503, headers: NO_STORE });

  try {
    const result = await finalizeWithToken(deps, { documentId: parsed.data.documentId, token: parsed.data.token, ipHash: hashIp(guard.ip) });
    if (!result.ok) return failureResponse(result);
    if (!result.alreadyFinalized) {
      after(async () => {
        try {
          await runScanCycle(deps, scannerFromEnv(), { batchSize: 3, onClean: announceDocumentClean });
        } catch (err) {
          console.error("[documents] post-finalize scan failed:", err instanceof Error ? err.message : err);
        }
      });
    }
    // `status` is "quarantined": the file is received but not yet released.
    return NextResponse.json({ documentId: result.documentId, status: result.status }, { headers: NO_STORE });
  } catch (err) {
    console.error("[documents] finalize failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not finalize the upload" }, { status: 500, headers: NO_STORE });
  }
}
