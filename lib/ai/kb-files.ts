// Reads the Markdown excerpts in ./knowledge into chunk drafts (Node only).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chunkMarkdown, type KbChunkDraft } from "./kb-ingest";

export const KNOWLEDGE_DIR = path.resolve(process.cwd(), "knowledge");

/** Files that are documentation for the folder, not knowledge. */
const SKIP = new Set(["README.md"]);

export type KnowledgeFiles = { files: string[]; drafts: KbChunkDraft[]; problems: string[] };

/**
 * Every `knowledge/*.md` except the README, chunked by "## " heading. The source
 * name is the file name without ".md" (it is what the advisor cites). Problems
 * lists files that produced no chunk, which usually means a missing "## ".
 */
export async function readKnowledgeDir(dir: string = KNOWLEDGE_DIR): Promise<KnowledgeFiles> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".md") && !SKIP.has(f)).sort();
  const drafts: KbChunkDraft[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const source = name.replace(/\.md$/, "");
    const chunks = chunkMarkdown(source, await readFile(path.join(dir, name), "utf8"));
    if (chunks.length === 0) problems.push(`${name}: no "## " sections with text, so nothing to ingest`);
    drafts.push(...chunks);
  }
  return { files: names, drafts, problems };
}
