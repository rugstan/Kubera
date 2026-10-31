// Embeddings for the knowledge base (public.kb_chunks.embedding, vector(1024)).
//
//   Voyage AI    POST https://api.voyageai.com/v1/embeddings   (1024 dims)
//   NVIDIA NIM   POST <NVIDIA_NIM_BASE_URL>/embeddings          (1024 dims)
//
// Same shape as the model gateway (lib/ai/gateway.ts): a typed client with an
// interface, a real implementation per provider and an in-memory fake, selected
// from the environment. Missing keys mean "no embeddings": retrieval then uses
// full-text search alone and nothing crashes (Global rule 3).
//
// Every text passes the model routing guard (lib/ai/routing.ts) with purpose
// "embedding" first. The guard knows Claude, NVIDIA and xAI; Voyage is held to
// the NVIDIA embedding policy (nothing above "confidential", never restricted
// fields such as SSNs or account numbers, which are redacted before they leave).

import { prepareForRoute } from "@/lib/ai/routing";

/** kb_chunks.embedding is vector(1024); a different model needs a migration. */
export const EMBEDDING_DIMS = 1024;

export type EmbedKind = "document" | "query";
export type EmbeddingProvider = "voyage" | "nvidia" | "fake";

export interface EmbeddingClient {
  readonly provider: EmbeddingProvider;
  /** Recorded in kb_chunks.embedding_model; a change re-embeds every chunk. */
  readonly model: string;
  configured(): boolean;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

type FetchLike = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

type HttpOptions = { fetch?: FetchLike; sleep?: Sleep; maxAttempts?: number; timeoutMs?: number };

const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url: string, apiKey: string, body: unknown, opts: HttpOptions, label: string): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const attempts = opts.maxAttempts ?? 3;
  let last: EmbeddingError | undefined;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(250 * 2 ** (i - 1));
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      last = new EmbeddingError(`${label} request failed: ${err instanceof Error ? err.message : "network error"}`, null, true);
      continue;
    }
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    // The body can echo the input; keep only a short status line.
    last = new EmbeddingError(`${label} returned ${res.status}`, res.status, retryable);
    if (!retryable) break;
  }
  throw last ?? new EmbeddingError(`${label} failed`);
}

function readVectors(json: unknown, expected: number, label: string): number[][] {
  const data = (json as { data?: { embedding?: unknown; index?: number }[] } | null)?.data;
  if (!Array.isArray(data) || data.length !== expected) throw new EmbeddingError(`${label} returned ${Array.isArray(data) ? data.length : 0} embeddings for ${expected} inputs`);
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((d) => {
    const v = d.embedding;
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMS || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new EmbeddingError(`${label} returned a vector that is not ${EMBEDDING_DIMS} finite numbers`);
    }
    return v as number[];
  });
}

async function inBatches(texts: string[], size: number, run: (batch: string[]) => Promise<number[][]>): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += size) out.push(...(await run(texts.slice(i, i + size))));
  return out;
}

export const VOYAGE_BASE_URL = "https://api.voyageai.com/v1";
export const NVIDIA_EMBED_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_VOYAGE_MODEL = "voyage-3.5";
export const DEFAULT_NVIDIA_EMBED_MODEL = "nvidia/nv-embedqa-e5-v5";

export class VoyageEmbeddings implements EmbeddingClient {
  readonly provider = "voyage" as const;
  readonly model: string;
  constructor(
    private readonly cfg: { apiKey?: string; model?: string; baseUrl?: string } & HttpOptions,
  ) {
    this.model = cfg.model?.trim() || DEFAULT_VOYAGE_MODEL;
  }
  configured(): boolean {
    return Boolean(this.cfg.apiKey);
  }
  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (!this.cfg.apiKey) throw new EmbeddingError("VOYAGE_API_KEY is not set");
    const url = `${(this.cfg.baseUrl ?? VOYAGE_BASE_URL).replace(/\/$/, "")}/embeddings`;
    return inBatches(texts, 64, async (batch) => {
      const json = await postJson(url, this.cfg.apiKey!, { input: batch, model: this.model, input_type: kind, output_dimension: EMBEDDING_DIMS, truncation: true }, this.cfg, "Voyage embeddings");
      return readVectors(json, batch.length, "Voyage embeddings");
    });
  }
}

export class NvidiaEmbeddings implements EmbeddingClient {
  readonly provider = "nvidia" as const;
  readonly model: string;
  constructor(
    private readonly cfg: { apiKey?: string; model?: string; baseUrl?: string } & HttpOptions,
  ) {
    this.model = cfg.model?.trim() || DEFAULT_NVIDIA_EMBED_MODEL;
  }
  configured(): boolean {
    return Boolean(this.cfg.apiKey);
  }
  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (!this.cfg.apiKey) throw new EmbeddingError("NVIDIA_API_KEY is not set");
    const url = `${(this.cfg.baseUrl ?? NVIDIA_EMBED_BASE_URL).replace(/\/$/, "")}/embeddings`;
    return inBatches(texts, 32, async (batch) => {
      const json = await postJson(
        url,
        this.cfg.apiKey!,
        { input: batch, model: this.model, input_type: kind === "document" ? "passage" : "query", encoding_format: "float", truncate: "END" },
        this.cfg,
        "NVIDIA embeddings",
      );
      return readVectors(json, batch.length, "NVIDIA embeddings");
    });
  }
}

