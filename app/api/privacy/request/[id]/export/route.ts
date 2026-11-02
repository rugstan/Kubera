import { NextResponse } from "next/server";
import { z } from "zod";
import { piiKeyring } from "@/lib/privacy/crypto";
import { buildSubjectExport, canonicalJson, exportSha256 } from "@/lib/privacy/export";
import { isActionable } from "@/lib/privacy/requests";
import { privacyServices } from "@/lib/privacy/server";
import { auditPrivacy, privacyJson, privacyStaff, requirePrivacyStepUp, totpSchema } from "@/lib/privacy/staff";

// Access-request export for a verified request. Compliance downloads the JSON
// and sends it to the requester through a secure channel; the export itself
// is never stored, only its hash and time (privacy_requests.export_*).
//
// The export decrypts every PII field for the subject (principals' SSN, DOB,
// PFS), so: POST { totp } from an administrator with an aal2 staff session
// plus a fresh authenticator code (step-up), and a staff_audit_events row
// (privacy.export: who, when, which request) is written before any decrypted
// data is built or returned. No audit row, no export.

const bodySchema = z.object({ totp: totpSchema.optional() });

export async function GET() {
  return privacyJson(405, { error: "Use POST with a fresh authenticator code (totp) to generate the export." });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await privacyStaff(req, { mutation: true });
  if (!auth.ok) return auth.response;
  const { staff } = auth;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return privacyJson(404, { error: "Not found" });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return privacyJson(400, { error: "Invalid JSON" });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return privacyJson(400, { error: "Invalid request" });
  const services = privacyServices();
  if (!services) return privacyJson(503, { error: "Supabase is not configured" });

  const row = await services.requests.get(id);
  if (!row) return privacyJson(404, { error: "Not found" });
  if (row.request_type !== "access") return privacyJson(409, { error: "Only access requests produce an export" });
  if (!isActionable(row)) return privacyJson(409, { error: `Request is ${row.status}; verify the requester before exporting` });

  const target = { type: "privacy_request", id: row.id };
  const stepUp = await requirePrivacyStepUp(staff, parsed.data.totp, { action: "privacy.export", target });
  if (stepUp) return stepUp;
  const denied = await auditPrivacy(staff, "privacy.export", target, { requestType: row.request_type, stepUp: "totp" });
  if (denied) return denied;

  try {
    const now = new Date();
    const doc = await buildSubjectExport(services.subjects, row.subject_email, { now, requestId: row.id, keyring: piiKeyring(), phones: row.subject_phone ? [row.subject_phone] : [] });
    const sha = exportSha256(doc);
    await services.requests.update(row.id, {
      status: "in_progress",
      export_generated_at: now.toISOString(),
      export_sha256: sha,
      resolution: { ...row.resolution, exportedBy: staff.actor, exportedAt: now.toISOString() },
    });
    return new NextResponse(canonicalJson(doc), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="corin-privacy-export-${row.id}.json"`,
        "x-export-sha256": sha,
      },
    });
  } catch (err) {
    console.error("privacy export failed", err instanceof Error ? err.message : err);
    return privacyJson(500, { error: "Export failed" });
  }
}
