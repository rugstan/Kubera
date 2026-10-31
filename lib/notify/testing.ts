// Test harness for the notification pipeline: a Notifier wired to fakes, an
// in-memory consent ledger, and helpers to seed consent. Used by the *.test.ts
// files in this directory; nothing here is imported by production code.

import { randomUUID } from "node:crypto";
import { FakeApprovalGate, type ApprovalGate } from "@/lib/compliance/approval-gate";
import type { ConsentEvent, ConsentLedger, StoredConsentEvent } from "@/lib/consent/ledger";
import { MemoryConsentReader } from "./consent";
import { FakeEmailClient } from "./email/fake";
import { MemoryOptOutSink } from "./optout";
import { Notifier } from "./service";
import { FakeSmsClient } from "./sms/fake";
import { MemoryNotifyStore } from "./store";

/** 15:00 Eastern: inside the texting window. */
export const DAYTIME = new Date("2026-11-03T20:00:00Z");
/** 22:00 Eastern: outside the texting window. */
export const NIGHT = new Date("2026-11-04T03:00:00Z");

export class TestLedger implements ConsentLedger {
  readonly events: StoredConsentEvent[] = [];
  failNext = false;

  async record(event: ConsentEvent): Promise<StoredConsentEvent> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("ledger down");
    }
    const stored = { ...event, id: randomUUID() };
    this.events.push(stored);
    return stored;
  }
}

export type HarnessOptions = {
  gate?: ApprovalGate;
  now?: Date;
  preApproved?: string[];
  email?: boolean;
  sms?: boolean;
};

export function makeHarness(opts: HarnessOptions = {}) {
  const clock = { now: opts.now ?? DAYTIME };
  const store = new MemoryNotifyStore();
  const email = new FakeEmailClient();
  const sms = new FakeSmsClient();
  const ledger = new TestLedger();
  const gate = opts.gate ?? new FakeApprovalGate("approved");
  const optOut = new MemoryOptOutSink();
  const consent = new MemoryConsentReader(() => ledger.events);
  const notifier = new Notifier({
    email: opts.email === false ? null : email,
    sms: opts.sms === false ? null : sms,
    store,
    consent,
    gate,
    preApproved: new Set(opts.preApproved ?? []),
    now: () => clock.now,
  });

  /** Seeds a qualifier-style grant (phone, text and email) for a person. */
  const grant = (c: { phone?: string; email?: string; channels?: ConsentEvent["channels"]; at?: Date; leadId?: string | null; form?: ConsentEvent["form"] }) => {
    const event: StoredConsentEvent = {
      id: randomUUID(),
      eventType: "granted",
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
      occurredAt: (c.at ?? new Date(DAYTIME.getTime() - 3_600_000)).toISOString(),
    };
    ledger.events.push(event);
    return event;
  };

  return { clock, store, email, sms, ledger, gate, optOut, consent, notifier, grant };
}

export type Harness = ReturnType<typeof makeHarness>;
