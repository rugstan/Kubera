import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";

// Twenty signs webhooks with HMAC-SHA256 over `${timestamp}:${rawBody}` using
// the secret set when the webhook is created in Settings → APIs & Webhooks.
const MAX_SKEW_MS = 5 * 60_000;

export async function POST(req: Request) {
  const secret = process.env.TWENTY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });

  const raw = await req.text();
  const signature = req.headers.get("x-twenty-webhook-signature") ?? "";
  const timestamp = req.headers.get("x-twenty-webhook-timestamp") ?? "";
  const expected = createHmac("sha256", secret).update(`${timestamp}:${raw}`).digest("hex");
  const ts = Number(timestamp);
  const fresh = Number.isFinite(ts) && Math.abs(Date.now() - (ts < 1e12 ? ts * 1000 : ts)) < MAX_SKEW_MS;
  if (!fresh || !safeEqual(signature, expected)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { eventName?: string; record?: { id?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from("crm_events").insert({
      event_name: payload.eventName ?? "unknown",
      record_id: payload.record?.id ?? null,
      payload,
    });
    if (error) console.error("crm event insert failed", error.message);
  }
  return NextResponse.json({ ok: true });
}
