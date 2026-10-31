import { after, NextResponse } from "next/server";
import { decide, publicSummary } from "@/lib/ai/jev";
import { buildConsentEvent, recordConsent } from "@/lib/consent/ledger";
import { consentPage, readConsentMeta } from "@/lib/consent/request";
import { resolveConsentText } from "@/lib/consent/texts";
import { pushLead, twentyConfigured } from "@/lib/crm/twenty";
import { getMarketSnapshot } from "@/lib/rates";
import { guardPost, signLeadToken } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";
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
  const market = await getMarketSnapshot();
  const jev = await decide(intake, market.benchmarks);

  const db = supabaseAdmin();
  let leadId: string | null = null;
  if (db) {
    const { data, error } = await db
      .from("leads")
      .insert({ source: intake.source, contact, intake, decision: jev.decision, rationale: jev.rationale, engine: jev.engine, latency_ms: jev.latencyMs })
      .select("id")
      .single();
    if (error) console.error("lead insert failed", error.message);
    leadId = data?.id ?? null;
  }

  // The consent record is evidence, so it is written before we respond.
  await recordConsent(
    buildConsentEvent({
      text: resolveConsentText("qualifier", meta.textVersion),
      email: contact.email,
      phone: contact.phone,
      ip: guard.ip,
      userAgent: req.headers.get("user-agent"),
      page: consentPage(req, meta.page, "/express"),
      leadId,
    }),
  );

  // CRM sync runs after the response so the borrower never waits on Twenty.
  after(async () => {
    if (!twentyConfigured()) {
      console.warn("Twenty CRM not configured; lead stored in Supabase only", leadId);
      return;
    }
    try {
      const refs = await pushLead(intake, contact, jev);
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
      result: publicSummary(jev),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