/**
 * Deterministic stand-in for tests and local runs: hashes words into a signed
 * bag-of-words vector, so texts that share words have higher cosine similarity.
 * It is not semantic, only stable and offline.
 */
export class FakeEmbeddings implements EmbeddingClient {
  readonly provider = "fake" as const;
  readonly model = "fake-bow-1024";
  readonly calls: { texts: string[]; kind: EmbedKind }[] = [];
  configured(): boolean {
    return true;
  }
  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    this.calls.push({ texts: [...texts], kind });
    return texts.map(fakeVector);
  }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function fakeVector(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = fnv1a(word);
    v[h % EMBEDDING_DIMS]! += h & 0x80000000 ? -1 : 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * Provider from the environment. EMBEDDINGS_PROVIDER = voyage | nvidia | off;
 * unset picks Voyage when VOYAGE_API_KEY is set, else NVIDIA when NVIDIA_API_KEY
 * is set, else none (null).
 */
export function embeddingClientFromEnv(env: Record<string, string | undefined> = process.env, http: HttpOptions = {}): EmbeddingClient | null {
  const want = env.EMBEDDINGS_PROVIDER?.trim().toLowerCase();
  if (want === "off" || want === "none") return null;
  const voyageKey = env.VOYAGE_API_KEY?.trim();
  const nvidiaKey = env.NVIDIA_API_KEY?.trim();
  const voyage = () => new VoyageEmbeddings({ apiKey: voyageKey, model: env.VOYAGE_EMBED_MODEL, ...http });
  const nvidia = () => new NvidiaEmbeddings({ apiKey: nvidiaKey, model: env.NVIDIA_EMBED_MODEL, baseUrl: env.NVIDIA_NIM_BASE_URL?.trim() || undefined, ...http });
  if (want === "voyage") return voyageKey ? voyage() : null;
  if (want === "nvidia") return nvidiaKey ? nvidia() : null;
  if (voyageKey) return voyage();
  if (nvidiaKey) return nvidia();
  return null;
}

/** Thrown when the routing guard will not let the text go to the embedding provider. */
export class EmbeddingRefusedError extends Error {
  constructor() {
    super("Embedding refused by the model routing guard");
    this.name = "EmbeddingRefusedError";
  }
}

/**
 * Runs the texts through the routing guard (redacting restricted values) and
 * embeds what is left. Throws EmbeddingRefusedError when nothing may be sent.
 */
export async function embedGuarded(client: EmbeddingClient, texts: string[], kind: EmbedKind, opts: { subject?: { aiProcessingOptOut?: boolean } } = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const routed = prepareForRoute({
    // Voyage and the fake are held to the NVIDIA embedding policy (see the file header).
    model: client.provider === "nvidia" ? client.model : "nvidia/embedding-policy",
    provider: "nvidia",
    purpose: "embedding",
    payload: texts,
    // Knowledge-base text is public; user queries are raised by detection if they carry personal data.
    declared: { level: kind === "document" ? "public" : "internal" },
    ...(opts.subject ? { subject: opts.subject } : {}),
  });
  if (!routed) throw new EmbeddingRefusedError();
  return client.embed(routed.payload, kind);
}

let shared: { client: EmbeddingClient | null } | undefined;
let warned = false;

/** Process-wide client from the environment (null = embeddings off). */
export function embeddingClient(): EmbeddingClient | null {
  if (shared) return shared.client;
  const client = embeddingClientFromEnv();
  if (!client && !warned) {
    warned = true;
    console.warn("[embeddings] No embedding provider configured (VOYAGE_API_KEY or NVIDIA_API_KEY); knowledge-base retrieval uses full-text search only.");
  }
  shared = { client };
  return client;
}

/** Test hook (undefined restores the environment-derived client). */
export function setEmbeddingClient(client: EmbeddingClient | null | undefined): void {
  shared = client === undefined ? undefined : { client };
}

/**
 * Embedding for a retrieval query, or null when embeddings are off, refused by
 * the routing guard, or the provider failed. Never throws: callers fall back to
 * full-text retrieval.
 */
export async function embedQuery(query: string, opts: { subject?: { aiProcessingOptOut?: boolean }; client?: EmbeddingClient | null } = {}): Promise<number[] | null> {
  const client = opts.client === undefined ? embeddingClient() : opts.client;
  if (!client?.configured() || !query.trim()) return null;
  try {
    const [vector] = await embedGuarded(client, [query.slice(0, 2_000)], "query", opts.subject ? { subject: opts.subject } : {});
    return vector ?? null;
  } catch (err) {
    if (!(err instanceof EmbeddingRefusedError)) console.error("[embeddings] query embedding failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/** pgvector text form ("[0.1,0.2,...]"), the format PostgREST accepts for a vector parameter. */
export function toPgVector(v: readonly number[]): string {
  return `[${v.map((n) => Number(n.toPrecision(7))).join(",")}]`;
}
