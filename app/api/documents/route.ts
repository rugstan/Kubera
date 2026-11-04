import { NextResponse } from "next/server";
import { z } from "zod";
import { failureResponse, NO_STORE } from "@/lib/documents/http";
import { mintUpload } from "@/lib/documents/mint";
import { documentServices, hashIp } from "@/lib/documents/server";
import { ALLOWED_CONTENT_TYPES, DOCUMENT_KINDS } from "@/lib/documents/types";
import { guardPost, verifyLeadToken } from "@/lib/security";

const bodySchema = z.object({
  leadId: z.uuid(),
  token: z.string().min(10).max(200),
  kind: z.enum(DOCUMENT_KINDS),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  /** Exact size in bytes of the file about to be sent; lets quotas be enforced up front. */
  sizeBytes: z.number().int().positive().optional(),
});

/**
 * Step 1 of an upload. Records a `pending_upload` row and mints a short-lived
 * signed URL into the private QUARANTINE bucket, plus an expiring upload token
 * for POST /api/documents/finalize. The file is not usable until it passes
 * finalize and the malware scan (see lib/documents and workers/scan).
 */
export async function POST(req: Request) {
  const guard = await guardPost(req, {
    name: "docs",
    rate: { limit: 30, windowMs: 60 * 60_000 },
    rateLimitMessage: "Too many uploads",
    turnstile: "documents",
    maxBytes: 8_000,
  });
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(guard.body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  const { leadId, token, kind, fileName, contentType, sizeBytes } = parsed.data;
  if (!process.env.LEAD_TOKEN_SECRET || !verifyLeadToken(leadId, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const deps = documentServices();
  if (!deps) return NextResponse.json({ error: "Document vault not configured" }, { status: 503, headers: NO_STORE });

  try {
    const minted = await mintUpload(deps, { leadId, kind, fileName, contentType, sizeBytes, ipHash: hashIp(guard.ip) });
    if (!minted.ok) return failureResponse(minted);
    const { ok: _ok, ...body } = minted;
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    console.error("[documents] mint failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not record document" }, { status: 500, headers: NO_STORE });
  }
}
