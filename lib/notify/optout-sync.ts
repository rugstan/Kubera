import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsOptOutSink } from "./optout";
import { maskPhone } from "./phone";

// Pending SMS opt-out syncs to Twenty (`person.smsOptOut`). The Telnyx
// webhook mirrors a STOP / START right away; when that fails (Twenty outage,
// timeout) or finds no Twenty person yet (the lead push is still waiting in the
// crm-retry queue), it leaves a marker here and the crm-retry cron retries it
// after re-pushing leads, so the person it creates is found on the same run.
//
// One row per phone number holds the state Twenty should show; a later change
// replaces an earlier one, so a STOP followed by START never re-applies the
// STOP. The consent ledger stays the source of truth for sending: every text
// checks it, so a marker that never syncs only affects what brokers see.

export type OptOutSyncStatus = "pending" | "synced" | "exhausted";

export type OptOutSyncRow = {
  phone: string;
  optOut: boolean;
  status: OptOutSyncStatus;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  smsMessageId: string | null;
};

export interface OptOutSyncQueue {
  /** Records (or replaces) the state Twenty should show for `phone`, as pending with no attempts yet. */
  enqueue(input: { phone: string; optOut: boolean; reason: string; smsMessageId?: string | null; at: Date }): Promise<void>;
  /** Marks the phone synced at `optOut`. Only touches a marker that still wants that state; never creates one. */
  markSynced(phone: string, optOut: boolean, at: Date): Promise<void>;
  /**
   * A fresh change reached Twenty directly: any marker for the phone (even one
   * wanting the opposite, older state) is now settled at `optOut`. Never creates one.
   */
  settle(phone: string, optOut: boolean, at: Date): Promise<void>;
  /** Counts a failed attempt for a marker that still wants `optOut`. */
  markFailed(phone: string, optOut: boolean, error: string, at: Date, exhausted: boolean): Promise<void>;
  listPending(limit: number): Promise<OptOutSyncRow[]>;
}

/** After this many failed tries the marker is left as `exhausted` for staff (logged loudly). */
export const MAX_OPTOUT_SYNC_ATTEMPTS = 12;
const BASE_BACKOFF_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60_000;

