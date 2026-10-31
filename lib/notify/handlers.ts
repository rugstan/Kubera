import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { LeadSource } from "./leads";
import { sendLeadConfirmation } from "./lead-confirmation";
import type { Notifier } from "./service";
import { notifyStageEvent } from "./stage-events";
import { alertTier1Lead, type StaffContacts } from "./tier1";

// Request handlers behind app/api/notify/*. The routes only supply the real
// runtime; tests drive these with fakes. All of them are internal endpoints:
// callers (the qualifier route, workflows, Vercel Cron) authenticate with a
// bearer secret and pass ids, never contact details.

export type NotifyHandlerDeps = {
  notifier: Notifier;
  leads: LeadSource;
  staff: StaffContacts;
  now?: () => Date;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function bearerOk(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Internal trigger auth: Authorization: Bearer $NOTIFY_INTERNAL_SECRET. Returns a response to send, or null when authorized. */
export function internalAuthFailure(req: Request, env: Record<string, string | undefined> = process.env): Response | null {
  const secret = env.NOTIFY_INTERNAL_SECRET;
  if (!secret) return json({ error: "NOTIFY_INTERNAL_SECRET is not configured" }, 503);
  return bearerOk(req, secret) ? null : json({ error: "Unauthorized" }, 401);
}

/** Cron auth: Authorization: Bearer $CRON_SECRET (what Vercel Cron sends). */
export function cronAuthFailure(req: Request, env: Record<string, string | undefined> = process.env): Response | null {
  const secret = env.CRON_SECRET;
  if (!secret) return json({ error: "CRON_SECRET is not configured" }, 503);
  return bearerOk(req, secret) ? null : json({ error: "Unauthorized" }, 401);
}

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

const leadIdBody = z.object({ leadId: z.uuid() });

export async function handleTier1(req: Request, deps: NotifyHandlerDeps): Promise<Response> {
  const denied = internalAuthFailure(req);
  if (denied) return denied;
  const body = await readJson(req, leadIdBody);
  if (!body.ok) return body.response;
  const lead = await deps.leads.get(body.data.leadId);
  if (!lead) return json({ error: "Lead not found" }, 404);
  const result = await alertTier1Lead(lead, deps.notifier, deps.staff, deps.now);
  return json({ ok: true, ...summarizeTier1(result) });
}

export async function handleLeadConfirmation(req: Request, deps: NotifyHandlerDeps): Promise<Response> {
  const denied = internalAuthFailure(req);
  if (denied) return denied;
  const body = await readJson(req, leadIdBody);
  if (!body.ok) return body.response;
  const lead = await deps.leads.get(body.data.leadId);
  if (!lead) return json({ error: "Lead not found" }, 404);
  const outcome = await sendLeadConfirmation(lead, deps.notifier);
  return json({ ok: true, status: outcome.status, reason: outcome.reason });
}

const stageEventBody = z.object({
  eventId: z.string().trim().min(1).max(120),
  stage: z.string().trim().min(1).max(80),
  previousStage: z.string().trim().max(80).nullish(),
  dealId: z.uuid().nullish(),
  leadId: z.uuid().nullish(),
  /** For deals that have no lead row. Without it the contact is read from the lead. */
  contact: z
    .object({ firstName: z.string().trim().min(1).max(80), email: z.email().max(320).nullish(), phone: z.string().trim().max(40).nullish() })
    .nullish(),
});

export async function handleStageEvent(req: Request, deps: NotifyHandlerDeps): Promise<Response> {
  const denied = internalAuthFailure(req);
  if (denied) return denied;
  const body = await readJson(req, stageEventBody);
  if (!body.ok) return body.response;
  const e = body.data;

  let contact = e.contact ?? null;
  if (!contact && e.leadId) {
    const lead = await deps.leads.get(e.leadId);
    if (!lead) return json({ error: "Lead not found" }, 404);
    contact = { firstName: lead.contact.firstName, email: lead.contact.email, phone: lead.contact.phone };
  }
  if (!contact) return json({ error: "Provide a leadId or a contact" }, 400);

  const result = await notifyStageEvent(
    { eventId: e.eventId, stage: e.stage, previousStage: e.previousStage, dealId: e.dealId, leadId: e.leadId, contact },
    deps.notifier,
  );
  return json({ ok: true, milestone: result.milestone, skipped: result.skipped, email: result.email?.status, sms: result.sms?.status });
}

/** How far back the sweep looks for Tier-1 leads that were never alerted. */
export const SWEEP_WINDOW_MS = 30 * 60_000;

/** Cron backstop: alerts any recent Tier-1 lead the in-request trigger missed. Idempotent, so already-alerted leads are skipped. */
export async function handleSweep(req: Request, deps: NotifyHandlerDeps): Promise<Response> {
  const denied = cronAuthFailure(req);
  if (denied) return denied;
  const now = deps.now ?? (() => new Date());
  const since = new Date(now().getTime() - SWEEP_WINDOW_MS).toISOString();
  const leads = await deps.leads.recentTier1(since);
  let alerted = 0;
  let alreadyDone = 0;
  for (const lead of leads) {
    const result = await alertTier1Lead(lead, deps.notifier, deps.staff, now);
    const newlySent = [...result.sms, ...result.email].some((o) => o.status === "sent");
    if (newlySent) alerted += 1;
    else alreadyDone += 1;
  }
  return json({ ok: true, checked: leads.length, alerted, alreadyDone });
}

function summarizeTier1(r: Awaited<ReturnType<typeof alertTier1Lead>>) {
  return {
    alerted: r.alerted,
    skipped: r.skipped,
    latencyMs: r.latencyMs,
    withinSla: r.withinSla,
    sms: r.sms.map((o) => o.status),
    email: r.email.map((o) => o.status),
  };
}
