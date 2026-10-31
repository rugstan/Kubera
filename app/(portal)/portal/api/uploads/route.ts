import { NextResponse } from "next/server";
import { checklistDeps } from "@/lib/checklists/desk";
import { ChecklistError, startPortalUpload } from "@/lib/checklists/service";
import { uploadRequestSchema } from "@/lib/checklists/uploads";
import { guardPost } from "@/lib/security";
import { portalFromRequest } from "../../_lib/request";

// Borrower portal: start an upload for a checklist item. Returns a short-lived
// signed URL the browser uploads the file to directly: the vault's QUARANTINE
// bucket (WS-K). Nothing is readable until the malware scan passes.

const NO_STORE = { "cache-control": "no-store" };
const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: Request) {
  const guard = await guardPost(req, { name: "portal-upload", rate: { limit: 60, windowMs: 10 * 60_000 }, turnstile: false, maxBytes: 4_000 });
  if (!guard.ok) return guard.response;
  const portal = await portalFromRequest(req);
  if (!portal.ok) return json(portal.status, { error: portal.error });
  const parsed = uploadRequestSchema.safeParse(guard.body);
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Check the file." });
  try {
    const { file, uploadUrl } = await startPortalUpload(checklistDeps(portal.services), portal.session, parsed.data);
    return json(201, { ok: true, fileId: file.id, uploadUrl });
  } catch (err) {
    if (err instanceof ChecklistError) return json(err.status, { error: err.message });
    console.error("[portal] upload start failed", err instanceof Error ? err.message : err);
    return json(500, { error: "We couldn't start the upload. Please try again." });
  }
}
