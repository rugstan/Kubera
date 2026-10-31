// The step surface our workflow logic is written against. In production it
// is Inngest's `step` (adapted below); in tests it is FakeStep, which models
// Inngest's semantics closely enough to test the guarantees we rely on:
//
//   - step.run memoizes by id: a replayed function gets the stored result and
//     the callback does not run again (each side effect sits in its own step).
//   - step.waitForEvent resolves with the first matching event, or null when
//     the timeout passes.
//
// Step results must be JSON-serializable (Inngest stores them as JSON).

export type WorkflowEvent<TData extends Record<string, unknown> = Record<string, unknown>> = {
  name: string;
  data: TData;
  id?: string;
  ts?: number;
};

export type OutgoingEvent = { name: string; data: Record<string, unknown>; id?: string };

export type WaitOptions = {
  event: string;
  /** Milliseconds (≥ 1000) or an `ms`-style string like "30m". */
  timeout: number | string;
  /** CEL expression on `event` (the trigger) and `async` (the awaited event). */
  if?: string;
};

export interface WorkflowStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
  waitForEvent(id: string, opts: WaitOptions): Promise<WorkflowEvent | null>;
  sleep(id: string, durationMs: number): Promise<void>;
  sendEvent(id: string, events: OutgoingEvent | OutgoingEvent[]): Promise<void>;
}

/** The parts of Inngest's step tools we use (structural, so tests need not import Inngest). */
export type InngestStepLike = {
  run: (id: string, fn: () => unknown) => Promise<unknown>;
  waitForEvent: (id: string, opts: { event: string; timeout: number | string; if?: string }) => Promise<unknown>;
  sleep: (id: string, duration: number | string) => Promise<unknown>;
  sendEvent: (id: string, payload: OutgoingEvent | OutgoingEvent[]) => Promise<unknown>;
};

export function fromInngestStep(step: InngestStepLike): WorkflowStep {
  return {
    run: <T>(id: string, fn: () => Promise<T> | T) => step.run(id, fn) as Promise<T>,
    async waitForEvent(id, opts) {
      const evt = (await step.waitForEvent(id, { event: opts.event, timeout: opts.timeout, ...(opts.if ? { if: opts.if } : {}) })) as WorkflowEvent | null;
      return evt ?? null;
    },
    async sleep(id, durationMs) {
      await step.sleep(id, Math.max(1000, Math.round(durationMs)));
    },
    async sendEvent(id, events) {
      await step.sendEvent(id, events);
    },
  };
}

// --- Fake ------------------------------------------------------------------------------

type ScriptedWait = WorkflowEvent | null | ((opts: WaitOptions) => WorkflowEvent | null);

/**
 * Deterministic in-memory step runner. `waits` scripts waitForEvent results by
 * step id (a missing entry times out → null) and advances the fake clock by the
 * timeout when it does. Re-running a workflow with the same FakeStep replays
 * memoized steps, like an Inngest retry.
 */
export class FakeStep implements WorkflowStep {
  readonly memo = new Map<string, unknown>();
  /** Step ids whose callbacks actually ran (not replayed), in order. */
  readonly executed: string[] = [];
  readonly waits: { id: string; opts: WaitOptions; result: WorkflowEvent | null }[] = [];
  readonly sent: OutgoingEvent[] = [];
  private readonly scripted = new Map<string, ScriptedWait>();
  private onWait: ((id: string, opts: WaitOptions) => void) | undefined;

  constructor(readonly clock: { now: number } = { now: Date.UTC(2026, 10, 3, 17, 0, 0) }) {}

  /** Scripts the result of a waitForEvent step (null = timeout). */
  script(id: string, result: ScriptedWait): this {
    this.scripted.set(id, result);
    return this;
  }

  /** Called before each wait resolves (e.g. to approve in the gate mid-wait). */
  beforeWait(fn: (id: string, opts: WaitOptions) => void): this {
    this.onWait = fn;
    return this;
  }

  now = (): number => this.clock.now;

  async run<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
    if (this.memo.has(id)) return this.memo.get(id) as T;
    const value = await fn();
    // JSON round-trip, as Inngest stores step output.
    const stored = value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
    this.memo.set(id, stored);
    this.executed.push(id);
    return stored as T;
  }

  async waitForEvent(id: string, opts: WaitOptions): Promise<WorkflowEvent | null> {
    if (this.memo.has(id)) return this.memo.get(id) as WorkflowEvent | null;
    this.onWait?.(id, opts);
    const scripted = this.scripted.get(id);
    const result = typeof scripted === "function" ? scripted(opts) : (scripted ?? null);
    if (result === null) this.clock.now += typeof opts.timeout === "number" ? opts.timeout : parseDuration(opts.timeout);
    else this.clock.now += 1000;
    this.memo.set(id, result);
    this.waits.push({ id, opts, result });
    return result;
  }

  async sleep(id: string, durationMs: number): Promise<void> {
    if (this.memo.has(id)) return;
    this.clock.now += durationMs;
    this.memo.set(id, null);
    this.executed.push(id);
  }

  async sendEvent(id: string, events: OutgoingEvent | OutgoingEvent[]): Promise<void> {
    if (this.memo.has(id)) return;
    this.sent.push(...(Array.isArray(events) ? events : [events]));
    this.memo.set(id, null);
    this.executed.push(id);
  }
}

/** Parses "250ms", "30s", "15m", "2h", "1d" into milliseconds. */
export function parseDuration(value: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(value.trim());
  if (!m) throw new Error(`Unsupported duration: ${value}`);
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "ms" | "s" | "m" | "h" | "d"];
  return n * unit;
}
