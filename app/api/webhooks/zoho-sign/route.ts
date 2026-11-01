import { approvalGate } from "@/lib/approvals/server";
import { applyForm159EsignEvent } from "@/lib/deals/form159";
import { SupabaseDealDeskStore } from "@/lib/deals/store-supabase";
import { gatedCrmSink } from "@/lib/disclosures/deal-record";
import { supabaseDisclosureBackends } from "@/lib/disclosures/store-supabase";
import { esignProvider } from "@/lib/esign";
import { handleEsignWebhook } from "@/lib/esign/webhook";
import { ZohoSignProvider, zohoSignConfigFromEnv } from "@/lib/esign/zoho-sign";
import { supabaseAdmin } from "@/lib/supabase/server";

// Zoho Sign webhook: Settings → Developer settings → Webhooks, URL
// https://kuberacommercial.com/api/webhooks/zoho-sign, with a secret key
// (ZOHO_SIGN_WEBHOOK_SECRET). Writes status to `disclosures`, the audit trail
// in `disclosure_events`, the signed copy to the vault, and asks the approval
// gate before mirroring the status into the CRM deal record. Requests that are
// not disclosures fall through to the deal desk (SBA Form 159 signatures).

function provider() {
  const configured = esignProvider();
  if (configured && (configured.name === "zoho_sign" || configured.name === "fake")) return configured;
  const zoho = zohoSignConfigFromEnv();
  return zoho ? new ZohoSignProvider(zoho) : null;
}

export async function POST(req: Request) {
  const p = provider();
  return handleEsignWebhook(req, {
    provider: p,
    // The fake too: without an explicit secret it would verify against a
    // public test value, so anyone could forge a 'signed' MLDS.
    secretConfigured: Boolean(process.env.ZOHO_SIGN_WEBHOOK_SECRET),
    backends: supabaseDisclosureBackends(),
    deal: gatedCrmSink(approvalGate()),
    async otherRequest(event) {
      const db = supabaseAdmin();
      if (!db) return false;
      return (await applyForm159EsignEvent({ store: new SupabaseDealDeskStore(db), now: () => new Date() }, event)) !== null;
    },
    now: () => new Date(),
  });
}
