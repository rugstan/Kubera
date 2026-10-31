import { NextResponse } from "next/server";
import { applyLegalHold, legalHoldSchema } from "@/lib/privacy/legal-hold";
import { privacyAdminAuth, privacyServices } from "@/lib/privacy/server";

// Places or releases a legal hold on one record (compliance / counsel only).
// Bearer PRIVACY_ADMIN_TOKEN. Body: { table, id, hold, reason?, actor }.

const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request) {
  const auth = privacyAdminAuth(req);
  if (auth === "disabled") return NextResponse.json({ error: "Privacy admin API is not configured" }, { status: 503, headers: NO_STORE });
  if (auth !== "ok") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const parsed = legalHoldSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid legal hold", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400, headers: NO_STORE });
  }
  const services = privacyServices();
  if (!services) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503, headers: NO_STORE });

  try {
    const { found, patch } = await applyLegalHold(services.legalHolds, parsed.data);
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    console.info(`[privacy] legal hold ${patch.legal_hold ? "placed on" : "released from"} ${parsed.data.table}.${parsed.data.id} by ${patch.legal_hold_set_by}`);
    return NextResponse.json({ ok: true, table: parsed.data.table, id: parsed.data.id, ...patch }, { headers: NO_STORE });
  } catch (err) {
    console.error("legal hold update failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Update failed" }, { status: 500, headers: NO_STORE });
  }
}
