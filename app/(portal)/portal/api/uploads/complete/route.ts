import { NextResponse } from "next/server";
import { checklistDeps } from "@/lib/checklists/desk";
import { ChecklistError, completePortalUpload } from "@/lib/checklists/service";
import { uploadCompleteSchema } from "@/lib/checklists/uploads";
import { guardPost } from "@/lib/security";
import { portalFromRequest } from "../../../_lib/request";

// Borrower portal: confirm an upload. The vault checks the stored file (size,
// type vs. magic bytes) and queues it for the malware scan; the checklist item
// is received once the scan reports clean.

const NO_STORE = { "cache-control": "no-store" };
const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: Request) {
  const guard = await guardPost(req, { name: "portal-upload", rate: { limit: 60, windowMs: 10 * 60_000 }, turnstile: false, maxBytes: 1_000 });
  if (!guard.ok) return guard.response;
  const portal = await portalFromRequest(req);
  if (!portal.ok) return json(portal.status, { error: portal.error });
  const parsed = uploadCompleteSchema.safeParse(guard.body);
  if (!parsed.success) return json(400, { error: "Missing upload id." });
  try {
    const { file, item } = await completePortalUpload(checklistDeps(portal.services), portal.session, parsed.data.fileId);
    return json(200, { ok: true, file: { id: file.id, fileName: file.fileName, status: file.status }, item: { id: item.id, status: item.status } });
  } catch (err) {
    if (err instanceof ChecklistError) return json(err.status, { error: err.message });
    console.error("[portal] upload complete failed", err instanceof Error ? err.message : err);
    return json(500, { error: "We couldn't confirm the upload. Please try again." });
  }
}
