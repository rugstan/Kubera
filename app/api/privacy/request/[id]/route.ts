import { NextResponse } from "next/server";
import { z } from "zod";
import { isActionable, markVerified, OPEN_STATUSES, PrivacyRequestStateError } from "@/lib/privacy/requests";
import { privacyAdminAuth, privacyServices } from "@/lib/privacy/server";

// Compliance staff actions on one privacy request (interim API until the
// staff app, WS-I, wraps it). Bearer PRIVACY_ADMIN_TOKEN.
//   GET   → the ticket
//   POST  { action: "acknowledge" | "verify" | "complete" | "deny" | "withdraw", by, note?, reason? }

const NO_STORE = { "cache-control": "no-store" };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge"), by: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("verify"), by: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("complete"), by: z.string().trim().min(2).max(200), note: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("deny"), by: z.string().trim().min(2).max(200), reason: z.string().trim().min(5).max(2000) }),
  z.object({ action: z.literal("withdraw"), by: z.string().trim().min(2).max(200) }),
]);

type Ctx = { params: Promise<{ id: string }> };

type Authorized = { ok: true; id: string; services: NonNullable<ReturnType<typeof privacyServices>> } | { ok: false; response: NextResponse };

async function authorize(req: Request, ctx: Ctx): Promise<Authorized> {
  const auth = privacyAdminAuth(req);
  if (auth === "disabled") return { ok: false, response: NextResponse.json({ error: "Privacy admin API is not configured" }, { status: 503, headers: NO_STORE }) };
  if (auth !== "ok") return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE }) };
  const services = privacyServices();
  if (!services) return { ok: false, response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503, headers: NO_STORE }) };
  return { ok: true, id, services };
}

export async function GET(req: Request, ctx: Ctx) {
  const a = await authorize(req, ctx);
  if (!a.ok) return a.response;
  const row = await a.services.requests.get(a.id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ request: row }, { headers: NO_STORE });
}

export async function POST(req: Request, ctx: Ctx) {
  const a = await authorize(req, ctx);
  if (!a.ok) return a.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400, headers: NO_STORE });

  const { requests } = a.services;
  const row = await requests.get(a.id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const now = new Date().toISOString();
  const input = parsed.data;

  try {
    switch (input.action) {
      case "acknowledge":
        await requests.update(a.id, { acknowledged_at: now, resolution: { ...row.resolution, acknowledgedBy: input.by } });
        break;
      case "verify":
        await markVerified(requests, a.id, input.by);
        break;
      case "complete":
        // Deletion requests close through the retention engine, which records what was kept and why.
        if (row.request_type === "deletion") throw new PrivacyRequestStateError("Deletion requests are completed by the retention run");
        if (!isActionable(row)) throw new PrivacyRequestStateError(`Request is ${row.status}; verify it first`);
        await requests.update(a.id, { status: "completed", completed_at: now, resolution: { ...row.resolution, completedBy: input.by, note: input.note ?? null } });
        break;
      case "deny":
        if (!OPEN_STATUSES.includes(row.status)) throw new PrivacyRequestStateError(`Request is already ${row.status}`);
        await requests.update(a.id, { status: "denied", completed_at: now, denial_reason: input.reason, resolution: { ...row.resolution, deniedBy: input.by } });
        break;
      case "withdraw":
        if (!OPEN_STATUSES.includes(row.status)) throw new PrivacyRequestStateError(`Request is already ${row.status}`);
        await requests.update(a.id, { status: "withdrawn", completed_at: now, resolution: { ...row.resolution, withdrawnRecordedBy: input.by } });
        break;
    }
  } catch (err) {
    if (err instanceof PrivacyRequestStateError) return NextResponse.json({ error: err.message }, { status: 409, headers: NO_STORE });
    console.error("privacy request action failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Action failed" }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, request: await requests.get(a.id) }, { headers: NO_STORE });
}
