# Knowledge base sources

Drop Markdown excerpts here and run `npm run kb:ingest`. Each `## Heading` becomes one retrievable chunk for Ask Kubera AI (a section over 4,000 characters is split on paragraph breaks into `Heading (1)`, `Heading (2)`, ...). Text before the first `## ` (the title and a source note) is not retrievable. This README is never ingested.

Suggested files (one per source, named for citation; the file name is what the advisor cites):

- `hud-4232-1.md`: HUD Handbook 4232.1, Section 232 LEAN
- `hud-map-guide.md`: Multifamily Accelerated Processing Guide
- `sba-sop-50-10.md`: SBA SOP 50 10, current revision (7(a), 504, hospitality guidance)
- `cmbs-hospitality.md`: conduit hotel underwriting, PIP reserves, STR metrics
- `ca-dre-title-22.md`: Bus. & Prof. Code § 10131(d) and Title 22 RCFE regulations

Only add material you're licensed to redistribute internally. Government handbooks are public domain.

## Embeddings

Retrieval is hybrid: full-text search and vector similarity are ranked separately and fused (reciprocal rank fusion, `match_kb_chunks`). Vectors are 1024-dimensional.

- Set `VOYAGE_API_KEY` or `NVIDIA_API_KEY`, or pin one with `EMBEDDINGS_PROVIDER=voyage|nvidia`. With neither, the text and full-text index still load and retrieval is full-text only.
- `npm run kb:ingest` only rewrites sections whose text changed and only re-embeds sections that changed, have no vector, or were embedded by a different model. Sections deleted from a file are removed from the table.
- `npm run kb:ingest -- --dry-run` shows what would change without writing or calling a model. `--reembed` redoes every vector (after changing `VOYAGE_EMBED_MODEL` / `NVIDIA_EMBED_MODEL`). `--prune-missing` also deletes sources whose file is gone. `--query="..."` runs a retrieval against what is loaded.
- Every text goes through the model routing guard (purpose `embedding`) before it leaves: restricted values such as SSNs are redacted, and a person who opted out of AI processing is never embedded.
- Changing to a model with a different vector size needs a migration for `kb_chunks.embedding`.
