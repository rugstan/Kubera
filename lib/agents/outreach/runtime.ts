import "server-only";
import { approvalGate } from "@/lib/approvals/server";
import { supabaseChecklistStore } from "@/lib/checklists/supabase";
import { MemoryChecklistStore } from "@/lib/checklists/store";
import { SupabaseConstructionStore } from "@/lib/construction/store-supabase";
import { SupabaseDealDeskStore } from "@/lib/deals/store-supabase";
import { MemoryDealDeskStore } from "@/lib/deals/store";
import { emailClientFromEnv } from "@/lib/notify/email";
import { notifyRuntime } from "@/lib/notify/runtime";
import { smsClientFromEnv } from "@/lib/notify/sms";
import { site } from "@/lib/site";
import { supabaseAdmin } from "@/lib/supabase/server";
import { noopAudit, type OutreachAuditSink } from "./audit";
import type { Escalation, EscalationSink } from "./escalation";
import { OutreachSender } from "./sender";
import { composeSources, supabaseHotLeadIds, type OutreachSources } from "./sources";
import { MemoryOutreachStore, type OutreachStore } from "./store";
import { SupabaseOutreachStore } from "./supabase-store";
import { preApprovedFromEnv } from "./templates";
import { MemoryVoiceConsentStore, SupabaseVoiceConsentStore, type VoiceConsentStore } from "./voice/consent";
import { VoiceService } from "./voice/service";
import { MemoryVoiceStore, SupabaseVoiceStore, type VoiceStore } from "./voice/store";
import { voiceClientFromEnv } from "./voice/telnyx";

// Production wiring for the chasers: real providers when their env vars are
// set, otherwise null clients that skip (never crash). Routes call
// outreachRuntime(); tests build the pieces directly with fakes.

export type OutreachRuntime = {
  sender: OutreachSender;
  store: OutreachStore;
  sources: OutreachSources;
  escalation: EscalationSink;
  audit: OutreachAuditSink;
  voice: VoiceService | null;
  voiceStore: VoiceStore;
  aiVoiceConsents: VoiceConsentStore;
  /** TELNYX_PUBLIC_KEY, shared with the messaging webhook. */
  telnyxPublicKey: string | undefined;
};

/** Escalations go to the staff mailbox through WS-J's pre-approved staff_alert template, once per key. */
function staffEscalation(): EscalationSink {
  return {
    async escalate(e: Escalation) {
      const rt = notifyRuntime();
      for (const address of rt.staff.emails) {
        await rt.notifier.send({
          templateId: "staff_alert",
          to: { audience: "staff", email: address },
          data: { title: e.title, lines: e.lines, link: { href: `${site.siteUrl.replace(/\/$/, "")}/pipeline`, label: "Open the pipeline" } },
          idempotencyKey: `outreach-escalation:${e.key}:${address.toLowerCase()}`,
          leadId: e.leadId ?? null,
          dealId: e.dealId ?? null,
          requestedBy: "agent:outreach",
        });
      }
    },
  };
}

let cached: OutreachRuntime | undefined;
let warnedMemory = false;

export function outreachRuntime(): OutreachRuntime {
  if (cached) return cached;
  const rt = notifyRuntime();
  const db = supabaseAdmin();
  if (!db && !warnedMemory) {
    warnedMemory = true;
    console.warn("outreach: Supabase is not configured; chaser records are kept in memory only");
  }
  const store: OutreachStore = db ? new SupabaseOutreachStore(db) : new MemoryOutreachStore();
  const gate = approvalGate();
  const preApproved = preApprovedFromEnv();
  const audit = noopAudit;
  const sender = new OutreachSender({
    email: emailClientFromEnv(),
    sms: smsClientFromEnv(),
    store,
    consent: rt.consent,
    gate,
    preApproved,
    smsLog: rt.store,
    audit,
    paused: process.env.OUTREACH_PAUSED?.trim().toLowerCase() === "true",
  });
  const sources = composeSources({
    checklists: db ? supabaseChecklistStore(db) : new MemoryChecklistStore(),
    deals: db ? new SupabaseDealDeskStore(db) : new MemoryDealDeskStore(),
    construction: db ? new SupabaseConstructionStore(db) : null,
    leads: rt.leads,
    hotLeadIds: db ? supabaseHotLeadIds(db) : undefined,
  });
  const voiceStore: VoiceStore = db ? new SupabaseVoiceStore(db) : new MemoryVoiceStore();
  const aiVoiceConsents: VoiceConsentStore = db ? new SupabaseVoiceConsentStore(db) : new MemoryVoiceConsentStore();
  cached = {
    sender,
    store,
    sources,
    escalation: staffEscalation(),
    audit,
    voiceStore,
    aiVoiceConsents,
    telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY?.trim() || undefined,
    voice: new VoiceService({
      client: voiceClientFromEnv(),
      store: voiceStore,
      consent: rt.consent,
      aiVoiceConsents,
      gate,
      preApproved,
      audit,
      webhookUrl: process.env.OUTREACH_VOICE_WEBHOOK_URL?.trim() || `${site.siteUrl.replace(/\/$/, "")}/api/webhooks/telnyx-voice`,
    }),
  };
  return cached;
}

/** Test hook. */
export function setOutreachRuntime(runtime: OutreachRuntime | undefined) {
  cached = runtime;
}
