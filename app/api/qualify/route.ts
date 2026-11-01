import { after, NextResponse } from "next/server";
import { recordHumanReviewQualifier, recordQualifierDecision } from "@/lib/agents/core/decisions";
import { agentSafety } from "@/lib/agents/core/server";
import { decide, HUMAN_REVIEW_ENGINE, humanReviewSummary, publicSummary, type JevResult } from "@/lib/ai/jev";
import { buildConsentEvent, recordConsent } from "@/lib/consent/ledger";
import { consentPage, readConsentMeta } from "@/lib/consent/request";
import { resolveConsentText } from "@/lib/consent/texts";
import { pushLead, twentyConfigured } from "@/lib/crm/twenty";
import { smsConsentLookup } from "@/lib/notify/consent";
import { sendLeadConfirmation } from "@/lib/notify/lead-confirmation";
import { notifyRuntime } from "@/lib/notify/runtime";
import { alertTier1Lead } from "@/lib/notify/tier1";
import { routingSubject } from "@/lib/privacy/requests";
import { privacyServices } from "@/lib/privacy/server";
import { getMarketSnapshot } from "@/lib/rates";
import { guardPost, signLeadToken } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendWorkflowEvent } from "@/lib/workflows/client";
import { EVENTS } from "@/lib/workflows/events";
import { leadSchema } from "@/lib/validation";

export async function POST(req: Request) {
  const guard = await guardPost(req, {
    name: "qualify",
    rate: { limit: 10, windowMs: 60 * 60_000 },
    rateLimitMessage: "Too many submissions. Please call us directly.",
    turnstile: "qualify",
  });
  if (!guard.ok) return guard.response;

  const parsed = leadSchema.safeParse(guard.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid submission", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  const { intake, contact } = parsed.data;
  const meta = readConsentMeta(guard.body);

  // Advisor-only handling (POST /api/privacy/request type human_review) means
  // no automated scoring and nothing sent to AI tools: Jev (rules and the
  // remote model) is skipped and an advisor reviews the request personally.
  // routingSubject fails closed when the preference lookup errors.
  const subject = await routingSubject(privacyServices()?.requests ?? null, contact.email);
  const humanReview = subject.humanReviewOnly || subject.aiProcessingOptOut;
  let jev: JevResult | null = null;
  if (!humanReview) {
    const market = await getMarketSnapshot();
    jev = await decide(intake, market.benchmarks);
  }

  const db = supabaseAdmin();
  let leadId: string | null = null;
  if (db) {
    // decision is NOT NULL in the schema; an empty object records "no decision".
    const row: Record<string, unknown> = jev
      ? { source: intake.source, contact, intake, decision: jev.decision, rationale: jev.rationale, engine: jev.engine, latency_ms: jev.latencyMs }
      : { source: intake.source, contact, intake, decision: {}, rationale: [], engine: HUMAN_REVIEW_ENGINE, latency_ms: 0 };
    const { data, error } = await db
      .from("leads")
      .insert(row)
      .select("id")
      .single();
    if (error) console.error("lead insert failed", error.message);
    leadId = data?.id ?? null;
  }

  // The consent record is evidence, so it is written before we respond. It is
  // written only when the box was ticked: consent is optional, and no row means
  // no phone, text or automated outreach (email replies about this request only).
  let consentEventId: string | null = null;
  if (contact.consent) {
    consentEventId = (await recordConsent(
      buildConsentEvent({
        text: resolveConsentText("qualifier", meta.textVersion),
        email: contact.email,
        phone: contact.phone,
        ip: guard.ip,
        userAgent: req.headers.get("user-agent"),
        page: consentPage(req, meta.page, "/express"),
        leadId,
      }),
    ))?.id ?? null;
  }

  // Tier-1 broker alert (target: within 60 s) and the borrower's confirmation
  // email, after the response. lib/notify applies consent and the approval
  // gate; the /api/notify/sweep cron is the backstop if this run is lost.
  if (leadId) {
    const id = leadId;
    after(async () => {
      try {
        const rt = notifyRuntime();
        const lead = await rt.leads.get(id);
        if (!lead) return;
        const results = await Promise.allSettled([alertTier1Lead(lead, rt.notifier, rt.staff), sendLeadConfirmation(lead, rt.notifier)]);
        for (const r of results) if (r.status === "rejected") console.error("lead notification failed", r.reason instanceof Error ? r.reason.message : r.reason);
      } catch (err) {
        console.error("lead notifications failed", err instanceof Error ? err.message : err);
      }
    });
  }

  // Agent audit trail (reason codes for the qualifier decision) and the
  // speed-to-lead trigger; the /api/outreach/sweep cron is the backstop for a
  // lost event. Neither may fail the submission.
  after(async () => {
    try {
      const events = agentSafety().events;
      if (events) {
        if (jev) await recordQualifierDecision(events, { leadId, result: jev, intake });
        else await recordHumanReviewQualifier(events, { leadId, reason: subject.humanReviewOnly ? "human_review_only" : "ai_processing_opt_out" });
      }
    } catch (err) {
      console.error("qualifier decision log failed", err instanceof Error ? err.message : err);
    }
    if (leadId && jev) {
      try {
        await sendWorkflowEvent({ name: EVENTS.leadScored, id: `lead-scored:${leadId}`, data: { leadId } });
      } catch (err) {
        console.error("lead.scored event failed", err instanceof Error ? err.message : err);
      }
    }
  });

  // CRM sync runs after the response so the borrower never waits on Twenty.
  // The /api/cron/crm-retry cron is the backstop if this run is lost.
  after(async () => {
    if (!twentyConfigured()) {
      // The crm-retry cron pushes this row once Twenty is configured.
      console.warn("Twenty CRM not configured; lead stored in Supabase until crm-retry pushes it", leadId);
      return;
    }
    try {
      // Checkpoint each Twenty id as it is created so the retry cron resumes
      // instead of creating a second company and opportunity.
      const refs = await pushLead(intake, contact, jev, {
        consentEventId,
        // A STOP already in the ledger for this number keeps it out of Twenty.
        smsConsent: smsConsentLookup(notifyRuntime().consent),
        onProgress: async (progress) => {
          if (db && leadId) await db.from("leads").update({ crm_progress: progress }).eq("id", leadId);
        },
      });
      if (db && leadId) await db.from("leads").update({ twenty_person_id: refs.personId, twenty_opportunity_id: refs.opportunityId }).eq("id", leadId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Twenty pushLead failed", message);
      if (db && leadId) await db.from("leads").update({ crm_error: message.slice(0, 1_000) }).eq("id", leadId);
    }
  });

  return NextResponse.json(
    {
      leadId,
      uploadToken: leadId && process.env.LEAD_TOKEN_SECRET ? signLeadToken(leadId) : null,
      result: jev ? publicSummary(jev) : humanReviewSummary(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
