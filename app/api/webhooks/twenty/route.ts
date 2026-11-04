import { createHash, createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { readBodyCapped, safeEqual } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";

// Twenty signs webhooks with HMAC-SHA256 over `${timestamp}:${rawBody}` using
// the secret set when the webhook is created in Settings → APIs & Webhooks.
const MAX_SKEW_MS = 5 * 60_000;
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: Request) {
  const secret = process.env.TWENTY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });

  // Cap the body before buffering or hashing it: this route is reachable unauthenticated.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  const raw = await readBodyCapped(req, MAX_BODY_BYTES);
  if (raw === null) return NextResponse.json({ error: "Request is too large" }, { status: 413 });

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
    // A signed delivery is accepted once: a redelivery or replay carries the same signed
    // timestamp and body, maps to the same key and hits the unique index (23505).
    const dedupeKey = createHash("sha256").update(`${timestamp}:${raw}`).digest("hex");
    const { error } = await db.from("crm_events").insert({
      dedupe_key: dedupeKey,
      event_name: payload.eventName ?? "unknown",
      record_id: payload.record?.id ?? null,
      payload,
    });
    if (error && error.code !== "23505") console.error("crm event insert failed", error.message);
  }
  return NextResponse.json({ ok: true });
}
