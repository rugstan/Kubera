// Langfuse tracing (env-gated). Every model call the gateway makes and every
// workflow run can be recorded as a Langfuse trace with generations and spans.
//
// Privacy: by default only metadata leaves the server (model, provider,
// purpose, token counts, latency, stop reason, routing level). Prompt and
// completion text are sent only when LANGFUSE_CAPTURE_CONTENT=true, and even
// then everything above `internal` is redacted first (lib/privacy/classification.ts),
// so borrower PII never reaches the tracing vendor.
//
// Missing keys → a no-op tracer (logged once). Tests use MemoryTracer.

import { redactPayload } from "@/lib/privacy/classification";

export type TraceLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";

export type TraceInput = {
  /** Stable id (e.g. the agent run id) so retries land on one trace. */
  id?: string;
  name: string;
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  input?: unknown;
};

export type GenerationInput = {
  name: string;
  model: string;
  provider: string;
  startTime: Date;
  endTime: Date;
  input?: unknown;
  output?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
  level?: TraceLevel;
  statusMessage?: string;
  metadata?: Record<string, unknown>;
};

export type SpanInput = {
  name: string;
  startTime: Date;
  endTime: Date;
  level?: TraceLevel;
  statusMessage?: string;
  metadata?: Record<string, unknown>;
  output?: unknown;
};

export interface TraceHandle {
  readonly id: string;
  generation(g: GenerationInput): void;
  span(s: SpanInput): void;
  /** Records the trace output / final metadata. */
  end(update?: { output?: unknown; metadata?: Record<string, unknown>; level?: TraceLevel }): void;
}

export interface Tracer {
  readonly enabled: boolean;
  trace(input: TraceInput): TraceHandle;
  /** Sends everything buffered. Never throws. */
  flush(): Promise<void>;
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

// --- No-op -----------------------------------------------------------------------

export const noopTracer: Tracer = {
  enabled: false,
  trace(input) {
    const id = input.id ?? randomId();
    return { id, generation() {}, span() {}, end() {} };
  },
  async flush() {},
};

// --- In-memory (tests) ---------------------------------------------------------------

export type RecordedTrace = TraceInput & {
  id: string;
  generations: GenerationInput[];
  spans: SpanInput[];
  ended?: { output?: unknown; metadata?: Record<string, unknown>; level?: TraceLevel };
};

export class MemoryTracer implements Tracer {
  readonly enabled = true;
  readonly traces: RecordedTrace[] = [];
  flushes = 0;

  trace(input: TraceInput): TraceHandle {
    const rec: RecordedTrace = { ...input, id: input.id ?? randomId(), generations: [], spans: [] };
    this.traces.push(rec);
    return {
      id: rec.id,
      generation: (g) => void rec.generations.push(g),
      span: (s) => void rec.spans.push(s),
      end: (u) => {
        rec.ended = u ?? {};
      },
    };
  }

  async flush(): Promise<void> {
    this.flushes++;
  }

  /** Every generation across traces (flattened). */
  get generations(): GenerationInput[] {
    return this.traces.flatMap((t) => t.generations);
  }
}

// --- Langfuse ingestion API ----------------------------------------------------------

export type LangfuseConfig = {
  publicKey: string;
  secretKey: string;
  /** e.g. https://us.cloud.langfuse.com (no trailing slash). */
  baseUrl: string;
  /** Send redacted prompt/completion text. Default false (metadata only). */
  captureContent: boolean;
  environment?: string;
  release?: string;
  fetch?: typeof fetch;
  /** Flush automatically once this many events are buffered. */
  maxBatch?: number;
};

type IngestionEvent = { id: string; timestamp: string; type: string; body: Record<string, unknown> };

/** Strips content above `internal` so no PII reaches the tracing vendor. */
export function scrubForTrace(value: unknown): unknown {
  if (value === undefined) return undefined;
  return redactPayload(value, "internal");
}

export class LangfuseTracer implements Tracer {
  readonly enabled = true;
  private buffer: IngestionEvent[] = [];
  private readonly fetchImpl: typeof fetch;
  private inflight: Promise<void> = Promise.resolve();

