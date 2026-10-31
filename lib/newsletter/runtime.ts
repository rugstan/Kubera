import "server-only";
import { approvalGate } from "@/lib/approvals/server";
import { consentLedger } from "@/lib/consent/ledger";
import { emailClientFromEnv } from "@/lib/notify/email";
import { supabaseAdmin } from "@/lib/supabase/server";
import { site } from "@/lib/site";
import { audienceClientFromEnv } from "./audience";
import { NewsletterService } from "./service";
import { MemorySubscriberStore, SupabaseSubscriberStore, type SubscriberStore } from "./store";
import { tokenSecretFromEnv } from "./tokens";

// Production wiring: Supabase for subscriber state, the shared consent ledger,
// Resend for the confirmation email and the audience, and the approvals queue
// as the gate. Missing services degrade (see each client); nothing throws at
// import time.

let instance: NewsletterService | undefined;
let warnedMemory = false;

export function newsletterService(): NewsletterService {
  if (instance) return instance;
  const db = supabaseAdmin();
  let store: SubscriberStore;
  if (db) {
    store = new SupabaseSubscriberStore(db);
  } else {
    if (!warnedMemory) {
      warnedMemory = true;
      console.warn("newsletter: Supabase is not configured; subscribers are kept in memory only");
    }
    store = new MemorySubscriberStore();
  }
  const tokenSecret = tokenSecretFromEnv();
  if (!tokenSecret) console.warn("newsletter: NEWSLETTER_TOKEN_SECRET (or LEAD_TOKEN_SECRET) is not set; signups are refused");
  instance = new NewsletterService({
    store,
    ledger: consentLedger(),
    email: emailClientFromEnv(),
    audience: audienceClientFromEnv(),
    gate: approvalGate(),
    tokenSecret,
    baseUrl: site.siteUrl,
    contactEmail: site.email,
  });
  return instance;
}

/** Test hook (undefined resets to the env-derived service). */
export function setNewsletterService(service: NewsletterService | undefined) {
  instance = service;
}
