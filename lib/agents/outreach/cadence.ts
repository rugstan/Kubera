import type { OutreachStore } from "./store";
import type { OutreachKind, OutreachMessageRow } from "./types";

// Reminder cadence. A reminder series is a run of numbered rounds for one thing
// (a deal's open documents, a vendor's report order). Round 1 is due once the
// thing has been outstanding for `firstAfterHours`; each later round is due
// `repeatEveryHours` after the previous round started. A round is "waiting"
// while a message in it is held for approval or for the texting window: the
// next run resumes that round (same idempotency keys) instead of starting a new
// one, so nothing is sent twice and nothing piles up in the approval queue.
// After `maxRounds` rounds the series stops and a person is told.

export type CadenceConfig = {
  firstAfterHours: number;
  repeatEveryHours: number;
  maxRounds: number;
};

export const DOCUMENT_CADENCE: CadenceConfig = { firstAfterHours: 24, repeatEveryHours: 72, maxRounds: 4 };
export const CLOSING_CADENCE: CadenceConfig = { firstAfterHours: 12, repeatEveryHours: 48, maxRounds: 5 };
export const VENDOR_CADENCE: CadenceConfig = { firstAfterHours: 0, repeatEveryHours: 48, maxRounds: 3 };

const HOUR = 3_600_000;

export type SeriesQuery = {
  kind: OutreachKind;
  dealId?: string | null;
  leadId?: string | null;
  subjectKey: string;
  /** When the thing first became outstanding (checklist item requested, report due). */
  anchor: Date;
  cadence: CadenceConfig;
  now: Date;
};

export type SeriesPlan =
  | { action: "start"; round: number }
  | { action: "resume"; round: number; rows: OutreachMessageRow[] }
  | { action: "none"; reason: "not_due"; dueAt: Date }
  | { action: "cap_reached"; rounds: number };

export const WAITING_STATUSES = ["pending_approval", "deferred_quiet_hours"] as const;
const isWaiting = (r: OutreachMessageRow) => (WAITING_STATUSES as readonly string[]).includes(r.status);

export async function planSeries(store: OutreachStore, q: SeriesQuery): Promise<SeriesPlan> {
  const rows = await store.listSeries({ kind: q.kind, ...(q.dealId !== undefined ? { dealId: q.dealId } : {}), ...(q.leadId !== undefined ? { leadId: q.leadId } : {}), subjectKey: q.subjectKey });
  const last = rows.reduce((m, r) => Math.max(m, r.sequence), 0);
  if (last === 0) {
    const dueAt = new Date(q.anchor.getTime() + q.cadence.firstAfterHours * HOUR);
    return q.now.getTime() >= dueAt.getTime() ? { action: "start", round: 1 } : { action: "none", reason: "not_due", dueAt };
  }
  const lastRows = rows.filter((r) => r.sequence === last);
  const waiting = lastRows.filter(isWaiting);
  if (waiting.length > 0) return { action: "resume", round: last, rows: waiting };
  if (last >= q.cadence.maxRounds) return { action: "cap_reached", rounds: last };
  const started = Math.min(...lastRows.map((r) => Date.parse(r.createdAt)));
  const dueAt = new Date(started + q.cadence.repeatEveryHours * HOUR);
  return q.now.getTime() >= dueAt.getTime() ? { action: "start", round: last + 1 } : { action: "none", reason: "not_due", dueAt };
}

/** Rounds that actually delivered a message. */
export function sentRounds(rows: readonly OutreachMessageRow[]): number {
  return new Set(rows.filter((r) => r.status === "sent").map((r) => r.sequence)).size;
}
