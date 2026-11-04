import { z } from "zod";
import { isActionable, markVerified, OPEN_STATUSES, PrivacyRequestStateError } from "@/lib/privacy/requests";
import { privacyServices } from "@/lib/privacy/server";
import { auditPrivacy, privacyJson, privacyStaff, type PrivacyStaff } from "@/lib/privacy/staff";

// Compliance actions on one privacy request. Staff session with MFA (aal2)
// and an admin role (lib/privacy/staff.ts); the actor recorded on the request
// is the signed-in administrator, and each read or change is written to
// staff_audit_events before it takes effect.
//   GET   → the ticket
//   POST  { action: "acknowledge" | "verify" | "complete" | "deny" | "withdraw", note?, reason? }

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge") }),
  z.object({ action: z.literal("verify") }),
  z.object({ action: z.literal("complete"), note: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("deny"), reason: z.string().trim().min(5).max(2000) }),
  z.object({ action: z.literal("withdraw") }),
]);

type Ctx = { params: Promise<{ id: string }> };

type Authorized = { ok: true; id: string; staff: PrivacyStaff; services: NonNullable<ReturnType<typeof privacyServices>> } | { ok: false; response: Response };

async function authorize(req: Request, ctx: Ctx, mutation: boolean): Promise<Authorized> {
  const auth = await privacyStaff(req, { mutation });
  if (!auth.ok) return auth;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return { ok: false, response: privacyJson(404, { error: "Not found" }) };
  const services = privacyServices();
  if (!services) return { ok: false, response: privacyJson(503, { error: "Supabase is not configured" }) };
  return { ok: true, id, staff: auth.staff, services };
}

export async function GET(req: Request, ctx: Ctx) {
  const a = await authorize(req, ctx, false);
  if (!a.ok) return a.response;
  const row = await a.services.requests.get(a.id);
  if (!row) return privacyJson(404, { error: "Not found" });
  const denied = await auditPrivacy(a.staff, "privacy.view", { type: "privacy_request", id: row.id }, { requestType: row.request_type, status: row.status });
  if (denied) return denied;
  return privacyJson(200, { request: row });
}

export async function POST(req: Request, ctx: Ctx) {
  const a = await authorize(req, ctx, true);
  if (!a.ok) return a.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return privacyJson(400, { error: "Invalid JSON" });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return privacyJson(400, { error: "Invalid action" });

  const { requests } = a.services;
  const row = await requests.get(a.id);
  if (!row) return privacyJson(404, { error: "Not found" });
  const now = new Date().toISOString();
  const input = parsed.data;
  const by = a.staff.actor;

  try {
    // State checks first, so a refused action is not recorded as done.
    if (input.action === "complete") {
      // Deletion requests close through the retention engine, which records what was kept and why.
      if (row.request_type === "deletion") throw new PrivacyRequestStateError("Deletion requests are completed by the retention run");
      if (!isActionable(row)) throw new PrivacyRequestStateError(`Request is ${row.status}; verify it first`);
    }
    if ((input.action === "deny" || input.action === "withdraw") && !OPEN_STATUSES.includes(row.status)) throw new PrivacyRequestStateError(`Request is already ${row.status}`);
    if (input.action === "verify" && row.status !== "pending_verification") throw new PrivacyRequestStateError(`Request is ${row.status}, not pending verification`);

    const denied = await auditPrivacy(a.staff, `privacy.${input.action}`, { type: "privacy_request", id: row.id }, { requestType: row.request_type, fromStatus: row.status });
    if (denied) return denied;

    switch (input.action) {
      case "acknowledge":
        await requests.update(a.id, { acknowledged_at: now, resolution: { ...row.resolution, acknowledgedBy: by } });
        break;
      case "verify":
        await markVerified(requests, a.id, by);
        break;
      case "complete":
        await requests.update(a.id, { status: "completed", completed_at: now, resolution: { ...row.resolution, completedBy: by, note: input.note ?? null } });
        break;
      case "deny":
        await requests.update(a.id, { status: "denied", completed_at: now, denial_reason: input.reason, resolution: { ...row.resolution, deniedBy: by } });
        break;
      case "withdraw":
        await requests.update(a.id, { status: "withdrawn", completed_at: now, resolution: { ...row.resolution, withdrawnRecordedBy: by } });
        break;
    }
  } catch (err) {
    if (err instanceof PrivacyRequestStateError) return privacyJson(409, { error: err.message });
    console.error("privacy request action failed", err instanceof Error ? err.message : err);
    return privacyJson(500, { error: "Action failed" });
  }
  return privacyJson(200, { ok: true, request: await requests.get(a.id) });
}
