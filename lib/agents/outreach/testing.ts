// Test harness for the chasers: a sender wired to fakes, an in-memory consent
// ledger, and builders for leads, checklist items and deals. Used by the
// *.test.ts files in this directory; nothing here is imported by production code.

import { randomUUID } from "node:crypto";
import type { Condition } from "@/lib/checklists/conditions";
import type { DealChecklistItem } from "@/lib/checklists/types";
import { FakeApprovalGate, type ApprovalGate } from "@/lib/compliance/approval-gate";
import type { ConsentEvent, StoredConsentEvent } from "@/lib/consent/ledger";
import { MemoryConsentReader } from "@/lib/notify/consent";
import { FakeEmailClient } from "@/lib/notify/email/fake";
import type { LeadRecord } from "@/lib/notify/leads";
import { FakeSmsClient } from "@/lib/notify/sms/fake";
import { MemoryNotifyStore } from "@/lib/notify/store";
import { DAYTIME, NIGHT, TestLedger } from "@/lib/notify/testing";
import { MemoryAudit } from "./audit";
import { MemoryEscalations } from "./escalation";
import { OutreachSender } from "./sender";
import { MemorySources, type DealOutreachContext } from "./sources";
import { MemoryOutreachStore } from "./store";
import { MemoryVoiceConsentStore } from "./voice/consent";
import { FakeVoiceClient } from "./voice/fake";
import { VoiceService } from "./voice/service";
import { MemoryVoiceStore } from "./voice/store";

export { DAYTIME, NIGHT };

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export type HarnessOptions = {
  gate?: ApprovalGate;
  now?: Date;
  preApproved?: string[];
  email?: boolean;
  sms?: boolean;
  paused?: boolean;
};

export function makeHarness(opts: HarnessOptions = {}) {
  const clock = { now: opts.now ?? DAYTIME };
  const now = () => clock.now;
  const store = new MemoryOutreachStore(now);
  const email = new FakeEmailClient();
  const sms = new FakeSmsClient();
  const ledger = new TestLedger();
  const gate = opts.gate ?? new FakeApprovalGate("approved");
  const consent = new MemoryConsentReader(() => ledger.events);
  const audit = new MemoryAudit();
  const escalation = new MemoryEscalations();
  const smsLog = new MemoryNotifyStore();
  const sources = new MemorySources();
  const sender = new OutreachSender({
    email: opts.email === false ? null : email,
    sms: opts.sms === false ? null : sms,
    store,
    consent,
    gate,
    preApproved: new Set(opts.preApproved ?? []),
    smsLog,
    audit,
    paused: opts.paused,
    now,
  });

  /** Seeds a qualifier-style grant (phone, text and email) for a person. */
  const grant = (c: { phone?: string; email?: string; channels?: ConsentEvent["channels"]; at?: Date; leadId?: string | null; form?: ConsentEvent["form"]; eventType?: ConsentEvent["eventType"] }) => {
    const event: StoredConsentEvent = {
      id: randomUUID(),
      eventType: c.eventType ?? "granted",
      form: c.form ?? "qualifier",
      textVersion: "qualifier-contact-2026-10-31",
      textSha256: "a".repeat(64),
      channels: c.channels ?? ["phone", "sms", "email", "autodialer"],
      email: c.email?.toLowerCase() ?? null,
      phone: c.phone ?? null,
      ip: null,
      userAgent: null,
      page: "/express",
      leadId: c.leadId ?? null,
      occurredAt: (c.at ?? new Date(DAYTIME.getTime() - 30 * DAY)).toISOString(),
    };
    ledger.events.push(event);
    return event;
  };

  /** A STOP text: revokes sms and autodialer for the number. */
  const stop = (phone: string, at: Date = new Date(clock.now.getTime() - HOUR)) =>
    grant({ phone, channels: ["sms", "autodialer"], at, eventType: "revoked", form: "sms" as unknown as ConsentEvent["form"] });

  return { clock, now, store, email, sms, ledger, gate, consent, audit, escalation, smsLog, sources, sender, grant, stop };
}

