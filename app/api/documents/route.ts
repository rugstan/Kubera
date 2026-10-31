import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, verifyLeadToken } from "@/lib/security";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/supabase/server";

const bodySchema = z.object({
  leadId: z.uuid(),
  token: z.string().min(10).max(200),
  kind: z.enum(["T12", "RENT_ROLL", "CENSUS", "STR_REPORT", "FRANCHISE_AGREEMENT", "PIP_BUDGET", "PFS", "TAX_RETURN", "APPRAISAL", "OTHER"]),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum([
    "application/pdf",
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png",
    "image/jpeg",
  ]),
});

/** Mints a short-lived signed upload URL into the private document vault. */
export async function POST(req: Request) {
  if (!rateLimit(`docs:${clientIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many uploads" }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { leadId, token, kind, fileName, contentType } = parsed.data;
  if (!process.env.LEAD_TOKEN_SECRET || !verifyLeadToken(leadId, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Document vault not configured" }, { status: 503 });

  const safeName = fileName.replace(/[^\w.\- ]+/g, "_");
  const path = `${leadId}/${kind}/${randomUUID()}-${safeName}`;
  const { data, error } = await db.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Could not create upload" }, { status: 500 });

  const { error: insertError } = await db
    .from("documents")
    .insert({ lead_id: leadId, kind, storage_path: path, file_name: safeName, content_type: contentType });
  if (insertError) return NextResponse.json({ error: "Could not record document" }, { status: 500 });

  return NextResponse.json({ uploadUrl: data.signedUrl, path });
}
