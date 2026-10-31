import { NextResponse } from "next/server";
import { z } from "zod";
import { requestFingerprint, staffForMutation } from "@/lib/auth/dal";
import { getDocument, openDocument } from "../../data";
import { safeDispositionName, servable } from "../../model";

// Opens one vault file for a signed-in staff member: access check → scan
// check → audit row (fail closed) → 60-second signed URL. Nothing is cached
// and the signed URL is never sent as a Referer.

const NO_STORE = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

function deny(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = z.uuid().safeParse(raw);
  if (!id.success) return deny(404, "Document not found.");

  const auth = await staffForMutation();
  if (!auth.ok) {
    if (auth.status === 401) {
      const next = encodeURIComponent(`/documents/${id.data}`);
      return NextResponse.redirect(new URL(`/login?next=${next}`, req.url), { status: 303, headers: NO_STORE });
    }
    return deny(auth.status, auth.reason === "mfa_required" ? "Two-step verification required." : "Not allowed.");
  }
  const { ctx } = auth;

  const doc = await getDocument(ctx, id.data);
  const s = servable(doc);
  if (!s.ok || !doc) return deny(s.ok ? 404 : s.status, s.ok ? "Document not found." : s.message);

  const download = new URL(req.url).searchParams.get("download") === "1";
  try {
    await ctx.services.audit.record({
      actorId: ctx.principal.userId,
      actorLabel: ctx.principal.displayName,
      action: "document.view",
      targetType: "document",
      targetId: doc.id,
      detail: { kind: doc.kind, leadId: doc.leadId, dealId: doc.dealId, download },
      ...(await requestFingerprint()),
    });
  } catch (err) {
    console.error("[documents] audit write failed; refusing to open", err instanceof Error ? err.message : err);
    return deny(503, "The document could not be opened right now. Try again shortly.");
  }

  const opened = await openDocument(ctx, doc, { download });
  if (opened.kind === "unavailable") return deny(503, "The document vault is not available right now.");
  if (opened.kind === "inline") {
    return new NextResponse(opened.body, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": opened.contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeDispositionName(doc.fileName)}.txt"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return NextResponse.redirect(opened.url, { status: 303, headers: NO_STORE });
}
