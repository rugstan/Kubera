import { NextResponse } from "next/server";
import { z } from "zod";
import { failureResponse, NO_STORE } from "@/lib/documents/http";
import { deleteDocument } from "@/lib/documents/lifecycle";
import { documentServices, hashIp } from "@/lib/documents/server";
import { authenticateVaultStaff, staffDenialMessage } from "@/lib/documents/staff-auth";
import { clientIp, isAllowedOrigin } from "@/lib/security";

// Brokers and admins only (WS-I session with MFA). Deletes the stored file (both
// buckets) and then the row; a document under legal hold is refused with 423.
// The deletion is audited under the signed-in staff member's identity.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Session cookies are SameSite=Lax, but a cross-site Origin is refused outright.
  const origin = req.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  const auth = await authenticateVaultStaff({ roles: ["broker", "admin"] });
  if (!auth.ok) return NextResponse.json({ error: staffDenialMessage(auth), code: auth.reason }, { status: auth.status, headers: NO_STORE });
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
