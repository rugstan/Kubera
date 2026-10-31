import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EmbeddingError, FakeEmbeddings, type EmbeddingClient } from "./embeddings";
import { checkText } from "./guardrails";
import { readKnowledgeDir } from "./kb-files";
import { MAX_CHUNK_CHARS, MemoryKbStore, chunkMarkdown, embeddingText, planIngest, runIngest, type KbChunkDraft } from "./kb-ingest";

const doc = `# Title

Intro that is not retrievable.

## DSCR
HUD 232 refinance needs 1.45x.

## Fees
MIP is annual.

## DSCR
Second heading with the same name.
`;

describe("chunkMarkdown", () => {
  it("makes one chunk per ## heading and drops the intro", () => {
    const chunks = chunkMarkdown("hud", doc);
    expect(chunks.map((c) => c.section)).toEqual(["DSCR", "Fees", "DSCR [2]"]);
    expect(chunks[0]).toMatchObject({ source: "hud", content: "HUD 232 refinance needs 1.45x." });
    expect(chunks.every((c) => /^[0-9a-f]{64}$/.test(c.sha256))).toBe(true);
  });

  it("splits long sections on paragraph boundaries into numbered parts", () => {
    const para = "x".repeat(900);
    const body = Array.from({ length: 10 }, () => para).join("\n\n");
    const chunks = chunkMarkdown("big", `## Long\n${body}`);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.section)).toEqual(chunks.map((_, i) => `Long (${i + 1})`));
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(c.content.startsWith("x") && c.content.endsWith("x")).toBe(true);
    }
    expect(chunks.reduce((n, c) => n + c.content.replace(/\n/g, "").length, 0)).toBe(9_000);
  });

  it("hard-cuts a single paragraph longer than the limit", () => {
    const chunks = chunkMarkdown("big", `## One\n${"y".repeat(9_000)}`, 4_000);
    expect(chunks.map((c) => c.content.length)).toEqual([4_000, 4_000, 1_000]);
  });

  it("changes the hash when the text or the heading changes", () => {
    const a = chunkMarkdown("s", "## A\nbody")[0]!;
    expect(chunkMarkdown("s", "## A\nbody")[0]!.sha256).toBe(a.sha256);
    expect(chunkMarkdown("s", "## A\nbody 2")[0]!.sha256).not.toBe(a.sha256);
    expect(chunkMarkdown("s", "## B\nbody")[0]!.sha256).not.toBe(a.sha256);
  });

  it("puts the heading in the embedding text", () => {
    const [c] = chunkMarkdown("hud-4232-1", "## Occupancy\nStabilized at 90%.");
    expect(embeddingText(c!)).toBe("hud-4232-1: Occupancy\n\nStabilized at 90%.");
  });

  it("skips empty sections", () => {
    expect(chunkMarkdown("s", "## Empty\n\n## Full\ntext")).toHaveLength(1);
  });
});

