// Inngest client and event sender (env-gated).
//
//   INNGEST_EVENT_KEY    sends events (production / preview)
//   INNGEST_SIGNING_KEY  verifies Inngest's calls to /api/inngest
//   INNGEST_DEV=1        local Inngest dev server (no keys needed)
//
// Without keys, sendWorkflowEvent logs once and drops the event (the caller's
// request still succeeds), and /api/inngest answers 503.

import { Inngest } from "inngest";
import type { OutgoingEvent } from "./step";

export const INNGEST_APP_ID = "kubera-commercial";

let client: Inngest | undefined;

/** Lazily constructed so importing this module never reads env or opens anything. */
export function inngest(): Inngest {
  client ??= new Inngest({ id: INNGEST_APP_ID, appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) });
  return client;
}

export function inngestDevMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.INNGEST_DEV === "1" || env.INNGEST_DEV === "true";
}

/** True when Inngest can both receive events and call our functions. */
export function workflowsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return inngestDevMode(env) || Boolean(env.INNGEST_EVENT_KEY?.trim() && env.INNGEST_SIGNING_KEY?.trim());
}

export interface EventSender {
  send(events: OutgoingEvent | OutgoingEvent[]): Promise<{ sent: number }>;
}

let warned = false;
let senderOverride: EventSender | undefined;

/** Test hook (undefined restores Inngest). */
export function setEventSender(sender: EventSender | undefined): void {
  senderOverride = sender;
}

/**
 * Sends workflow events. Give events a stable `id` where a duplicate would be
 * harmful: Inngest drops a second event with the same id within 24 hours.
 */
export async function sendWorkflowEvent(events: OutgoingEvent | OutgoingEvent[]): Promise<{ sent: number }> {
  if (senderOverride) return senderOverride.send(events);
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return { sent: 0 };
  if (!inngestDevMode() && !process.env.INNGEST_EVENT_KEY?.trim()) {
    if (!warned) {
      warned = true;
      console.warn("[workflows] INNGEST_EVENT_KEY is not set; workflow events are dropped.");
    }
    return { sent: 0 };
  }
  await inngest().send(list.map((e) => ({ name: e.name, data: e.data, ...(e.id ? { id: e.id } : {}) })));
  return { sent: list.length };
}

/** In-memory sender for tests. */
export class MemoryEventSender implements EventSender {
  readonly events: OutgoingEvent[] = [];
  async send(events: OutgoingEvent | OutgoingEvent[]): Promise<{ sent: number }> {
    const list = Array.isArray(events) ? events : [events];
    this.events.push(...list);
    return { sent: list.length };
  }
}
