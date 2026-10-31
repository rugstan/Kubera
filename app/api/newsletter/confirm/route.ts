import { NextResponse } from "next/server";
import { consentPage } from "@/lib/consent/request";
import { newsletterService } from "@/lib/newsletter/runtime";
import { tokenSchema } from "@/lib/newsletter/schema";
import { guardPost } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" };

// The confirmation page posts here when the person presses the button. A GET
// never changes anything, so an email scanner that opens the link cannot
// confirm (or unsubscribe) on someone's behalf.
export async function POST(req: Request) {
  const guard = await guardPost(req, { name: "newsletter-confirm", rate: { limit: 20, windowMs: 60 * 60_000 }, maxBytes: 2_000 });
  if (!guard.ok) return guard.response;

  const parsed = tokenSchema.safeParse(guard.body);
  if (!parsed.success) return NextResponse.json({ error: "This link is not valid.", reason: "invalid" }, { status: 400, headers: NO_STORE });

  const outcome = await newsletterService().confirm(parsed.data.token, {
    ip: guard.ip,
    userAgent: req.headers.get("user-agent"),
    page: consentPage(req, undefined, "/newsletter/confirm"),
  });

  if (outcome.status === "confirmed" || outcome.status === "already_confirmed") return NextResponse.json({ ok: true, status: outcome.status }, { headers: NO_STORE });
  if (outcome.status === "unavailable") return NextResponse.json({ error: "We could not confirm right now. Please try the link again in a few minutes." }, { status: 503, headers: NO_STORE });
  if (outcome.status === "invalid" && outcome.reason === "expired") return NextResponse.json({ error: "This confirmation link has expired. Sign up again to get a new one.", reason: "expired" }, { status: 400, headers: NO_STORE });
  return NextResponse.json({ error: "This link is not valid. Sign up again to get a new confirmation email.", reason: "invalid" }, { status: 400, headers: NO_STORE });
}
