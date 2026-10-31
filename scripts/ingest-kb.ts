// Loads Markdown excerpts from ./knowledge into Supabase kb_chunks for
// Ask Kubera AI retrieval. Usage: npm run kb:ingest
//
// Put licensed or public handbook excerpts (HUD 4232.1, MAP Guide, SOP 50 10,
// CMBS/STR standards, Title 22) in knowledge/*.md; each "## " heading becomes
// a chunk keyed by (file, heading), so re-running updates in place.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const MAX_CHARS = 4_000;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

function chunk(source: string, md: string) {
  const out: { source: string; section: string; content: string }[] = [];
  for (const block of md.split(/^## /m).slice(1)) {
    const [heading = "", ...rest] = block.split("\n");
    const body = rest.join("\n").trim();
    for (let i = 0, part = 1; i < body.length; i += MAX_CHARS, part++) {
      const section = body.length > MAX_CHARS ? `${heading.trim()} (${part})` : heading.trim();
      out.push({ source, section, content: body.slice(i, i + MAX_CHARS) });
    }
  }
  return out;
}

const dir = path.resolve("knowledge");
const files = (await readdir(dir)).filter((f) => f.endsWith(".md") && f !== "README.md");
let total = 0;
for (const f of files) {
  const rows = chunk(f.replace(/\.md$/, ""), await readFile(path.join(dir, f), "utf8"));
  if (!rows.length) continue;
  const { error } = await db.from("kb_chunks").upsert(rows, { onConflict: "source,section" });
  if (error) throw new Error(`${f}: ${error.message}`);
  total += rows.length;
  console.log(`${f}: ${rows.length} chunks`);
}
console.log(`Ingested ${total} chunks from ${files.length} files.`);
