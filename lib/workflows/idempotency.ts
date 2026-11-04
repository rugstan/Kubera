// Idempotent side effects for workflows.
//
// Inngest memoizes completed steps, but a step whose callback crashed after
// the side effect and before Inngest recorded it would run again on retry.
// For effects that must happen at most once (an email, a CRM write, a lender
// submission) wrap them in `idempotentEffect`: it claims the key in
// `workflow_effects`, runs the effect once, stores the result, and returns the
// stored result to every later caller.
//
//   new key            → claim (in_progress), run, store result (completed)
//   completed          → return stored result; the effect does not run again
//   in_progress, fresh → another attempt is running: retry later
//   in_progress, stale → the earlier attempt died mid-effect and we cannot tell
//                        whether it went out: stop and ask a human
//   failed             → the effect threw before completing: may run again
//
// Effects should also pass the key to the provider where supported (e.g. an
// Idempotency-Key header) so a timeout after the provider accepted the request
// cannot double-send.

import type { SupabaseClient } from "@supabase/supabase-js";

export type EffectClaim =
  | { state: "claimed" }
  | { state: "completed"; result: unknown }
  | { state: "in_progress"; startedAt: string };

export interface IdempotencyStore {
  claim(key: string, meta: { workflow: string; runId?: string }, now: Date): Promise<EffectClaim>;
  complete(key: string, result: unknown, now: Date): Promise<void>;
  fail(key: string, error: string, now: Date): Promise<void>;
}

/** Retry later: an attempt for this key is running right now. */
export class EffectInProgressError extends Error {
  constructor(readonly key: string) {
    super(`Effect ${key} is already in progress`);
    this.name = "EffectInProgressError";
  }
}

/** The earlier attempt died mid-effect; whether it happened is unknown. Never retried automatically. */
export class EffectOutcomeUnknownError extends Error {
  constructor(readonly key: string) {
    super(`Effect ${key} was interrupted mid-flight; outcome unknown, needs staff review`);
    this.name = "EffectOutcomeUnknownError";
  }
}

export const EFFECT_STALE_MS = 15 * 60_000;

export async function idempotentEffect<T>(
  store: IdempotencyStore,
  key: string,
  meta: { workflow: string; runId?: string },
  effect: () => Promise<T>,
  opts: { now?: () => Date; staleMs?: number } = {},
): Promise<{ result: T; replayed: boolean }> {
  const now = opts.now ?? (() => new Date());
  const claim = await store.claim(key, meta, now());
  if (claim.state === "completed") return { result: claim.result as T, replayed: true };
  if (claim.state === "in_progress") {
    if (now().getTime() - Date.parse(claim.startedAt) > (opts.staleMs ?? EFFECT_STALE_MS)) throw new EffectOutcomeUnknownError(key);
    throw new EffectInProgressError(key);
  }
  let result: T;
  try {
    result = await effect();
  } catch (err) {
    await store.fail(key, err instanceof Error ? err.message.slice(0, 1000) : String(err), now());
    throw err;
  }
  await store.complete(key, result ?? null, now());
  return { result, replayed: false };
}

// --- Memory --------------------------------------------------------------------------

type Row = { status: "in_progress" | "completed" | "failed"; startedAt: string; result?: unknown; error?: string; workflow: string; attempts: number };

export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly rows = new Map<string, Row>();

  async claim(key: string, meta: { workflow: string }, now: Date): Promise<EffectClaim> {
    const row = this.rows.get(key);
    if (!row || row.status === "failed") {
      this.rows.set(key, { status: "in_progress", startedAt: now.toISOString(), workflow: meta.workflow, attempts: (row?.attempts ?? 0) + 1 });
      return { state: "claimed" };
    }
    if (row.status === "completed") return { state: "completed", result: row.result };
    return { state: "in_progress", startedAt: row.startedAt };
  }

  async complete(key: string, result: unknown): Promise<void> {
    const row = this.rows.get(key);
    if (row) Object.assign(row, { status: "completed", result: JSON.parse(JSON.stringify(result ?? null)) });
  }

  async fail(key: string, error: string): Promise<void> {
    const row = this.rows.get(key);
    if (row) Object.assign(row, { status: "failed", error });
  }
}

// --- Supabase (workflow_effects) ------------------------------------------------------------

type DbRow = { status: Row["status"]; started_at: string; result: unknown };

export function supabaseIdempotencyStore(db: SupabaseClient): IdempotencyStore {
  const table = () => db.from("workflow_effects");
  return {
    async claim(key, meta, now) {
      const inserted = await table()
        .insert({ idempotency_key: key, workflow: meta.workflow, run_id: meta.runId ?? null, status: "in_progress", started_at: now.toISOString(), attempts: 1 })
        .select("status")
        .maybeSingle();
      if (!inserted.error) return { state: "claimed" };
      if (inserted.error.code !== "23505") throw new Error(`workflow_effects claim failed: ${inserted.error.message}`);
      // Existing key: re-claim only a failed attempt (conditional update avoids races).
      const reclaimed = await table()
        .update({ status: "in_progress", started_at: now.toISOString(), error: null, run_id: meta.runId ?? null })
        .eq("idempotency_key", key)
        .eq("status", "failed")
        .select("status");
      if (reclaimed.error) throw new Error(`workflow_effects reclaim failed: ${reclaimed.error.message}`);
      if (reclaimed.data?.length) return { state: "claimed" };
      const { data, error } = await table().select("status, started_at, result").eq("idempotency_key", key).maybeSingle();
      if (error || !data) throw new Error(`workflow_effects read failed: ${error?.message ?? "row vanished"}`);
      const row = data as DbRow;
      if (row.status === "completed") return { state: "completed", result: row.result };
      return { state: "in_progress", startedAt: row.started_at };
    },
    async complete(key, result, now) {
      const { error } = await table().update({ status: "completed", result: result ?? null, completed_at: now.toISOString() }).eq("idempotency_key", key);
      if (error) throw new Error(`workflow_effects complete failed: ${error.message}`);
    },
    async fail(key, message, now) {
      const { error } = await table().update({ status: "failed", error: message, completed_at: now.toISOString() }).eq("idempotency_key", key);
      if (error) console.error("workflow_effects fail update failed", error.message);
    },
  };
}
