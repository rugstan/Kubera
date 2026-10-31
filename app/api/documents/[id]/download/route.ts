import { NextResponse } from "next/server";
import { z } from "zod";
import { failureResponse, NO_STORE } from "@/lib/documents/http";
import { createDownloadLink } from "@/lib/documents/lifecycle";
import { documentServices, hashIp } from "@/lib/documents/server";
import { authenticateVaultStaff, staffDenialMessage } from "@/lib/documents/staff-auth";
import { clientIp } from "@/lib/security";

// Staff only (WS-I session with MFA). Returns a 60-second signed URL for a CLEAN
// document and writes a `download` event to the audit log first, naming the
// signed-in staff member; if the audit write fails, no URL is issued. Documents
// that are quarantined, infected, rejected or scan_failed are refused (and the
// refusal is audited). Optional `?purpose=` is recorded with the event.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateVaultStaff();
  if (!auth.ok) return NextResponse.json({ error: staffDenialMessage(auth), code: auth.reason }, { status: auth.status, headers: NO_STORE });
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: "Document not found", code: "not_found" }, { status: 404, headers: NO_STORE });
  const deps = documentServices();
  if (!deps) return NextResponse.json({ error: "Document vault not configured" }, { status: 503, headers: NO_STORE });

  try {
    const purpose = new URL(req.url).searchParams.get("purpose") ?? undefined;
    const link = await createDownloadLink(deps, { documentId: id.data, actor: auth.staff.actor, ipHash: hashIp(clientIp(req)), purpose });
    if (!link.ok) return failureResponse(link);
    const { ok: _ok, ...body } = link;
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    console.error("[documents] download failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not prepare the download" }, { status: 500, headers: NO_STORE });
  }
}
