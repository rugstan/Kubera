import { NextResponse } from "next/server";
import { newsletterService } from "@/lib/newsletter/runtime";
import { handleResendEvent, svixHeaders, verifySvixSignature } from "@/lib/newsletter/webhook";
import { readBodyCapped } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" };

// Resend webhook for audience events (contact unsubscribes, spam complaints).
// Configure it in Resend with the contact.updated and email.complained events
// and set RESEND_WEBHOOK_SECRET to its signing secret. Without the secret the
// endpoint answers 503, so it can never be used unsigned.
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503, headers: NO_STORE });

  const raw = await readBodyCapped(req, 64_000);
  if (raw === null) return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: NO_STORE });
  if (!verifySvixSignature(secret, raw, svixHeaders(req.headers))) return NextResponse.json({ error: "Invalid signature." }, { status: 401, headers: NO_STORE });

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: NO_STORE });
  }

  const outcome = await handleResendEvent(event, newsletterService(), { audienceId: process.env.RESEND_AUDIENCE_ID?.trim() || undefined });
  return NextResponse.json({ ok: true, ...outcome }, { headers: NO_STORE });
}