describe("planIngest", () => {
  const d = (section: string, content: string, source = "s"): KbChunkDraft => chunkMarkdown(source, `## ${section}\n${content}`)[0]!;
  const stored = (x: KbChunkDraft, extra: Partial<{ embeddingModel: string | null; hasEmbedding: boolean }> = {}) => ({
    source: x.source,
    section: x.section,
    contentSha256: x.sha256,
    embeddingModel: "m1",
    hasEmbedding: true,
    ...extra,
  });

  it("writes new and changed text and leaves the rest", () => {
    const a = d("A", "one");
    const b = d("B", "two");
    const plan = planIngest([a, d("B", "two changed"), d("C", "three")], [stored(a), stored(b)], { embeddingModel: "m1" });
    expect(plan.write.map((w) => [w.draft.section, w.reason])).toEqual([
      ["B", "changed"],
      ["C", "new"],
    ]);
    expect(plan.embed.map((e) => e.section)).toEqual(["B", "C"]);
    expect(plan.unchanged).toBe(1);
  });

  it("re-embeds unchanged text when the model changed, the vector is missing, or reembed is set", () => {
    const a = d("A", "one");
    expect(planIngest([a], [stored(a)], { embeddingModel: "m2" }).write[0]).toMatchObject({ reason: "embed" });
    expect(planIngest([a], [stored(a, { hasEmbedding: false })], { embeddingModel: "m1" }).write[0]).toMatchObject({ reason: "embed" });
    expect(planIngest([a], [stored(a)], { embeddingModel: "m1", reembed: true }).write).toHaveLength(1);
    expect(planIngest([a], [stored(a)], { embeddingModel: "m1" }).write).toHaveLength(0);
  });

  it("does not ask for embeddings when there is no provider", () => {
    const a = d("A", "one");
    const plan = planIngest([a], [stored(a, { hasEmbedding: false, embeddingModel: null })], { embeddingModel: null });
    expect(plan.write).toHaveLength(0);
    expect(plan.embed).toHaveLength(0);
  });

  it("prunes stale sections of present files, and missing files only when asked", () => {
    const a = d("A", "one");
    const gone = d("Gone", "x");
    const otherFile = d("Z", "z", "other");
    const base = { embeddingModel: "m1" };
    expect(planIngest([a], [stored(a), stored(gone), stored(otherFile)], base).remove).toEqual([{ source: "s", section: "Gone" }]);
    expect(planIngest([a], [stored(a), stored(gone), stored(otherFile)], { ...base, pruneMissingFiles: true }).remove).toHaveLength(2);
    expect(planIngest([a], [stored(a), stored(gone)], { ...base, prune: false }).remove).toEqual([]);
  });
});

