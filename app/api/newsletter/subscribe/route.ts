import { NextResponse } from "next/server";
import { consentPage, readConsentMeta } from "@/lib/consent/request";
import { newsletterService } from "@/lib/newsletter/runtime";
import { subscribeSchema } from "@/lib/newsletter/schema";
import { guardPost } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" };

// Same answer whether the address is new, pending or already subscribed, so the
// form cannot be used to find out who is on the list.
const CHECK_INBOX = "Check your inbox for a confirmation link. You are not subscribed until you click it.";

export async function POST(req: Request) {
  const guard = await guardPost(req, {
    name: "newsletter",
    rate: { limit: 5, windowMs: 60 * 60_000 },
    rateLimitMessage: "Too many signups from this connection. Please try again later.",
    // The qualifier's widget action: a lead-form action that already exists. See the WS-P report.
    turnstile: "qualify",
    maxBytes: 8_000,
  });
  if (!guard.ok) return guard.response;

  const parsed = subscribeSchema.safeParse(guard.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the form.", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400, headers: NO_STORE },
    );
  }

  const meta = readConsentMeta(guard.body);
  const outcome = await newsletterService().subscribe({
    email: parsed.data.email,
    textVersion: meta.textVersion,
    ip: guard.ip,
    userAgent: req.headers.get("user-agent"),
    page: consentPage(req, meta.page, "/newsletter"),
  });

  switch (outcome.status) {
    case "invalid_email":
      return NextResponse.json({ error: "Please check the form.", issues: [{ path: "email", message: "Enter a valid email address." }] }, { status: 400, headers: NO_STORE });
    case "unavailable":
      return NextResponse.json({ error: "Newsletter signup is unavailable right now. Please try again later." }, { status: 503, headers: NO_STORE });
    default:
      return NextResponse.json({ ok: true, message: CHECK_INBOX }, { headers: NO_STORE });
  }
}