export function optOutBackoffMs(attempts: number): number {
  return attempts <= 0 ? 0 : Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

export type OptOutSyncSummary = { candidates: number; synced: number; failed: number; deferred: number; exhausted: number };

/** Retries due markers. Never throws for one phone; a queue read failure propagates. */
export async function syncPendingOptOuts(deps: { queue: OptOutSyncQueue; sink: SmsOptOutSink; now?: () => number; limit?: number; deadline?: number }): Promise<OptOutSyncSummary> {
  const now = deps.now ?? Date.now;
  const summary: OptOutSyncSummary = { candidates: 0, synced: 0, failed: 0, deferred: 0, exhausted: 0 };
  const rows = await deps.queue.listPending(deps.limit ?? 50);
  summary.candidates = rows.length;
  for (const row of rows) {
    const last = row.lastAttemptAt ? Date.parse(row.lastAttemptAt) : Number.NaN;
    if (Number.isFinite(last) && now() - last < optOutBackoffMs(row.attempts)) {
      summary.deferred++;
      continue;
    }
    if (deps.deadline !== undefined && now() >= deps.deadline) break;
    const at = new Date(now());
    const attempts = row.attempts + 1;
    let error: string;
    try {
      const { updated } = await deps.sink.setOptOut(row.phone, row.optOut);
      if (updated > 0) {
        await deps.queue.markSynced(row.phone, row.optOut, at);
        summary.synced++;
        continue;
      }
      error = "No Twenty person has this phone number yet";
    } catch (err) {
      error = `Twenty sync failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    const exhausted = attempts >= MAX_OPTOUT_SYNC_ATTEMPTS;
    await deps.queue.markFailed(row.phone, row.optOut, error.slice(0, 1000), at, exhausted);
    summary.failed++;
    if (exhausted) {
      summary.exhausted++;
      console.error(`[crm-retry] smsOptOut=${row.optOut} for ${maskPhone(row.phone)} could not be written to Twenty after ${attempts} tries; set it by hand`);
    }
  }
  return summary;
}

// --- Stores ---------------------------------------------------------------------------

export class MemoryOptOutSyncQueue implements OptOutSyncQueue {
  readonly rows = new Map<string, OptOutSyncRow & { reason: string; syncedAt: string | null }>();

  async enqueue(input: { phone: string; optOut: boolean; reason: string; smsMessageId?: string | null; at: Date }) {
    this.rows.set(input.phone, {
      phone: input.phone,
      optOut: input.optOut,
      status: "pending",
      attempts: 0,
      lastAttemptAt: null,
      lastError: input.reason,
      smsMessageId: input.smsMessageId ?? null,
      reason: input.reason,
      syncedAt: null,
    });
  }

  async markSynced(phone: string, optOut: boolean, at: Date) {
    const r = this.rows.get(phone);
    if (r && r.optOut === optOut) Object.assign(r, { status: "synced", syncedAt: at.toISOString(), lastError: null });
  }

  async settle(phone: string, optOut: boolean, at: Date) {
    const r = this.rows.get(phone);
    if (r) Object.assign(r, { optOut, status: "synced", syncedAt: at.toISOString(), lastError: null });
  }

  async markFailed(phone: string, optOut: boolean, error: string, at: Date, exhausted: boolean) {
    const r = this.rows.get(phone);
    if (r && r.optOut === optOut && r.status === "pending") Object.assign(r, { attempts: r.attempts + 1, lastAttemptAt: at.toISOString(), lastError: error, status: exhausted ? "exhausted" : "pending" });
  }

  async listPending(limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.status === "pending")
      .sort((a, b) => (a.lastAttemptAt ?? "").localeCompare(b.lastAttemptAt ?? ""))
      .slice(0, limit)
      .map(({ reason: _r, syncedAt: _s, ...row }) => row);
  }
}

type DbRow = { phone: string; opt_out: boolean; status: OptOutSyncStatus; attempts: number; last_attempt_at: string | null; last_error: string | null; sms_message_id: string | null };

export function supabaseOptOutSyncQueue(db: SupabaseClient): OptOutSyncQueue {
  const table = () => db.from("crm_optout_sync");
  return {
    async enqueue(input) {
      const { error } = await table().upsert(
        {
          phone: input.phone,
          opt_out: input.optOut,
          status: "pending",
          attempts: 0,
          last_attempt_at: null,
          last_error: input.reason.slice(0, 1000),
          synced_at: null,
          sms_message_id: input.smsMessageId ?? null,
        },
        { onConflict: "phone" },
      );
      if (error) throw new Error(`crm_optout_sync enqueue failed: ${error.message}`);
    },
    async markSynced(phone, optOut, at) {
      const { error } = await table().update({ status: "synced", synced_at: at.toISOString(), last_error: null }).eq("phone", phone).eq("opt_out", optOut);
      if (error) throw new Error(`crm_optout_sync update failed: ${error.message}`);
    },
    async settle(phone, optOut, at) {
      const { error } = await table().update({ opt_out: optOut, status: "synced", synced_at: at.toISOString(), last_error: null }).eq("phone", phone);
      if (error) throw new Error(`crm_optout_sync update failed: ${error.message}`);
    },
    async markFailed(phone, optOut, message, at, exhausted) {
      const { data, error } = await table().select("attempts").eq("phone", phone).eq("opt_out", optOut).eq("status", "pending").maybeSingle();
      if (error) throw new Error(`crm_optout_sync read failed: ${error.message}`);
      if (!data) return;
      const attempts = (data as { attempts: number }).attempts;
      const upd = await table()
        .update({ attempts: attempts + 1, last_attempt_at: at.toISOString(), last_error: message.slice(0, 1000), status: exhausted ? "exhausted" : "pending" })
        .eq("phone", phone)
        .eq("opt_out", optOut)
        .eq("status", "pending")
        .eq("attempts", attempts);
      if (upd.error) throw new Error(`crm_optout_sync update failed: ${upd.error.message}`);
    },
    async listPending(limit) {
      const { data, error } = await table()
        .select("phone, opt_out, status, attempts, last_attempt_at, last_error, sms_message_id")
        .eq("status", "pending")
        .order("last_attempt_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw new Error(`crm_optout_sync read failed: ${error.message}`);
      return ((data ?? []) as DbRow[]).map((r) => ({
        phone: r.phone,
        optOut: r.opt_out,
        status: r.status,
        attempts: r.attempts,
        lastAttemptAt: r.last_attempt_at,
        lastError: r.last_error,
        smsMessageId: r.sms_message_id,
      }));
    },
  };
}