describe("runIngest", () => {
  const drafts = chunkMarkdown("hud", doc);
  const now = () => new Date("2026-11-04T12:00:00Z");

  it("loads text and embeddings, then does nothing on a second run", async () => {
    const store = new MemoryKbStore();
    const emb = new FakeEmbeddings();
    const first = await runIngest({ drafts, store, embeddings: emb, now });
    expect(first).toMatchObject({ chunks: 3, written: 3, embedded: 3, unchanged: 0, removed: 0, embeddingSkipped: null });
    expect([...store.rows.values()].every((r) => r.hasEmbedding && r.embeddingModel === "fake-bow-1024")).toBe(true);
    expect(emb.calls.flatMap((c) => c.texts)).toHaveLength(3);
    expect(emb.calls.every((c) => c.kind === "document")).toBe(true);

    const second = await runIngest({ drafts, store, embeddings: emb, now });
    expect(second).toMatchObject({ written: 0, embedded: 0, unchanged: 3 });
    expect(emb.calls).toHaveLength(1);
  });

  it("re-embeds only the section whose text changed, and prunes a removed one", async () => {
    const store = new MemoryKbStore();
    const emb = new FakeEmbeddings();
    await runIngest({ drafts, store, embeddings: emb, now });
    emb.calls.length = 0;
    const edited = chunkMarkdown("hud", doc.replace("1.45x", "1.50x").replace(/## Fees[\s\S]*?## DSCR\nSecond[^\n]*\n/, ""));
    const r = await runIngest({ drafts: edited, store, embeddings: emb, now });
    expect(r).toMatchObject({ written: 1, embedded: 1, removed: 2 });
    expect(emb.calls.flatMap((c) => c.texts)).toEqual([expect.stringContaining("1.50x")]);
    expect([...store.rows.keys()].length).toBe(1);
  });

  it("loads text without embeddings when no provider is configured, then embeds later", async () => {
    const store = new MemoryKbStore();
    const r = await runIngest({ drafts, store, embeddings: null, now });
    expect(r).toMatchObject({ written: 3, embedded: 0, embeddingSkipped: "no embedding provider configured" });
    expect([...store.rows.values()].every((x) => !x.hasEmbedding)).toBe(true);

    const later = await runIngest({ drafts, store, embeddings: new FakeEmbeddings(), now });
    expect(later).toMatchObject({ written: 3, embedded: 3 });
  });

  it("keeps the text when the provider fails, and does not wipe existing vectors on a failed re-embed", async () => {
    const log: string[] = [];
    const failing: EmbeddingClient = { provider: "fake", model: "m2", configured: () => true, embed: async () => Promise.reject(new EmbeddingError("503")) };
    const store = new MemoryKbStore();
    const r = await runIngest({ drafts, store, embeddings: failing, now, log: (l) => log.push(l) });
    expect(r).toMatchObject({ written: 3, embedded: 0 });
    expect(r.embeddingSkipped).toBe("503");
    expect(store.rows.size).toBe(3);

    // Now a good run, then a model change whose embedding fails: vectors stay as they were.
    await runIngest({ drafts, store, embeddings: new FakeEmbeddings(), now });
    const again = await runIngest({ drafts, store, embeddings: failing, now });
    expect(again.embedded).toBe(0);
    expect([...store.rows.values()].every((x) => x.hasEmbedding && x.embeddingModel === "fake-bow-1024")).toBe(true);
  });

  it("dry run plans without writing or calling the model", async () => {
    const store = new MemoryKbStore();
    const emb = new FakeEmbeddings();
    const r = await runIngest({ drafts, store, embeddings: emb, dryRun: true, now });
    expect(r).toMatchObject({ dryRun: true, written: 3, embedded: 3 });
    expect(store.rows.size).toBe(0);
    expect(emb.calls).toHaveLength(0);
  });

  it("embeds in batches", async () => {
    const many = Array.from({ length: 70 }, (_, i) => chunkMarkdown("big", `## S${i}\nbody ${i}`)[0]!);
    const emb = new FakeEmbeddings();
    const r = await runIngest({ drafts: many, store: new MemoryKbStore(), embeddings: emb, now });
    expect(r.embedded).toBe(70);
    expect(emb.calls.map((c) => c.texts.length)).toEqual([32, 32, 6]);
  });

  it("reports a provider error and keeps the text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const emb = new FakeEmbeddings();
    const spy = vi.spyOn(emb, "embed").mockRejectedValue(new Error("refused"));
    const r = await runIngest({ drafts, store: new MemoryKbStore(), embeddings: emb, now });
    expect(r.embeddingSkipped).toBe("refused");
    spy.mockRestore();
    warn.mockRestore();
  });
});

describe("readKnowledgeDir", () => {
  it("reads the repo's knowledge folder (README excluded) without problems", async () => {
    const { files, drafts, problems } = await readKnowledgeDir();
    expect(files).not.toContain("README.md");
    expect(problems).toEqual([]);
    expect(drafts.length).toBe(files.length === 0 ? 0 : drafts.length);
    const keys = drafts.map((d) => `${d.source}/${d.section}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the advisor's own reference text clear of the output guardrails", async () => {
    // The advisor paraphrases retrieved excerpts, so they must not read like a promise or a legal conclusion.
    const { drafts } = await readKnowledgeDir();
    for (const d of drafts) expect(checkText(d.content).violations.map((v) => `${d.source}/${d.section}: ${v.excerpt}`)).toEqual([]);
  });

  it("names sources after files and reports files with no sections", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kb-"));
    try {
      await writeFile(path.join(dir, "a-source.md"), "# A\n\n## One\nText one.\n");
      await writeFile(path.join(dir, "no-headings.md"), "Just text.\n");
      await writeFile(path.join(dir, "README.md"), "## Ignored\nx\n");
      await writeFile(path.join(dir, "notes.txt"), "## Ignored\nx\n");
      const r = await readKnowledgeDir(dir);
      expect(r.files).toEqual(["a-source.md", "no-headings.md"]);
      expect(r.drafts.map((d) => `${d.source}/${d.section}`)).toEqual(["a-source/One"]);
      expect(r.problems).toEqual([expect.stringContaining("no-headings.md")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
