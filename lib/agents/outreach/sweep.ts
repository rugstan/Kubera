import type { OutreachAuditSink } from "./audit";
import type { EscalationSink } from "./escalation";
import { remindDocuments, nudgeClosing, type ReminderDeps } from "./reminders";
import type { OutreachSender } from "./sender";
import type { OutreachSources } from "./sources";
import { speedToLead } from "./speed-to-lead";
import type { OutreachStore } from "./store";
import { nudgeVendor } from "./vendor-nudges";

// One pass of every chaser. The cron route calls this every few minutes; it is
// safe to run at any time and as often as you like, because every message has
// an idempotency key and every series has a cadence. Each phase isolates its
// failures: one bad deal never stops the others.

export type SweepDeps = {
  sender: OutreachSender;
  store: OutreachStore;
  sources: OutreachSources;
  escalation?: EscalationSink | null;
  audit?: OutreachAuditSink;
  now?: () => Date;
  /** Passed through to the reminder cadences (tests). */
  reminder?: Pick<ReminderDeps, "documentCadence" | "closingCadence" | "smsFromRound" | "portalUrl">;
};

/** How far back the sweep looks for hot leads whose in-request trigger was missed. */
export const SPEED_SWEEP_WINDOW_MS = 30 * 60_000;
/** Held speed-to-lead texts (approval, texting window) are retried for a day. */
export const SPEED_RETRY_WINDOW_MS = 24 * 3_600_000;

export type SweepSummary = {
  speedToLead: { checked: number; sent: number; escalated: number; errors: number };
  documents: { deals: number; sent: number; resumed: number; capped: number; errors: number };
  closing: { deals: number; sent: number; resumed: number; capped: number; errors: number };
  vendors: { orders: number; sent: number; resumed: number; capped: number; errors: number };
};

const log = (what: string, err: unknown) => console.error(`outreach sweep: ${what} failed`, err instanceof Error ? err.message : err);

export async function runOutreachSweep(deps: SweepDeps): Promise<SweepSummary> {
  const now = deps.now ?? (() => new Date());
  const summary: SweepSummary = {
    speedToLead: { checked: 0, sent: 0, escalated: 0, errors: 0 },
    documents: { deals: 0, sent: 0, resumed: 0, capped: 0, errors: 0 },
    closing: { deals: 0, sent: 0, resumed: 0, capped: 0, errors: 0 },
    vendors: { orders: 0, sent: 0, resumed: 0, capped: 0, errors: 0 },
  };

  // 1. Speed to lead: leads whose trigger was missed, plus held texts a later run can release.
  const s2l = { sender: deps.sender, store: deps.store, escalation: deps.escalation, audit: deps.audit, now };
  const seen = new Set<string>();
  const leads = [...(await deps.sources.hotLeads(new Date(now().getTime() - SPEED_SWEEP_WINDOW_MS).toISOString()).catch((e) => (log("hot leads", e), [])))];
  for (const row of await deps.store.listRetryable("speed_to_lead", new Date(now().getTime() - SPEED_RETRY_WINDOW_MS)).catch((e) => (log("held leads", e), []))) {
    if (!row.leadId) continue;
    const lead = await deps.sources.lead(row.leadId).catch(() => null);
    if (lead) leads.push(lead);
  }
  for (const lead of leads) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    summary.speedToLead.checked += 1;
    try {
      const r = await speedToLead(lead, s2l);
      if (r.sent && !r.skipped) summary.speedToLead.sent += 1;
      if (r.escalated) summary.speedToLead.escalated += 1;
    } catch (err) {
      summary.speedToLead.errors += 1;
      log(`speed to lead ${lead.id}`, err);
    }
  }

  // 2 & 3. Checklist-driven reminders and closing nudges.
  const reminder: ReminderDeps = { sender: deps.sender, store: deps.store, escalation: deps.escalation, audit: deps.audit, sources: deps.sources, now, ...deps.reminder };
  const deals = await deps.sources.activeDeals().catch((e) => (log("active deals", e), []));
  for (const ctx of deals) {
    summary.documents.deals += 1;
    summary.closing.deals += 1;
    try {
      const r = await remindDocuments(ctx, reminder);
      tally(summary.documents, r.action, r.outcomes.some((o) => o.status === "sent"));
    } catch (err) {
      summary.documents.errors += 1;
      log(`document reminders ${ctx.deal.id}`, err);
    }
    try {
      const r = await nudgeClosing(ctx, reminder);
      tally(summary.closing, r.action, r.outcomes.some((o) => o.status === "sent"));
    } catch (err) {
      summary.closing.errors += 1;
      log(`closing nudges ${ctx.deal.id}`, err);
    }
  }

  // 4. Vendor order nudges.
  const orders = await deps.sources.vendorOrders().catch((e) => (log("vendor orders", e), []));
  for (const order of orders) {
    summary.vendors.orders += 1;
    try {
      const r = await nudgeVendor(order, { sender: deps.sender, store: deps.store, escalation: deps.escalation, audit: deps.audit, now });
      tally(summary.vendors, r.action, r.outcomes.some((o) => o.status === "sent"));
    } catch (err) {
      summary.vendors.errors += 1;
      log(`vendor nudge ${order.report.id}`, err);
    }
  }
  return summary;
}

function tally(bucket: { sent: number; resumed: number; capped: number }, action: string, anySent: boolean) {
  if (action === "capped") bucket.capped += 1;
  else if (action === "resumed" && anySent) bucket.resumed += 1;
  else if (action === "sent" && anySent) bucket.sent += 1;
}
