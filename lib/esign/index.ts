// Env-gated provider selection. ESIGN_PROVIDER picks explicitly
// ("zoho_sign" | "boldsign" | "fake"); otherwise Zoho Sign when configured,
// then BoldSign. With nothing configured this returns null and logs once, so
// pages and builds never crash — callers treat null as "e-sign unavailable".

import { randomBytes } from "node:crypto";
import { fakeProviderRefusal } from "@/lib/deploy-env";
import { BoldSignProvider, boldSignConfigFromEnv } from "./boldsign";
import { FakeEsignProvider } from "./fake";
import type { EsignProvider, EsignProviderName } from "./types";
import { ZohoSignProvider, zohoSignConfigFromEnv } from "./zoho-sign";

export type { EsignProvider, EsignEvent, EsignProviderName, Recipient, CreatedRequest, EsignRequestStatus } from "./types";
export { EsignError } from "./types";

let cached: { key: string; provider: EsignProvider | null } | null = null;
let warned = false;
let refusedWarned = false;

export function esignProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EsignProvider | null {
  const explicit = env.ESIGN_PROVIDER as EsignProviderName | undefined;
  const zoho = zohoSignConfigFromEnv(env);
  const bold = boldSignConfigFromEnv(env);
  if (explicit === "fake") {
    // Same rule as AUTH_PROVIDER=fake: a fake 'signed' MLDS must never reach
    // the real disclosures table. Degrade to "e-sign unavailable" (Global
    // rule 3) instead of crashing the pages that ask for a provider.
    const refused = fakeProviderRefusal("ESIGN_PROVIDER", env);
    if (refused) {
      if (!refusedWarned) {
        refusedWarned = true;
        console.error(`[esign] ${refused}; e-sign is disabled.`);
      }
      return null;
    }
    // Never the fake's built-in test secret: without ZOHO_SIGN_WEBHOOK_SECRET
    // the webhook route refuses the fake, and this per-process secret keeps
    // the public default out of any env-built provider.
    return new FakeEsignProvider(env.ZOHO_SIGN_WEBHOOK_SECRET || randomBytes(32).toString("hex"));
  }
  if ((explicit === "zoho_sign" || !explicit) && zoho) return new ZohoSignProvider(zoho);
  if ((explicit === "boldsign" || !explicit) && bold) return new BoldSignProvider(bold);
  if (!warned) {
    warned = true;
    console.warn(`[esign] No e-sign provider configured${explicit ? ` for ESIGN_PROVIDER=${explicit}` : ""}; disclosures cannot be sent for signature.`);
  }
  return null;
}

/** MLDS template id for `provider`, or null when it is not configured. */
export function mldsTemplateId(provider: EsignProviderName, env: NodeJS.ProcessEnv = process.env): string | null {
  if (provider === "fake") return "fake_mlds_template";
  const id = provider === "zoho_sign" ? env.ZOHO_SIGN_MLDS_TEMPLATE_ID : env.BOLDSIGN_MLDS_TEMPLATE_ID;
  return id || null;
}

/** Process-wide provider (cached per configuration). */
export function esignProvider(): EsignProvider | null {
  const e = process.env;
  const key = [e.ESIGN_PROVIDER, e.ZOHO_SIGN_CLIENT_ID, e.BOLDSIGN_API_KEY, Boolean(e.ZOHO_SIGN_WEBHOOK_SECRET), e.VERCEL_ENV, e.DEPLOY_ENV, e.NODE_ENV, Boolean(e.SUPABASE_SERVICE_ROLE_KEY?.trim())].join("|");
  if (!cached || cached.key !== key) cached = { key, provider: esignProviderFromEnv() };
  return cached.provider;
}
