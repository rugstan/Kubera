import "server-only";
import { agentSafety } from "@/lib/agents/core/server";
import { modelGateway } from "@/lib/ai/gateway";
import { routingSubject } from "@/lib/privacy/requests";
import { privacyServices } from "@/lib/privacy/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseAttachmentSink } from "./attachments";
import type { InboundDeps } from "./inbound";
import { supabaseDealDirectory, supabaseMailStore } from "./store";
import { ZohoMailClient, zohoMailConfigFromEnv } from "./zoho";

// Production wiring for the inbound mail pipeline: Zoho Mail + Supabase.
// Null (pipeline off, logged once) unless both are configured.

let warned = false;
let override: InboundDeps | null | undefined;

/** Test hook (undefined restores env wiring). */
export function setInboundMailDeps(deps: InboundDeps | null | undefined): void {
  override = deps;
}

export function inboundMailDeps(): InboundDeps | null {
  if (override !== undefined) return override;
  const config = zohoMailConfigFromEnv();
  const db = supabaseAdmin();
  if (!config || !db) {
    if (!warned) {
      warned = true;
      console.info(`[mail] inbound mail disabled (${!config ? "ZOHO_MAIL_CLIENT_ID/SECRET/REFRESH_TOKEN not set" : "Supabase not configured"}).`);
    }
    return null;
  }
  const privacy = privacyServices();
  return {
    provider: new ZohoMailClient(config),
    store: supabaseMailStore(db),
    directory: supabaseDealDirectory(db),
    sink: supabaseAttachmentSink(db),
    gateway: modelGateway(),
    subjectFor: (email) => routingSubject(privacy?.requests ?? null, email),
    events: agentSafety().events,
  };
}
