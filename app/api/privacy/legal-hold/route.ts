import { applyLegalHold, legalHoldRequestSchema } from "@/lib/privacy/legal-hold";
import { privacyServices } from "@/lib/privacy/server";
import { auditPrivacy, privacyJson, privacyStaff, requirePrivacyStepUp } from "@/lib/privacy/staff";

// Places or releases a legal hold on one record. Administrator with an aal2
// staff session (lib/privacy/staff.ts); the actor is the signed-in
// administrator, never the body. Releasing a hold (which lets retention and
// erasure delete the record) also needs a fresh authenticator code. The
// staff_audit_events row is written before the hold changes.
// Body: { table, id, hold, reason?, totp? }.

export async function POST(req: Request) {
  const auth = await privacyStaff(req, { mutation: true });
  if (!auth.ok) return auth.response;
  const { staff } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return privacyJson(400, { error: "Invalid JSON" });
  }
  const parsed = legalHoldRequestSchema.safeParse(body);
  if (!parsed.success) {
    return privacyJson(400, { error: "Invalid legal hold", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  const services = privacyServices();
  if (!services) return privacyJson(503, { error: "Supabase is not configured" });

  const { table, id, hold, reason, totp } = parsed.data;
  const target = { type: table, id };
  const action = hold ? "privacy.legal_hold_set" : "privacy.legal_hold_release";
  if (!hold) {
    const stepUp = await requirePrivacyStepUp(staff, totp, { action, target });
    if (stepUp) return stepUp;
  }
  const denied = await auditPrivacy(staff, action, target, { hold, ...(reason ? { reason } : {}), ...(hold ? {} : { stepUp: "totp" }) });
  if (denied) return denied;

  try {
    const { found, patch } = await applyLegalHold(services.legalHolds, { table, id, hold, reason, actor: staff.actor });
    if (!found) return privacyJson(404, { error: "Not found" });
    console.info(`[privacy] legal hold ${patch.legal_hold ? "placed on" : "released from"} ${table}.${id} by ${patch.legal_hold_set_by}`);
    return privacyJson(200, { ok: true, table, id, ...patch });
  } catch (err) {
    console.error("legal hold update failed", err instanceof Error ? err.message : err);
    return privacyJson(500, { error: "Update failed" });
  }
}
