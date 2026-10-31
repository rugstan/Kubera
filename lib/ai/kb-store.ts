// Supabase-backed KbStore for scripts/ingest-kb.ts (service role). No
// "server-only" import: the CLI runs outside Next.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { KbRowWrite, KbStore, StoredKbChunk } from "./kb-ingest";

type Row = { source: string; section: string | null; content_sha256: string | null; embedding_model: string | null; embedded_at: string | null };

const PAGE = 1_000;

export class SupabaseKbStore implements KbStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(): Promise<StoredKbChunk[]> {
    const out: StoredKbChunk[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from("kb_chunks")
        .select("source, section, content_sha256, embedding_model, embedded_at")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`kb_chunks list: ${error.message}`);
      const rows = (data ?? []) as Row[];
      for (const r of rows) {
        out.push({
          source: r.source,
          section: r.section ?? "",
          contentSha256: r.content_sha256,
          embeddingModel: r.embedding_model,
          // A vector is only written together with embedded_at and the model name.
          hasEmbedding: r.embedded_at !== null && r.embedding_model !== null,
        });
      }
      if (rows.length < PAGE) return out;
    }
  }

  async upsert(rows: KbRowWrite[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.db.from("kb_chunks").upsert(
      rows.map((r) => ({
        source: r.source,
        section: r.section,
        content: r.content,
        content_sha256: r.contentSha256,
        embedding: r.embedding?.vector ?? null,
        embedding_model: r.embedding?.model ?? null,
        embedded_at: r.embedding?.at ?? null,
      })),
      { onConflict: "source,section" },
    );
    if (error) throw new Error(`kb_chunks upsert: ${error.message}`);
  }

  async remove(keys: { source: string; section: string }[]): Promise<void> {
    for (const k of keys) {
      const { error } = await this.db.from("kb_chunks").delete().eq("source", k.source).eq("section", k.section);
      if (error) throw new Error(`kb_chunks delete: ${error.message}`);
    }
  }
}
