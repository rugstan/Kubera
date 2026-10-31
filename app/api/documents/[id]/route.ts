import { NextResponse } from "next/server";
import { z } from "zod";
import { failureResponse, NO_STORE } from "@/lib/documents/http";
import { deleteDocument } from "@/lib/documents/lifecycle";
import { authenticateStaff, documentServices, hashIp } from "@/lib/documents/server";
import { clientIp } from "@/lib/security";

// Staff only. Deletes the stored file (both buckets) and then the row; a document
// under legal hold is refused with 423. The deletion is audited. Bearer
// DOCUMENT_STAFF_TOKEN until WS-I staff sessions replace it.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = authenticateStaff(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 503 ? "Document management is not configured" : "Unauthorized" }, { status: auth.status, headers: NO_STORE });
  }
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: "Document not found", code: "not_found" }, { status: 404, headers: NO_STORE });
  const deps = documentServices();
  if (!deps) return NextResponse.json({ error: "Document vault not configured" }, { status: 503, headers: NO_STORE });

  try {
    const reason = new URL(req.url).searchParams.get("reason") ?? undefined;
    const res = await deleteDocument(deps, id.data, { actor: auth.staff.actor, ipHash: hashIp(clientIp(req)), reason });
    if (!res.ok) return failureResponse(res);
    return NextResponse.json({ ok: true, documentId: res.documentId }, { headers: NO_STORE });
  } catch (err) {
    console.error("[documents] delete failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not delete the document" }, { status: 500, headers: NO_STORE });
  }
}
