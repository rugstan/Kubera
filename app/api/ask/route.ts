import { NextResponse } from "next/server";
import { z } from "zod";
import { dealContextSchema, streamAdvisorTurn } from "@/lib/ai/advisor";
import { conversationStore, MAX_TURNS, type Conversation } from "@/lib/conversations/store";
import { getMarketSnapshot } from "@/lib/rates";
import { checkTurnstile, guardPost, hashIp } from "@/lib/security";

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

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return error(503, "Kubera AI is not configured.");

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
      if (claimed.status === "busy") return error(409, "Kubera AI is still answering your last question.", { code: "conversation_busy" });
      conversation = claimed.conversation;
    }
  } catch (err) {
    console.error("conversation store failed", err instanceof Error ? err.message : err);
    return error(503, "Kubera AI is temporarily unavailable.");
  }

  if (conversation.turnCount >= MAX_TURNS) {
    await store.release(conversation.id);
    return error(409, "This conversation has reached its limit. Start a new one to keep going.", { code: "conversation_full" });
  }

  try {
    const stream = await streamAdvisorTurn({
      conversationId: conversation.id,
      history: conversation.messages,
      turnCount: conversation.turnCount,
      message,
      mode,
      dealContext,
      market: await getMarketSnapshot(),
      store,
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
    return error(503, "Kubera AI is temporarily unavailable.");
  }
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
