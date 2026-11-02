import { approvalGate } from "@/lib/approvals/server";
import { applyForm159EsignEvent } from "@/lib/deals/form159";
import { SupabaseDealDeskStore } from "@/lib/deals/store-supabase";
import { gatedCrmSink } from "@/lib/disclosures/deal-record";
import { supabaseDisclosureBackends } from "@/lib/disclosures/store-supabase";
import { esignProvider } from "@/lib/esign";
import { BoldSignProvider, boldSignConfigFromEnv } from "@/lib/esign/boldsign";
import { handleEsignWebhook } from "@/lib/esign/webhook";
import { supabaseAdmin } from "@/lib/supabase/server";

// BoldSign webhook (the fallback e-sign provider, ESIGN_PROVIDER=boldsign):
// BoldSign app → API → Webhooks, URL https://corincommercial.com/api/webhooks/boldsign,
// with its signing key in BOLDSIGN_WEBHOOK_SECRET (X-BoldSign-Signature is
// verified over the raw body). Same pipeline as the Zoho Sign route: status to
// `disclosures`, the audit trail in `disclosure_events`, the signed copy to the
// vault (3-year retention), the CRM mirror behind the approval gate, and
// requests that are not disclosures to the deal desk (SBA Form 159). Kept
// working while BoldSign is configured even after ESIGN_PROVIDER moves back to
// Zoho Sign, so envelopes already out with BoldSign still complete.

function provider() {
  const configured = esignProvider();
  if (configured?.name === "boldsign") return configured;
  const bold = boldSignConfigFromEnv();
  return bold ? new BoldSignProvider(bold) : null;
}

export async function POST(req: Request) {
  return handleEsignWebhook(req, {
    provider: provider(),
    secretConfigured: Boolean(process.env.BOLDSIGN_WEBHOOK_SECRET),
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
