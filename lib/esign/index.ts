// Env-gated provider selection. ESIGN_PROVIDER picks explicitly
// ("zoho_sign" | "boldsign" | "fake"); otherwise Zoho Sign when configured,
// then BoldSign. With nothing configured this returns null and logs once, so
// pages and builds never crash — callers treat null as "e-sign unavailable".

import { BoldSignProvider, boldSignConfigFromEnv } from "./boldsign";
import { FakeEsignProvider } from "./fake";
import type { EsignProvider, EsignProviderName } from "./types";
import { ZohoSignProvider, zohoSignConfigFromEnv } from "./zoho-sign";

export type { EsignProvider, EsignEvent, EsignProviderName, Recipient, CreatedRequest, EsignRequestStatus } from "./types";
export { EsignError } from "./types";

let cached: { key: string; provider: EsignProvider | null } | null = null;
let warned = false;

export function esignProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EsignProvider | null {
  const explicit = env.ESIGN_PROVIDER as EsignProviderName | undefined;
  const zoho = zohoSignConfigFromEnv(env);
  const bold = boldSignConfigFromEnv(env);
  if (explicit === "fake") {
    if (env.NODE_ENV === "production" && env.VERCEL_ENV === "production") throw new Error("ESIGN_PROVIDER=fake is not allowed in production");
    return new FakeEsignProvider(env.ZOHO_SIGN_WEBHOOK_SECRET || undefined);
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
  const key = [process.env.ESIGN_PROVIDER, process.env.ZOHO_SIGN_CLIENT_ID, process.env.BOLDSIGN_API_KEY].join("|");
  if (!cached || cached.key !== key) cached = { key, provider: esignProviderFromEnv() };
  return cached.provider;
}
