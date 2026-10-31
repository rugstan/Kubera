import { NextResponse } from "next/server";
import { z } from "zod";
import { piiKeyring } from "@/lib/privacy/crypto";
import { buildSubjectExport, canonicalJson, exportSha256 } from "@/lib/privacy/export";
import { isActionable } from "@/lib/privacy/requests";
import { privacyAdminAuth, privacyServices } from "@/lib/privacy/server";

// Access-request export for a verified request. Compliance downloads the JSON
// and sends it to the requester through a secure channel; the export itself
// is never stored, only its hash and time (privacy_requests.export_*).
// Bearer PRIVACY_ADMIN_TOKEN.

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = privacyAdminAuth(req);
  if (auth === "disabled") return NextResponse.json({ error: "Privacy admin API is not configured" }, { status: 503, headers: NO_STORE });
  if (auth !== "ok") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const services = privacyServices();
  if (!services) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503, headers: NO_STORE });

  const row = await services.requests.get(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (row.request_type !== "access") return NextResponse.json({ error: "Only access requests produce an export" }, { status: 409, headers: NO_STORE });
  if (!isActionable(row)) return NextResponse.json({ error: `Request is ${row.status}; verify the requester before exporting` }, { status: 409, headers: NO_STORE });

  try {
    const now = new Date();
    const doc = await buildSubjectExport(services.subjects, row.subject_email, { now, requestId: row.id, keyring: piiKeyring(), phones: row.subject_phone ? [row.subject_phone] : [] });
    const sha = exportSha256(doc);
    await services.requests.update(row.id, { status: "in_progress", export_generated_at: now.toISOString(), export_sha256: sha });
    return new NextResponse(canonicalJson(doc), {
      status: 200,
      headers: {
        ...NO_STORE,
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="kubera-privacy-export-${row.id}.json"`,
        "x-export-sha256": sha,
      },
    });
  } catch (err) {
    console.error("privacy export failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Export failed" }, { status: 500, headers: NO_STORE });
  }
}