  constructor(private readonly config: LangfuseConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private content(value: unknown): unknown {
    return this.config.captureContent ? scrubForTrace(value) : undefined;
  }

  private push(type: string, body: Record<string, unknown>): void {
    this.buffer.push({ id: randomId(), timestamp: new Date().toISOString(), type, body });
    if (this.buffer.length >= (this.config.maxBatch ?? 50)) void this.flush();
  }

  trace(input: TraceInput): TraceHandle {
    const id = input.id ?? randomId();
    this.push("trace-create", {
      id,
      name: input.name,
      sessionId: input.sessionId,
      tags: input.tags,
      metadata: input.metadata,
      input: this.content(input.input),
      environment: this.config.environment,
      release: this.config.release,
      timestamp: new Date().toISOString(),
    });
    return {
      id,
      generation: (g) =>
        this.push("generation-create", {
          id: randomId(),
          traceId: id,
          name: g.name,
          model: g.model,
          startTime: g.startTime.toISOString(),
          endTime: g.endTime.toISOString(),
          input: this.content(g.input),
          output: this.content(g.output),
          usage: g.usage ? { input: g.usage.inputTokens ?? 0, output: g.usage.outputTokens ?? 0, unit: "TOKENS" } : undefined,
          level: g.level ?? "DEFAULT",
          statusMessage: g.statusMessage,
          metadata: { provider: g.provider, ...g.metadata },
          environment: this.config.environment,
        }),
      span: (s) =>
        this.push("span-create", {
          id: randomId(),
          traceId: id,
          name: s.name,
          startTime: s.startTime.toISOString(),
          endTime: s.endTime.toISOString(),
          level: s.level ?? "DEFAULT",
          statusMessage: s.statusMessage,
          metadata: s.metadata,
          output: this.content(s.output),
          environment: this.config.environment,
        }),
      end: (u) =>
        this.push("trace-create", {
          id,
          output: this.content(u?.output),
          metadata: u?.metadata,
          ...(u?.level && u.level !== "DEFAULT" ? { tags: [...(input.tags ?? []), `level:${u.level.toLowerCase()}`] } : {}),
        }),
    };
  }

  async flush(): Promise<void> {
    const batch = this.buffer.splice(0);
    if (!batch.length) return this.inflight;
    const auth = Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString("base64");
    const send = async () => {
      try {
        const res = await this.fetchImpl(`${this.config.baseUrl}/api/public/ingestion`, {
          method: "POST",
          headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
          body: JSON.stringify({ batch, metadata: { sdk_name: "corin-langfuse", sdk_version: "1" } }),
          signal: AbortSignal.timeout(5_000),
        });
        // 207 = partial success; individual errors are reported per event.
        if (!res.ok && res.status !== 207) console.warn(`[langfuse] ingestion failed: HTTP ${res.status}`);
      } catch (err) {
        console.warn("[langfuse] ingestion failed:", err instanceof Error ? err.message : err);
      }
    };
    this.inflight = this.inflight.then(send);
    return this.inflight;
  }
}

// --- Env wiring ---------------------------------------------------------------------

export function langfuseConfigFromEnv(env: Record<string, string | undefined> = process.env): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return null;
  const baseUrl = (env.LANGFUSE_BASE_URL?.trim() || "https://us.cloud.langfuse.com").replace(/\/+$/, "");
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) {
    console.warn("[langfuse] LANGFUSE_BASE_URL must be https; tracing disabled");
    return null;
  }
  return {
    publicKey,
    secretKey,
    baseUrl,
    captureContent: env.LANGFUSE_CAPTURE_CONTENT === "true",
    environment: env.VERCEL_ENV ?? env.NODE_ENV,
    release: env.VERCEL_GIT_COMMIT_SHA,
  };
}

let tracer: Tracer | undefined;
let warned = false;

/** Process-wide tracer: Langfuse when configured, otherwise a no-op. */
export function getTracer(): Tracer {
  if (tracer) return tracer;
  const config = langfuseConfigFromEnv();
  if (!config && !warned) {
    warned = true;
    console.info("[langfuse] LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY not set; tracing disabled.");
  }
  tracer = config ? new LangfuseTracer(config) : noopTracer;
  return tracer;
}

/** Test hook (undefined restores env-based resolution). */
export function setTracer(t: Tracer | undefined): void {
  tracer = t;
}
