import { closedApprovalGate } from "@/lib/compliance/approval-gate";
import { gatedCrmSink } from "@/lib/disclosures/deal-record";
import { supabaseDisclosureBackends } from "@/lib/disclosures/store-supabase";
import { esignProvider } from "@/lib/esign";
import { handleEsignWebhook } from "@/lib/esign/webhook";
import { ZohoSignProvider, zohoSignConfigFromEnv } from "@/lib/esign/zoho-sign";

// Zoho Sign webhook: Settings → Developer settings → Webhooks, URL
// https://kuberacommercial.com/api/webhooks/zoho-sign, with a secret key
// (ZOHO_SIGN_WEBHOOK_SECRET). Writes status to `disclosures`, the audit trail
// in `disclosure_events`, the signed copy to the vault, and asks the approval
// gate before mirroring the status into the CRM deal record.

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
    secretConfigured: p?.name === "fake" || Boolean(process.env.ZOHO_SIGN_WEBHOOK_SECRET),
    backends: supabaseDisclosureBackends(),
    deal: gatedCrmSink(closedApprovalGate),
    now: () => new Date(),
  });
}
