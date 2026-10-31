import { NextResponse } from "next/server";
import { z } from "zod";
import { streamAdvisor } from "@/lib/ai/advisor";
import { getMarketSnapshot } from "@/lib/rates";
import { clientIp, rateLimit } from "@/lib/security";

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4_000) }))
    .min(1)
    .max(20)
    .refine((m) => m[0]?.role === "user" && m.at(-1)?.role === "user", "Conversation must start and end with a user turn"),
  mode: z.enum(["chat", "term_sheet"]).default("chat"),
  dealContext: z.string().max(6_000).optional(),
});

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Kubera AI is not configured." }, { status: 503 });
  }
  if (!rateLimit(`ask:${clientIp(req)}`, 20, 10 * 60_000)) {
    return NextResponse.json({ error: "You're asking faster than we can underwrite. Try again in a few minutes." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const stream = await streamAdvisor({ ...parsed.data, market: await getMarketSnapshot() });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