export type Harness = ReturnType<typeof makeHarness>;

export const LEAD_PHONE = "+14155550100";
export const LEAD_EMAIL = "pat@example.com";

export const makeLead = (over: Partial<LeadRecord> = {}, createdMsAgo = 4_000, now: Date = DAYTIME): LeadRecord => ({
  id: randomUUID(),
  createdAt: new Date(now.getTime() - createdMsAgo).toISOString(),
  tier: "TIER_1_INSTITUTIONAL_HOT",
  loanAmount: 12_000_000,
  program: "HUD_232_223F",
  assetType: "ASSISTED_LIVING",
  contact: { firstName: "Pat", email: LEAD_EMAIL, phone: LEAD_PHONE, consent: true },
  ...over,
});

export function makeItem(over: Partial<DealChecklistItem> = {}, createdAt: Date = new Date(DAYTIME.getTime() - 3 * DAY)): DealChecklistItem {
  const id = randomUUID();
  return {
    id,
    checklistId: "chk-1",
    dealId: "deal-1",
    itemKey: `item_${id.slice(0, 6)}`,
    templateKey: "t12",
    principalId: null,
    title: "Trailing 12-month operating statement",
    description: "T-12",
    category: "financial",
    responsible: "borrower",
    stage: "application",
    required: true,
    upload: true,
    docKind: "T12",
    recencyDays: null,
    lookup: null,
    status: "requested",
    documentDate: null,
    dueDate: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    waivedReason: null,
    verification: null,
    sortOrder: 0,
    version: 1,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    ...over,
  };
}

export function makeCondition(over: Partial<Condition> = {}): Condition {
  return {
    id: randomUUID(),
    dealId: "deal-1",
    source: "lender",
    lenderName: "Sample Lender",
    timing: "prior_to_closing",
    description: "Evidence of property insurance naming the lender",
    status: "open",
    responsible: "borrower",
    dueDate: null,
    checklistItemId: null,
    notes: null,
    clearedBy: null,
    clearedAt: null,
    waiverReason: null,
    waiverEvidence: null,
    createdBy: "staff",
    version: 1,
    createdAt: DAYTIME.toISOString(),
    updatedAt: DAYTIME.toISOString(),
    ...over,
  };
}

export function makeDealCtx(over: { deal?: Partial<DealOutreachContext["deal"]>; items?: DealChecklistItem[]; conditions?: Condition[]; uploadsInFlight?: string[] } = {}): DealOutreachContext {
  return {
    deal: {
      id: "deal-1",
      title: "Sample Gardens refinance",
      stage: "application",
      status: "active",
      leadId: null,
      closedOn: null,
      stageEnteredAt: new Date(DAYTIME.getTime() - 10 * DAY).toISOString(),
      propertyAddress: "1 Sample St, Fresno CA",
      ...over.deal,
    },
    items: over.items ?? [],
    conditions: over.conditions ?? [],
    uploadsInFlight: new Set(over.uploadsInFlight ?? []),
  };
}

export function makeVoiceHarness(opts: { now?: Date; gate?: ApprovalGate; preApproved?: string[]; client?: boolean; waitForMachineDetection?: boolean } = {}) {
  const h = makeHarness({ now: opts.now, gate: opts.gate });
  const client = new FakeVoiceClient();
  const store = new MemoryVoiceStore(h.now);
  const aiVoiceConsents = new MemoryVoiceConsentStore();
  const service = new VoiceService({
    client: opts.client === false ? null : client,
    store,
    consent: h.consent,
    aiVoiceConsents,
    gate: h.gate,
    preApproved: new Set(opts.preApproved ?? []),
    audit: h.audit,
    webhookUrl: "https://corincommercial.com/api/webhooks/telnyx-voice",
    waitForMachineDetection: opts.waitForMachineDetection,
    now: h.now,
  });
  return { ...h, client, voiceStore: store, aiVoiceConsents, voice: service };
}
