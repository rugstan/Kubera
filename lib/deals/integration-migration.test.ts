// Applies every migration to PGlite and checks the Phase 2 integration fixes
// (20261103005100_int_phase2_fixes.sql): vault-backed checklist files, the
// deal origin key, status from terminal stages, and holds pausing the deal.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";

let db: PGlite;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params);
const one = async <T>(sql: string, params: unknown[] = []) => (await q<T>(sql, params)).rows[0]!;
const fails = async (sql: string, params: unknown[] = []) => {
  try {
    await q(sql, params);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`expected failure: ${sql}`);
};

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function deal(name = "Harbor View") {
  return (await one<{ id: string }>(`insert into public.deals (name, program, stage) values ($1, 'HUD_232', 'intake') returning id`, [name])).id;
}
const status = async (id: string) => (await one<{ status: string; record_version: number }>(`select status, record_version from public.deals where id = $1`, [id]));

describe("Phase 2 integration fixes migration", () => {
  it("terminal stages settle the deal status", async () => {
    for (const [stage, expected] of [["closed", "won"], ["lost", "lost"], ["withdrawn", "withdrawn"]] as const) {
      const id = await deal(`Deal ${stage}`);
      await q(`update public.deals set stage = $2 where id = $1`, [id, stage]);
      expect((await status(id)).status).toBe(expected);
    }
    const open = await deal("Still open");
    await q(`update public.deals set stage = 'packaging' where id = $1`, [open]);
    expect((await status(open)).status).toBe("active");
  });

  it("an open hold pauses the deal and releasing it resumes", async () => {
    const id = await deal("Held deal");
    const before = (await status(id)).record_version;
    const screening = "aaaaaaaa-0000-4000-8000-000000000001";
    await q(`insert into public.deal_holds (deal_id, reason, source_kind, source_id, detail, created_by) values ($1, 'sanctions_potential_match', 'screening', $2, 'Possible sanctions match for Pat Owner.', 'b')`, [id, screening]);
    const held = await status(id);
    expect(held.status).toBe("on_hold");
    expect(held.record_version).toBe(before + 1);
    await q(`insert into public.deal_holds (deal_id, reason, source_kind, source_id, detail, created_by) values ($1, 'sanctions_confirmed_match', 'screening', $2, 'Confirmed sanctions match for Pat Owner.', 'b')`, [id, screening]);
    expect((await status(id)).status).toBe("held_for_counsel");
    // Counsel releases the confirmed hold; the possible-match hold is released as a false positive.
    await q(`select set_config('corin.counsel_release', 'on', false)`);
    await q(`update public.deal_holds set released_at = now(), released_by = 'counsel', release_note = 'Cleared by counsel.' where deal_id = $1`, [id]);
    await q(`select set_config('corin.counsel_release', '', false)`);
    expect((await status(id)).status).toBe("active");
  });

  it("a hold never reopens a won, lost or withdrawn deal", async () => {
    const id = await deal("Lost deal");
    await q(`update public.deals set stage = 'lost' where id = $1`, [id]);
    await q(`insert into public.deal_holds (deal_id, reason, source_kind, source_id, detail, created_by) values ($1, 'sanctions_potential_match', 'screening', 'aaaaaaaa-0000-4000-8000-000000000002', 'Possible match.', 'b')`, [id]);
    expect((await status(id)).status).toBe("lost");
  });

  it("records the origin key of a deal once", async () => {
    await q(`insert into public.deals (name, program, stage, origin_key) values ('Take-out', 'AGENCY', 'intake', 'construction-takeout:t1')`);
    expect(await fails(`insert into public.deals (name, program, stage, origin_key) values ('Take-out again', 'AGENCY', 'intake', 'construction-takeout:t1')`)).toMatch(/unique|duplicate/i);
  });

  it("links checklist files to vault documents and accepts the scanning status", async () => {
    const id = await deal("Vault deal");
    const lead = (await one<{ id: string }>(`insert into public.leads (source, contact, intake, decision, engine, latency_ms) values ('express', '{}', '{}', '{}', 'rules', 1) returning id`)).id;
    const path = `${lead}/T12/bbbbbbbb-0000-4000-8000-000000000001-T-12 Oct.pdf`;
    const doc = (await one<{ id: string }>(`insert into public.documents (lead_id, kind, storage_path, file_name, content_type, status, bucket) values ($1, 'T12', $2, 'T-12 Oct.pdf', 'application/pdf', 'pending_upload', 'deal-documents-quarantine') returning id`, [lead, path])).id;
    const c = (await one<{ id: string }>(`insert into public.deal_checklists (deal_id, program, template_version, title, created_by) values ($1, 'BRIDGE', '2026.11.1', 'Bridge loan document checklist', 'b') returning id`, [id])).id;
    const item = (await one<{ id: string }>(`insert into public.deal_checklist_items (checklist_id, deal_id, item_key, template_key, title, description, category, responsible, stage, required, upload) values ($1, $2, 't12', 't12', 'T-12', 'd', 'financial', 'borrower', 'application', true, true) returning id`, [c, id])).id;
    const fileId = "cccccccc-0000-4000-8000-000000000001";
    await q(`insert into public.checklist_item_files (id, item_id, deal_id, storage_path, document_id, file_name, content_type, size_bytes, status, uploaded_by) values ($1, $2, $3, $4, $5, 'T-12 Oct.pdf', 'application/pdf', 100, 'pending_upload', 'pat@example.com')`, [fileId, item, id, path, doc]);
    await q(`update public.checklist_item_files set status = 'scanning' where id = $1`, [fileId]);
    expect(await fails(`update public.checklist_item_files set status = 'infected' where id = $1`, [fileId])).toMatch(/status_check/);
    expect(await fails(`insert into public.checklist_item_files (id, item_id, deal_id, storage_path, file_name, content_type, size_bytes, status, uploaded_by) values ('cccccccc-0000-4000-8000-000000000002', $1, $2, '../etc/passwd', 'x.pdf', 'application/pdf', 1, 'pending_upload', 'pat@example.com')`, [item, id])).toMatch(/storage_path_check/);
    expect(await fails(`insert into public.checklist_item_files (id, item_id, deal_id, storage_path, document_id, file_name, content_type, size_bytes, status, uploaded_by) values ('cccccccc-0000-4000-8000-000000000003', $1, $2, $3, $4, 'x.pdf', 'application/pdf', 1, 'pending_upload', 'pat@example.com')`, [item, id, `${lead}/T12/bbbbbbbb-0000-4000-8000-000000000009-x.pdf`, doc])).toMatch(/unique|duplicate/i);
  });
});
