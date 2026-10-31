// Loads Markdown excerpts from ./knowledge into Supabase kb_chunks for
// Ask Kubera AI retrieval, with embeddings when a provider is configured.
//
//   npm run kb:ingest                      write new/changed sections, embed what needs it, prune stale sections
//   npm run kb:ingest -- --dry-run         show the plan; write nothing, call no model
//   npm run kb:ingest -- --reembed         re-embed every section (after changing the embedding model)
//   npm run kb:ingest -- --prune-missing   also delete sources whose file is gone
//   npm run kb:ingest -- --query="HUD 232 DSCR"   run a retrieval against the loaded chunks
//
// Put licensed or public handbook excerpts (HUD 4232.1, MAP Guide, SOP 50 10,
// CMBS/STR standards, Title 22) in knowledge/*.md; each "## " heading becomes a
// chunk keyed by (file, heading), so re-running updates in place. Unchanged
// sections are neither rewritten nor re-embedded.
//
// Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required except for
// --dry-run); VOYAGE_API_KEY or NVIDIA_API_KEY for embeddings (see .env.example).
// Without an embedding key the text and full-text index are still loaded.

import { createClient } from "@supabase/supabase-js";
import { embedQuery, embeddingClientFromEnv, toPgVector } from "../lib/ai/embeddings";
import { MemoryKbStore, runIngest } from "../lib/ai/kb-ingest";
import { readKnowledgeDir } from "../lib/ai/kb-files";
import { SupabaseKbStore } from "../lib/ai/kb-store";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k = "", ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"] as const;
  }),
);
const flag = (name: string) => args.has(name) && args.get(name) !== "false";

const { files, drafts, problems } = await readKnowledgeDir();
for (const p of problems) console.warn(`warning: ${p}`);
console.log(`${files.length} file(s), ${drafts.length} chunk(s) in knowledge/`);

const dryRun = flag("dry-run");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!url || !key)) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or use --dry-run)");
  process.exit(1);
}
const db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

const embeddings = embeddingClientFromEnv();
console.log(embeddings ? `Embeddings: ${embeddings.provider} ${embeddings.model}` : "Embeddings: off (set VOYAGE_API_KEY or NVIDIA_API_KEY); loading text and full-text index only");

const summary = await runIngest({
  drafts,
  // A dry run plans against what is stored when it can, and against nothing otherwise.
  store: db ? new SupabaseKbStore(db) : new MemoryKbStore(),
  embeddings,
  reembed: flag("reembed"),
  pruneMissingFiles: flag("prune-missing"),
  dryRun,
  log: (line) => console.log(line),
});

console.log(
  `${summary.dryRun ? "Plan" : "Done"}: ${summary.chunks} chunks, ${summary.written} ${summary.dryRun ? "to write" : "written"}, ` +
    `${summary.embedded} ${summary.dryRun ? "to embed" : "embedded"}, ${summary.unchanged} unchanged, ${summary.removed} ${summary.dryRun ? "to remove" : "removed"}.`,
);
if (summary.embeddingSkipped && embeddings) console.warn(`Embedding incomplete: ${summary.embeddingSkipped}`);

const query = args.get("query");
if (query && query !== "true") {
  if (!db) {
    console.error("--query needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const embedding = await embedQuery(query, { client: embeddings });
  const { data, error } = await db.rpc("match_kb_chunks", {
    query_text: query,
    match_count: 5,
    ...(embedding ? { query_embedding: toPgVector(embedding) } : {}),
  });
  if (error) throw new Error(`match_kb_chunks: ${error.message}`);
  console.log(`\nTop matches for "${query}" (${embedding ? "hybrid" : "full-text"}):`);
  for (const r of (data ?? []) as { source: string; section: string | null; score: number }[]) console.log(`  ${r.score.toFixed(4)}  ${r.source} / ${r.section ?? ""}`);
}
