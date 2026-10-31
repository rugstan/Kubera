import { NextResponse } from "next/server";
import { consentPage } from "@/lib/consent/request";
import { newsletterService } from "@/lib/newsletter/runtime";
import { tokenSchema } from "@/lib/newsletter/schema";
import { guardPost } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" };

// Posted by the unsubscribe page when the person presses the button.
export async function POST(req: Request) {
  const guard = await guardPost(req, { name: "newsletter-unsubscribe", rate: { limit: 20, windowMs: 60 * 60_000 }, maxBytes: 2_000 });
  if (!guard.ok) return guard.response;

  const parsed = tokenSchema.safeParse(guard.body);
  if (!parsed.success) return NextResponse.json({ error: "This link is not valid.", reason: "invalid" }, { status: 400, headers: NO_STORE });

  const outcome = await newsletterService().unsubscribeWithToken(parsed.data.token, {
    ip: guard.ip,
    userAgent: req.headers.get("user-agent"),
    page: consentPage(req, undefined, "/newsletter/unsubscribe"),
  });

  if (outcome.status === "unsubscribed" || outcome.status === "already_unsubscribed") return NextResponse.json({ ok: true, status: outcome.status }, { headers: NO_STORE });
  if (outcome.status === "unavailable") return NextResponse.json({ error: "We could not process this right now. Please try again in a few minutes." }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ error: "This link is not valid. Reply to any newsletter email and we will remove you.", reason: "invalid" }, { status: 400, headers: NO_STORE });
}
