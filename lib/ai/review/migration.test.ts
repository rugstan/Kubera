// Applies every migration to PGlite (with the Supabase stubs) and checks the
// WS-O additions: RLS, immutable review records, the staff-review columns and
// the hybrid knowledge-base retrieval function.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "../../../scripts/test-migrations.ts";
import { fakeVector, toPgVector } from "../embeddings";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

async function conversation(): Promise<string> {
  return (await one<{ id: string }>(`insert into public.ai_conversations (messages, turn_count) values ('[{"role":"user","content":"hi"}]', 1) returning id`)).id;
}

describe("WS-O tables", () => {
  const TABLES = ["ai_review_annotations", "ai_guardrail_events", "lead_source_costs"];

  it("enables RLS and denies the API roles", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname = any($1::text[])`, [TABLES]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const t of TABLES) await expect(db.query(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("adds the staff-review columns with safe defaults", async () => {
    const id = await conversation();
    expect(await one(`select flagged, flag_reason, review_status, reviewed_by from public.ai_conversations where id = $1`, [id])).toEqual({
      flagged: false,
      flag_reason: null,
      review_status: "unreviewed",
      reviewed_by: null,
    });
    await expect(db.query(`update public.ai_conversations set review_status = 'done' where id = $1`, [id])).rejects.toThrow(/check/);
    await db.query(`update public.ai_conversations set flagged = true, flag_reason = 'Guardrail: Commitment language', flagged_by = 'guardrail', flagged_at = now(), review_status = 'in_review' where id = $1`, [id]);
    await expect(db.query(`update public.ai_conversations set flag_reason = $2 where id = $1`, [id, "x".repeat(301)])).rejects.toThrow(/check/);
  });

  it("stores annotations, validates them, and never edits them", async () => {
    const id = await conversation();
    const a = await one<{ id: string }>(
      `insert into public.ai_review_annotations (conversation_id, message_index, label, note, author_label) values ($1, 1, 'inaccurate', 'DSCR is 1.45x, not 1.25x', 'Ana Ruiz') returning id`,
      [id],
    );
    await expect(db.query(`update public.ai_review_annotations set note = 'edited' where id = $1`, [a.id])).rejects.toThrow(/immutable/);
    await expect(db.query(`insert into public.ai_review_annotations (conversation_id, label, note, author_label) values ($1, 'bogus', 'x', 'Ana')`, [id])).rejects.toThrow(/check/);
    await expect(db.query(`insert into public.ai_review_annotations (conversation_id, label, note, author_label) values ($1, 'tone', '', 'Ana')`, [id])).rejects.toThrow(/check/);
    await expect(db.query(`insert into public.ai_review_annotations (conversation_id, message_index, label, note, author_label) values ($1, -1, 'tone', 'x', 'Ana')`, [id])).rejects.toThrow(/check/);
    await expect(db.query(`insert into public.ai_review_annotations (conversation_id, label, note, author_label) values (gen_random_uuid(), 'tone', 'x', 'Ana')`)).rejects.toThrow(/foreign key/);
  });

  it("stores guardrail events, validates the category, and removes them with the conversation", async () => {
    const id = await conversation();
    await db.query(`insert into public.ai_guardrail_events (conversation_id, message_index, rule_id, category, excerpt, replaced, mode) values ($1, 1, 'commitment.you-are-approved', 'commitment', 'You are approved.', true, 'enforce')`, [id]);
    await expect(db.query(`insert into public.ai_guardrail_events (conversation_id, message_index, rule_id, category, excerpt, replaced, mode) values ($1, 1, 'x', 'vibes', 'x', true, 'enforce')`, [id])).rejects.toThrow(/check/);
    await expect(db.query(`insert into public.ai_guardrail_events (conversation_id, message_index, rule_id, category, excerpt, replaced, mode) values ($1, 1, 'x', 'commitment', 'x', true, 'off')`, [id])).rejects.toThrow(/check/);
    await expect(db.query(`update public.ai_guardrail_events set replaced = false where conversation_id = $1`, [id])).rejects.toThrow(/immutable/);

    await db.query(`insert into public.ai_review_annotations (conversation_id, label, note, author_label) values ($1, 'other', 'n', 'Ana')`, [id]);
    await db.query(`delete from public.ai_conversations where id = $1`, [id]);
    expect((await one<{ n: number }>(`select count(*)::int n from public.ai_guardrail_events where conversation_id = $1`, [id])).n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int n from public.ai_review_annotations where conversation_id = $1`, [id])).n).toBe(0);
  });

  it("records lead-source spend per period without duplicates", async () => {
    await db.query(`insert into public.lead_source_costs (created_by, source, period_start, period_end, spend_cents) values ('admin', 'google_ads', '2026-10-01', '2026-10-31', 250000)`);
    await expect(db.query(`insert into public.lead_source_costs (created_by, source, period_start, period_end, spend_cents) values ('admin', 'google_ads', '2026-10-01', '2026-10-31', 1)`)).rejects.toThrow(/duplicate|unique/);
    await expect(db.query(`insert into public.lead_source_costs (created_by, source, period_start, period_end, spend_cents) values ('admin', 'x', '2026-11-01', '2026-10-01', 1)`)).rejects.toThrow(/check/);
    await expect(db.query(`insert into public.lead_source_costs (created_by, source, period_start, period_end, spend_cents) values ('admin', 'x', '2026-10-01', '2026-10-02', -1)`)).rejects.toThrow(/check/);
  });
});

