// Knowledge-base ingestion: Markdown excerpts in ./knowledge -> kb_chunks rows
// (text, content hash, embedding). scripts/ingest-kb.ts is the CLI around this.
//
// Idempotent: a chunk is re-written only when its text changed, and re-embedded
// only when its text changed, it has no embedding, or the embedding model
// changed (kb_chunks.embedding_model). Re-running costs nothing when nothing
// moved. Sections that disappeared from a file are pruned. Without an embedding
// provider the text and full-text index are still loaded and embedding is
// reported as skipped.
//
// No "server-only" import: the CLI runs outside Next.

import { createHash } from "node:crypto";
import { embedGuarded, toPgVector, type EmbeddingClient } from "./embeddings";

/** One section's text is capped so a chunk stays well inside the embedding input limit. */
export const MAX_CHUNK_CHARS = 4_000;

export type KbChunkDraft = {
  source: string;
  section: string;
  content: string;
  sha256: string;
};

export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Splits a long body on paragraph boundaries into pieces of at most `max` characters. */
function splitBody(body: string, max: number): string[] {
  if (body.length <= max) return [body];
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  for (const para of body.split(/\n{2,}/)) {
    if (para.length > max) {
      flush();
      for (let i = 0; i < para.length; i += max) parts.push(para.slice(i, i + max).trim());
      continue;
    }
    if (current && current.length + para.length + 2 > max) flush();
    current += (current ? "\n\n" : "") + para;
  }
  flush();
  return parts.filter(Boolean);
}

/**
 * Each "## " heading becomes one chunk keyed by (source, heading); a section
 * longer than `max` becomes "Heading (1)", "Heading (2)", ... Text before the
 * first "## " (the file title and intro) is not retrievable.
 */
