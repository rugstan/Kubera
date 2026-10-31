import { NextResponse } from "next/server";
import { privacyRequestSchema, submitPrivacyRequest, type PrivacyRequestType, type SubmitResult } from "@/lib/privacy/requests";
import { privacyServices } from "@/lib/privacy/server";
import { guardPost, hashIp } from "@/lib/security";
import { site } from "@/lib/site";

// Public intake for California privacy requests (access/export, deletion,
// correction, human-review / AI opt-out, opt-out of sale or sharing). Each
// request becomes a ticket in the compliance@ queue (public.privacy_requests).
// Opt-outs take effect immediately; everything else waits for verification,
// and nothing about a person is ever returned from this endpoint.

const NO_STORE = { "cache-control": "no-store" };

function message(type: PrivacyRequestType, r: SubmitResult): string {
  if (type === "human_review") return "Done. An advisor will handle your requests personally, and we will not send your personal information to AI tools.";
  if (type === "opt_out_sale_share") return "Recorded. We do not sell or share personal information, and we have noted your opt-out.";
  if (r.verified) return `We received your request and verified it. We will respond by ${r.dueAt}.`;
  return `We received your request. To protect you, we will verify your identity before we act on it, usually by email. We will respond by ${r.dueAt}.`;
}

export async function POST(req: Request) {
  const guard = await guardPost(req, {
    name: "privacy",
    rate: { limit: 5, windowMs: 60 * 60_000 },
    rateLimitMessage: `Too many requests. Please email ${site.privacyEmail}.`,
    turnstile: false,
    maxBytes: 16_000,
  });
  if (!guard.ok) return guard.response;

  const parsed = privacyRequestSchema.safeParse(guard.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the form.", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400, headers: NO_STORE },
    );
  }

  const services = privacyServices();
  if (!services) {
    console.warn("privacy request received but Supabase is not configured");
    return NextResponse.json({ error: `We can't take requests online right now. Please email ${site.privacyEmail}.` }, { status: 503, headers: NO_STORE });
  }

  try {
    const result = await submitPrivacyRequest(
      parsed.data,
      { store: services.requests, verifyLeadToken: services.verifyLeadToken, leadEmail: services.leadEmail },
      { ipHash: hashIp(guard.ip), userAgent: req.headers.get("user-agent") },
    );
    return NextResponse.json(
      {
        ok: true,
        reference: result.id,
        type: result.type,
        status: result.status,
        acknowledgeBy: result.acknowledgeBy,
        respondBy: result.dueAt,
        message: message(result.type, result),
      },
      { status: result.duplicate ? 200 : 201, headers: NO_STORE },
    );
  } catch (err) {
    console.error("privacy request failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: `Something went wrong. Please email ${site.privacyEmail}.` }, { status: 500, headers: NO_STORE });
  }
}