describe("hybrid match_kb_chunks", () => {
  const chunks = [
    { section: "HUD 232 DSCR", content: "HUD Section 232 refinance of an existing assisted living facility requires a minimum 1.45x DSCR." },
    { section: "Hotel PIP", content: "A hotel franchise property improvement plan is funded with a PIP reserve held by the lender." },
    { section: "SBA 504 equity", content: "SBA 504 special purpose properties such as hotels need fifteen percent borrower equity." },
    { section: "Agency small balance", content: "Fannie Mae small loans cover multifamily up to nine million with 1.25x debt service coverage." },
  ];

  beforeAll(async () => {
    for (const c of chunks) {
      await db.query(`insert into public.kb_chunks (source, section, content, embedding, embedding_model, embedded_at) values ('t', $1, $2, $3::extensions.vector, 'fake-bow-1024', now())`, [
        c.section,
        c.content,
        toPgVector(fakeVector(`${c.section} ${c.content}`)),
      ]);
    }
    // A chunk with text but no embedding yet (the ingest ran without a provider).
    await db.query(`insert into public.kb_chunks (source, section, content) values ('t', 'Unembedded', 'Bridge loans for senior living often have a twenty four month interest only term.')`);
  });

  const match = async (text: string, embedding: number[] | null, count = 3) =>
    (await db.query<{ section: string; score: number }>(`select section, score from public.match_kb_chunks($1, $2::extensions.vector, $3)`, [text, embedding ? toPgVector(embedding) : null, count])).rows;

  it("is full-text only without an embedding", async () => {
    const rows = await match("hotel franchise PIP", null);
    expect(rows.map((r) => r.section)).toEqual(["Hotel PIP"]);
    expect(await match("zzzz nothing", null)).toEqual([]);
  });

  it("is vector only without query text matches", async () => {
    const rows = await match("zzzz", fakeVector("assisted living minimum DSCR HUD 232 refinance"));
    expect(rows[0]!.section).toBe("HUD 232 DSCR");
    // The unembedded chunk can only be found by text.
    expect(rows.map((r) => r.section)).not.toContain("Unembedded");
  });

  it("fuses both rankings so a chunk found by either list surfaces", async () => {
    // Text finds only the unembedded chunk; the vector finds the HUD chunk first.
    const rows = await match("twenty four month interest only", fakeVector("assisted living minimum DSCR HUD 232 refinance"), 3);
    const sections = rows.map((r) => r.section);
    expect(sections).toContain("Unembedded");
    expect(sections).toContain("HUD 232 DSCR");
    expect(rows.every((r, i) => i === 0 || rows[i - 1]!.score >= r.score)).toBe(true);
  });

  it("ranks a chunk found by both lists above one found by one", async () => {
    const rows = await match("hotel equity", fakeVector("SBA 504 special purpose hotels borrower equity"), 4);
    expect(rows[0]!.section).toBe("SBA 504 equity");
  });

  it("respects the limit and tolerates empty text", async () => {
    expect(await match("", fakeVector("hotel"), 2)).toHaveLength(2);
    expect(await match("hotel", null, 1)).toHaveLength(1);
  });

  it("keeps the function private to the service role", async () => {
    await db.exec("set role authenticated");
    await expect(db.query(`select * from public.match_kb_chunks('hotel')`)).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});