export function chunkMarkdown(source: string, markdown: string, max: number = MAX_CHUNK_CHARS): KbChunkDraft[] {
  const out: KbChunkDraft[] = [];
  const seen = new Map<string, number>();
  for (const block of markdown.replace(/\r\n/g, "\n").split(/^## /m).slice(1)) {
    const [headingLine = "", ...rest] = block.split("\n");
    const heading = headingLine.trim();
    const body = rest.join("\n").trim();
    if (!heading || !body) continue;
    const pieces = splitBody(body, max);
    // Two sections with the same heading would collide on (source, section).
    const n = (seen.get(heading) ?? 0) + 1;
    seen.set(heading, n);
    const base = n > 1 ? `${heading} [${n}]` : heading;
    pieces.forEach((content, i) => {
      const section = pieces.length > 1 ? `${base} (${i + 1})` : base;
      out.push({ source, section, content, sha256: sha256Hex(`${section}\n${content}`) });
    });
  }
  return out;
}

/** What gets embedded: the heading travels with the body so a short section keeps its context. */
export function embeddingText(c: Pick<KbChunkDraft, "source" | "section" | "content">): string {
  return `${c.source}: ${c.section}\n\n${c.content}`.slice(0, 6_000);
}

export type StoredKbChunk = {
  source: string;
  section: string;
  contentSha256: string | null;
  embeddingModel: string | null;
  hasEmbedding: boolean;
};

export type KbRowWrite = {
  source: string;
  section: string;
  content: string;
  contentSha256: string;
  /** Present when the row is written with a fresh embedding; absent rows get no embedding. */
  embedding?: { vector: string; model: string; at: string };
};

export interface KbStore {
  list(): Promise<StoredKbChunk[]>;
  /** Insert-or-update by (source, section). A row written without `embedding` has its embedding cleared. */
  upsert(rows: KbRowWrite[]): Promise<void>;
  remove(keys: { source: string; section: string }[]): Promise<void>;
}

const key = (c: { source: string; section: string }) => `${c.source}\u0000${c.section}`;

export type IngestPlan = {
  /** Rows to write: new or changed text, plus unchanged text that needs (re)embedding. */
  write: { draft: KbChunkDraft; reason: "new" | "changed" | "embed" }[];
  /** Subset of `write` that gets embedded. */
  embed: KbChunkDraft[];
  unchanged: number;
  remove: { source: string; section: string }[];
};

export function planIngest(
  drafts: readonly KbChunkDraft[],
  stored: readonly StoredKbChunk[],
  opts: { embeddingModel: string | null; reembed?: boolean; prune?: boolean; pruneMissingFiles?: boolean },
): IngestPlan {
  const byKey = new Map(stored.map((s) => [key(s), s]));
  const write: IngestPlan["write"] = [];
  const embed: KbChunkDraft[] = [];
  let unchanged = 0;

  for (const d of drafts) {
    const s = byKey.get(key(d));
    const textChanged = !s || s.contentSha256 !== d.sha256;
    const wantsEmbedding = opts.embeddingModel !== null && (textChanged || opts.reembed === true || !s?.hasEmbedding || s.embeddingModel !== opts.embeddingModel);
    if (!s) write.push({ draft: d, reason: "new" });
    else if (textChanged) write.push({ draft: d, reason: "changed" });
    else if (wantsEmbedding) write.push({ draft: d, reason: "embed" });
    else unchanged += 1;
    if (wantsEmbedding) embed.push(d);
  }

  const remove: IngestPlan["remove"] = [];
  if (opts.prune !== false) {
    const keep = new Set(drafts.map(key));
    const sources = new Set(drafts.map((d) => d.source));
    for (const s of stored) {
      if (keep.has(key(s))) continue;
      // Stale section of a file that is still there, or (opt-in) a source with no file.
      if (sources.has(s.source) || opts.pruneMissingFiles) remove.push({ source: s.source, section: s.section });
    }
  }
  return { write, embed, unchanged, remove };
}

export type IngestSummary = {
  chunks: number;
  written: number;
  embedded: number;
  unchanged: number;
  removed: number;
  /** Why embedding did not happen for rows that wanted it (no provider, provider error, routing refusal). */
  embeddingSkipped: string | null;
  dryRun: boolean;
};

const EMBED_BATCH = 32;

export async function runIngest(opts: {
  drafts: readonly KbChunkDraft[];
  store: KbStore;
  embeddings: EmbeddingClient | null;
  reembed?: boolean;
  prune?: boolean;
  pruneMissingFiles?: boolean;
  dryRun?: boolean;
  now?: () => Date;
  log?: (line: string) => void;
}): Promise<IngestSummary> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const client = opts.embeddings?.configured() ? opts.embeddings : null;
  const stored = await opts.store.list();
  const plan = planIngest(opts.drafts, stored, { embeddingModel: client?.model ?? null, reembed: opts.reembed ?? false, prune: opts.prune ?? true, pruneMissingFiles: opts.pruneMissingFiles ?? false });

  const summary: IngestSummary = {
    chunks: opts.drafts.length,
    written: plan.write.length,
    embedded: 0,
    unchanged: plan.unchanged,
    removed: plan.remove.length,
    embeddingSkipped: client ? null : "no embedding provider configured",
    dryRun: opts.dryRun ?? false,
  };
  if (opts.dryRun) {
    summary.embedded = plan.embed.length;
    return summary;
  }

  const embedSet = new Set(plan.embed.map(key));
  for (let i = 0; i < plan.write.length; i += EMBED_BATCH) {
    const batch = plan.write.slice(i, i + EMBED_BATCH);
    const wanted = batch.filter((w) => embedSet.has(key(w.draft)));
    let vectors: number[][] | null = null;
    if (client && wanted.length) {
      try {
        vectors = await embedGuarded(client, wanted.map((w) => embeddingText(w.draft)), "document");
      } catch (err) {
        summary.embeddingSkipped = err instanceof Error ? err.message : "embedding failed";
        log(`embedding failed for ${wanted.length} chunk(s): ${summary.embeddingSkipped}`);
      }
    }
    const byKey = new Map<string, number[]>();
    wanted.forEach((w, j) => {
      const v = vectors?.[j];
      if (v) byKey.set(key(w.draft), v);
    });
    const at = now().toISOString();
    // An "embed only" row whose embedding failed is left as it was, rather than rewritten without a vector.
    const writes = batch.filter((w) => w.reason !== "embed" || byKey.has(key(w.draft)));
    if (writes.length === 0) continue;
    await opts.store.upsert(
      writes.map(({ draft }) => {
        const v = byKey.get(key(draft));
        return {
          source: draft.source,
          section: draft.section,
          content: draft.content,
          contentSha256: draft.sha256,
          ...(v && client ? { embedding: { vector: toPgVector(v), model: client.model, at } } : {}),
        };
      }),
    );
    summary.embedded += byKey.size;
  }

  if (plan.remove.length) await opts.store.remove(plan.remove);
  return summary;
}

/** In-memory store for tests and dry runs. */
export class MemoryKbStore implements KbStore {
  readonly rows = new Map<string, KbRowWrite & { hasEmbedding: boolean; embeddingModel: string | null; embeddingVector: string | null }>();

  async list(): Promise<StoredKbChunk[]> {
    return [...this.rows.values()].map((r) => ({ source: r.source, section: r.section, contentSha256: r.contentSha256, embeddingModel: r.embeddingModel, hasEmbedding: r.hasEmbedding }));
  }

  async upsert(rows: KbRowWrite[]): Promise<void> {
    for (const r of rows) {
      this.rows.set(key(r), { ...r, hasEmbedding: Boolean(r.embedding), embeddingModel: r.embedding?.model ?? null, embeddingVector: r.embedding?.vector ?? null });
    }
  }

  async remove(keys: { source: string; section: string }[]): Promise<void> {
    for (const k of keys) this.rows.delete(key(k));
  }
}
