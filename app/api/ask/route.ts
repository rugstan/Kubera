import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { staffForMutation } from "@/lib/auth/dal";
import { dealContextSchema, streamAdvisorTurn } from "@/lib/ai/advisor";
import { conversationStore, MAX_TURNS, type Conversation } from "@/lib/conversations/store";
import { routingSubject } from "@/lib/privacy/requests";
import { privacyServices } from "@/lib/privacy/server";
import { getMarketSnapshot } from "@/lib/rates";
import { checkTurnstile, guardPost, hashIp } from "@/lib/security";

// Staff-only assistant. The public site no longer offers it, so every request
// must carry a signed-in staff session with MFA; anonymous callers are refused
// before any key check, rate-limit budget, captcha, conversation write or model
// call.
//
// Protocol: the client sends only its conversation id (omitted on the first
// message) and the new user message. The server owns the transcript, so
// assistant turns cannot be forged. The reply streams as text/plain; the
// conversation id comes back in the `x-conversation-id` header.

const bodySchema = z.object({
  conversationId: z.uuid().optional(),
  message: z.string().trim().min(1).max(4_000),
  mode: z.enum(["chat", "term_sheet"]).default("chat"),
  dealContext: dealContextSchema.optional(),
});

/** How long a turn may hold the conversation lock before another request can take it. */
const TURN_LOCK_MS = 120_000;

const error = (status: number, message: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error: message, ...extra }, { status, headers: { "cache-control": "no-store" } });

/** The signed-in staff member (MFA verified), or the refusal to send back. */
async function staffOnly(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const auth = await staffForMutation();
  if (auth.ok) return { ok: true };
  return { ok: false, response: error(auth.status, auth.status === 403 ? "Not allowed" : "Staff sign-in required") };
}

/**
 * Availability probe for staff tools. Side-effect free: no rate-limit budget,
 * no Turnstile, no model call. Signed-out callers get 401 and never learn
 * whether a model key is configured.
 */
export async function GET() {
  // Session and key are evaluated per request, never at build time.
  await connection();
  const auth = await staffOnly();
  if (!auth.ok) return auth.response;
  if (!process.env.ANTHROPIC_API_KEY) return error(503, "The assistant is not configured.");
  return NextResponse.json({ available: true }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  // First statement: nothing below runs, and nothing is spent, for a caller who is not staff.
  const auth = await staffOnly();
  if (!auth.ok) return auth.response;
  if (!process.env.ANTHROPIC_API_KEY) return error(503, "The assistant is not configured.");

  const guard = await guardPost(req, {
    name: "ask",
    rate: { limit: 20, windowMs: 10 * 60_000 },
    rateLimitMessage: "You're asking faster than we can underwrite. Try again in a few minutes.",
    maxBytes: 16_000,
  });
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(guard.body);
  if (!parsed.success) return error(400, "Invalid request");
  const { conversationId, message, mode, dealContext } = parsed.data;

  const store = conversationStore();
  let conversation: Conversation;
  try {
    if (!conversationId) {
      // Starting a conversation is the bot-protected step; follow-up turns
      // ride on the unguessable conversation id plus the rate limit.
      const failure = await checkTurnstile(req, "ask", guard.ip);
      if (failure) return failure;
      const created = await store.create({ ipHash: hashIp(guard.ip), userAgent: req.headers.get("user-agent"), page: refererPath(req) });
      const claimed = await store.claim(created.id, TURN_LOCK_MS);
      if (claimed.status !== "ok") return error(500, "Could not start a conversation.");
      conversation = claimed.conversation;
    } else {
      const claimed = await store.claim(conversationId, TURN_LOCK_MS);
      if (claimed.status === "not_found") return error(404, "This conversation has expired. Start a new one.", { code: "conversation_not_found" });
      if (claimed.status === "busy") return error(409, "The assistant is still answering your last question.", { code: "conversation_busy" });
      conversation = claimed.conversation;
    }
  } catch (err) {
    console.error("conversation store failed", err instanceof Error ? err.message : err);
    return error(503, "The assistant is temporarily unavailable.");
  }

  if (conversation.turnCount >= MAX_TURNS) {
    await store.release(conversation.id);
    return error(409, "This conversation has reached its limit. Start a new one to keep going.", { code: "conversation_full" });
  }

  try {
    const subject = await conversationSubject(conversation);
    const stream = await streamAdvisorTurn({
      conversationId: conversation.id,
      history: conversation.messages,
      turnCount: conversation.turnCount,
      message,
      mode,
      dealContext,
      market: await getMarketSnapshot(),
      store,
      ...(subject ? { subject } : {}),
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-conversation-id": conversation.id,
      },
    });
  } catch (err) {
    console.error("advisor start failed", err instanceof Error ? err.message : err);
    await store.release(conversation.id);
    return error(503, "The assistant is temporarily unavailable.");
  }
}

/**
 * The data subject's AI preference when the conversation is tied to a lead, so
 * the routing guard refuses personal data from someone who opted out of AI
 * processing (privacy request type human_review). Anonymous conversations have
 * no known subject.
 */
async function conversationSubject(conversation: Conversation): Promise<{ aiProcessingOptOut: boolean } | null> {
  if (!conversation.leadId) return null;
  const services = privacyServices();
  if (!services) return null;
  const email = await services.leadEmail(conversation.leadId);
  // A tied lead whose email cannot be read cannot be shown to have no opt-out.
  if (!email) return { aiProcessingOptOut: true };
  const subject = await routingSubject(services.requests, email);
  return { aiProcessingOptOut: subject.aiProcessingOptOut || subject.humanReviewOnly };
}

function refererPath(req: Request): string | null {
  const ref = req.headers.get("referer");
  if (!ref) return null;
  try {
    return new URL(ref).pathname;
  } catch {
    return null;
  }
}
