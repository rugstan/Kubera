import { after, NextResponse } from "next/server";
import { pushPartner, twentyConfigured } from "@/lib/crm/twenty";
import { clientIp, rateLimit } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";
import { partnerSchema } from "@/lib/validation";

export async function POST(req: Request) {
  if (!rateLimit(`partners:${clientIp(req)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many submissions." }, { status: 429 });
  }
  const parsed = partnerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid registration", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  const reg = parsed.data;
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

  after(async () => {
    if (!twentyConfigured()) return;
    try {
      const refs = await pushPartner(reg);
      if (db && partnerId) await db.from("partners").update({ twenty_company_id: refs.companyId }).eq("id", partnerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Twenty pushPartner failed", message);
      if (db && partnerId) await db.from("partners").update({ crm_error: message.slice(0, 1_000) }).eq("id", partnerId);
    }
  });

  return NextResponse.json({ ok: true, partnerId });
}
