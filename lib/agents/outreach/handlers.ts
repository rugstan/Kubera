import { z } from "zod";
import { cronAuthFailure, internalAuthFailure } from "@/lib/notify/handlers";
import type { SpeedToLeadDeps } from "./speed-to-lead";
import { speedToLead } from "./speed-to-lead";
import type { OutreachSources } from "./sources";
import { runOutreachSweep, type SweepDeps } from "./sweep";
import type { CallRequestInput, VoiceService } from "./voice/service";

// Request handlers behind the chasers' routes. The route files (cross-requests)
// only supply the runtime; tests drive these with fakes. Like WS-J's triggers
// they are internal: callers authenticate with a bearer secret and pass ids,
// never contact details.
//
//   POST /api/outreach/speed-to-lead   { leadId }       NOTIFY_INTERNAL_SECRET
//   GET  /api/outreach/sweep                            CRON_SECRET
//   POST /api/outreach/call            { ...call }      NOTIFY_INTERNAL_SECRET

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 16_000) return { ok: false, response: json({ error: "Request is too large" }, 413) };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON" }, 400) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: json({ error: "Invalid request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400) };
  }
  return { ok: true, data: parsed.data };
}

export async function handleSpeedToLead(req: Request, deps: SpeedToLeadDeps & { sources: Pick<OutreachSources, "lead"> }): Promise<Response> {
  const denied = internalAuthFailure(req);
  if (denied) return denied;
  const body = await readJson(req, z.object({ leadId: z.uuid() }));
  if (!body.ok) return body.response;
  const lead = await deps.sources.lead(body.data.leadId);
  if (!lead) return json({ error: "Lead not found" }, 404);
  const r = await speedToLead(lead, deps);
  return json({
    ok: true,
    handled: r.handled,
    skipped: r.skipped,
    sent: r.sent,
    latencyMs: r.latencyMs,
    withinSla: r.withinSla,
    sms: r.sms?.reason,
    email: r.email?.reason,
    escalated: r.escalated,
  });
}

export async function handleSweep(req: Request, deps: SweepDeps): Promise<Response> {
  const denied = cronAuthFailure(req);
  if (denied) return denied;
  const summary = await runOutreachSweep(deps);
  return json({ ok: true, ...summary });
}

const callBody = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    mode: z.enum(["human_assisted", "ai_voice"]),
    to: z.string().trim().min(7).max(40),
    scriptId: z.string().trim().min(1).max(60),
    record: z.boolean().default(false),
    handoffNumber: z.string().trim().max(40).nullish(),
    leadId: z.uuid().nullish(),
    dealId: z.uuid().nullish(),
    scriptData: z.object({ firstName: z.string().trim().max(80).nullish(), count: z.number().int().min(1).max(50).nullish() }).nullish(),
  })
  .strict();

/** Staff-initiated call request (the route is called by the staff app server-side, never from a browser). */
export async function handleCallRequest(req: Request, deps: { voice: Pick<VoiceService, "requestCall"> | null }): Promise<Response> {
  const denied = internalAuthFailure(req);
  if (denied) return denied;
  if (!deps.voice) return json({ error: "Voice calling is not configured" }, 503);
  const body = await readJson(req, callBody);
  if (!body.ok) return body.response;
  const outcome = await deps.voice.requestCall({ ...body.data, scriptData: body.data.scriptData ?? undefined } satisfies CallRequestInput);
  return json({ ok: outcome.status !== "blocked" && outcome.status !== "failed", ...outcome });
}
