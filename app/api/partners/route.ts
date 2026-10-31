import { after, NextResponse } from "next/server";
import { buildConsentEvent, recordConsent } from "@/lib/consent/ledger";
import { consentPage, readConsentMeta } from "@/lib/consent/request";
import { resolveConsentText } from "@/lib/consent/texts";
import { pushPartner, twentyConfigured } from "@/lib/crm/twenty";
import { smsConsentLookup } from "@/lib/notify/consent";
import { notifyRuntime } from "@/lib/notify/runtime";
import { guardPost } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";
import { partnerSchema } from "@/lib/validation";

export async function POST(req: Request) {
  const guard = await guardPost(req, {
    name: "partners",
    rate: { limit: 10, windowMs: 60 * 60_000 },
    rateLimitMessage: "Too many submissions.",
    turnstile: "partners",
  });
  if (!guard.ok) return guard.response;

  const parsed = partnerSchema.safeParse(guard.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid registration", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  const reg = parsed.data;
  const meta = readConsentMeta(guard.body);
  const db = supabaseAdmin();
  let partnerId: string | null = null;
  if (db) {
    const { contact, ...profile } = reg;
    const { data, error } = await db
      .from("partners")
      .insert({ partner_type: reg.partnerType, organization: "organization" in reg ? reg.organization : null, email: contact.email, profile: { ...profile, contact } })
      .select("id")
      .single();
    if (error) console.error("partner insert failed", error.message);
    partnerId = data?.id ?? null;
  }

  // Consent is optional; a row is written only when the box was ticked.
  let consentEventId: string | null = null;
  if (reg.contact.consent) {
    consentEventId = (await recordConsent(
      buildConsentEvent({
        text: resolveConsentText("partner", meta.textVersion),
        email: reg.contact.email,
        phone: reg.contact.phone,
        ip: guard.ip,
        userAgent: req.headers.get("user-agent"),
        page: consentPage(req, meta.page, "/partners"),
        partnerId,
      }),
    ))?.id ?? null;
  }

  after(async () => {
    if (!twentyConfigured()) return;
    try {
      const refs = await pushPartner(reg, {
        consentEventId,
        // A STOP already in the ledger for this number keeps it out of Twenty.
        smsConsent: smsConsentLookup(notifyRuntime().consent),
        onProgress: async (progress) => {
          if (db && partnerId) await db.from("partners").update({ crm_progress: progress }).eq("id", partnerId);
        },
      });
      if (db && partnerId) await db.from("partners").update({ twenty_company_id: refs.companyId }).eq("id", partnerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Twenty pushPartner failed", message);
      if (db && partnerId) await db.from("partners").update({ crm_error: message.slice(0, 1_000) }).eq("id", partnerId);
    }
  });

  return NextResponse.json({ ok: true, partnerId }, { headers: { "cache-control": "no-store" } });
}
