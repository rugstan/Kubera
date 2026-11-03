import "server-only";
import { agentSafety } from "@/lib/agents/core/server";
import { modelGateway } from "@/lib/ai/gateway";
import { routingSubject } from "@/lib/privacy/requests";
import { privacyServices } from "@/lib/privacy/server";
import { site } from "@/lib/site";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseAttachmentSink } from "./attachments";
import { demoReviewDeps } from "./demo";
import type { InboundDeps } from "./inbound";
import { reviewAlertContent, supabaseReviewTargets, type ReviewAlertInput, type ReviewDeps } from "./review";
import { supabaseDealDirectory, supabaseMailStore } from "./store";
import { mailProviderFromEnv } from "./provider";

// Production wiring for the inbound mail pipeline: the mailbox connector
// chosen from env (Mailflare or Zoho Mail, see ./provider) + Supabase.
// Null (pipeline off, logged once) unless both are configured.

let warned = false;
let override: InboundDeps | null | undefined;

/** Test hook (undefined restores env wiring). */
export function setInboundMailDeps(deps: InboundDeps | null | undefined): void {
  override = deps;
}

/** Emails each staff address (pre-approved staff_alert template, once per message and address). Never throws. */
export async function sendMailReviewAlert(a: ReviewAlertInput): Promise<void> {
  // Loaded on first use: the notification stack is large and most requests that wire mail never page anyone.
  const { notifyRuntime } = await import("@/lib/notify/runtime");
  const rt = notifyRuntime();
  const { title, lines } = reviewAlertContent(a);
  for (const address of rt.staff.emails) {
    try {
      await rt.notifier.send({
        templateId: "staff_alert",
        to: { audience: "staff", email: address },
        data: { title, lines, link: { href: `${site.siteUrl.replace(/\/$/, "")}/documents/mail`, label: "Open the mail review queue" } },
        idempotencyKey: `mail-review:${a.mailMessageId}:${address.toLowerCase()}`,
        requestedBy: "agent:mail-triage",
      });
    } catch (err) {
      console.error("[mail] review alert failed", err instanceof Error ? err.message : err);
    }
  }
}

export function inboundMailDeps(): InboundDeps | null {
  if (override !== undefined) return override;
  const choice = mailProviderFromEnv();
  const db = supabaseAdmin();
  if (!choice.provider || !db) {
    if (!warned) {
      warned = true;
      console.info(`[mail] inbound mail disabled (${!choice.provider ? choice.reason : "Supabase not configured"}).`);
    }
    return null;
  }
  const privacy = privacyServices();
  return {
    provider: choice.provider,
    store: supabaseMailStore(db),
    directory: supabaseDealDirectory(db),
    sink: supabaseAttachmentSink(db),
    gateway: modelGateway(),
    subjectFor: (email) => routingSubject(privacy?.requests ?? null, email),
    events: agentSafety().events,
    reviewAlert: sendMailReviewAlert,
  };
}

let reviewOverride: ReviewDeps | null | undefined;

/** Test hook for the review queue (undefined restores env wiring). */
export function setMailReviewDeps(deps: ReviewDeps | null | undefined): void {
  reviewOverride = deps;
}

/**
 * The staff review queue: Supabase (service role, after the page's staff check),
 * the in-memory demo queue with the fake identity provider, else null.
 */
export function mailReviewDeps(mode: "supabase" | "fake"): ReviewDeps | null {
  if (reviewOverride !== undefined) return reviewOverride;
  if (mode === "fake") return demoReviewDeps();
  const db = supabaseAdmin();
  if (!db) return null;
  return { store: supabaseMailStore(db), sink: supabaseAttachmentSink(db), targets: supabaseReviewTargets(db) };
}
