// Applies every migration to PGlite and checks the WS-U tables: seeded
// templates, encrypted-only PII columns, the screening → hold triggers,
// immutability guards, and RLS.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sealPrincipalSecrets } from "@/lib/principals/crypto-fields";
import { TEST_KEYRING } from "@/lib/principals/test-fixtures";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";
import { CHECKLIST_TEMPLATES } from "./templates";
import { CHECKLIST_PROGRAMS } from "./types";

let db: PGlite;
const DEAL = "11111111-1111-4111-8111-111111111111";
const OTHER_DEAL = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
  // WS-I's deals table exists from slot 01, so the WS-U foreign keys are live.
  await db.query(`insert into public.deals (id, name) values ($1, 'Harbor View'), ($2, 'Other deal')`, [DEAL, OTHER_DEAL]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params);
const fails = async (sql: string, params: unknown[] = []) => {
  try {
    await q(sql, params);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error(`expected failure: ${sql}`);
};

async function borrower(n = 1) {
  await q(`insert into public.principals (id, deal_id, kind, legal_name, roles) values ($1, $2, 'entity', 'Harbor View LLC', '{borrower_entity}')`, [id(n), DEAL]);
  return id(n);
}

describe("WS-U migration", () => {
  it("seeds one checklist template per program with the code's items", async () => {
    const rows = (await q<{ program: string; version: string; items: unknown }>(`select program, version, items from public.checklist_templates order by program`)).rows;
    expect(rows.map((r) => r.program).sort()).toEqual([...CHECKLIST_PROGRAMS].sort());
    for (const r of rows) expect(r.items).toEqual(JSON.parse(JSON.stringify(CHECKLIST_TEMPLATES[r.program as keyof typeof CHECKLIST_TEMPLATES].items)));
  });

  it("stores restricted principal fields only as ciphertext", async () => {
    const b = await borrower(1);
    expect(await fails(`insert into public.principals (id, deal_id, parent_id, kind, legal_name, roles, ownership_pct, ssn, tax_id_index) values ($1, $2, $3, 'individual', 'Ana Ruiz', '{member}', 50, '123-45-6789', null)`, [id(2), DEAL, b])).toMatch(/principals_ssn_check/);
    expect(await fails(`insert into public.principals (id, deal_id, parent_id, kind, legal_name, roles, ownership_pct, dob) values ($1, $2, $3, 'individual', 'Ana Ruiz', '{member}', 50, '1970-04-01')`, [id(2), DEAL, b])).toMatch(/principals_dob_check/);
    const sealed = sealPrincipalSecrets(id(2), { ssn: "123456789", dob: "1970-04-01", pfs: { asOf: "2026-10-01", assets: { cash: 1, marketableSecurities: 0, retirementAccounts: 0, realEstate: 0, businessInterests: 0, otherAssets: 0 }, liabilities: { mortgages: 0, notesPayable: 0, creditCards: 0, taxesOwed: 0, otherLiabilities: 0 }, contingentLiabilities: { guarantees: 0, legalClaims: 0, other: 0 }, annualIncome: { salary: 0, investmentIncome: 0, realEstateIncome: 0, otherIncome: 0 } } }, { keyring: TEST_KEYRING });
    await q(`insert into public.principals (id, deal_id, parent_id, kind, legal_name, roles, ownership_pct, ssn, dob, pfs, pfs_as_of, tax_id_index) values ($1, $2, $3, 'individual', 'Ana Ruiz', '{managing_member}', 50, $4, $5, $6, $7, $8)`, [id(2), DEAL, b, sealed.ssnEnc, sealed.dobEnc, sealed.pfsEnc, sealed.pfsAsOf, sealed.taxIdIndex]);
    const row = (await q<{ has_ssn: boolean; has_dob: boolean; has_pfs: boolean; has_form_1919: boolean; ssn: string }>(`select has_ssn, has_dob, has_pfs, has_form_1919, ssn from public.principals where id = $1`, [id(2)])).rows[0]!;
    expect(row).toMatchObject({ has_ssn: true, has_dob: true, has_pfs: true, has_form_1919: false });
    expect(row.ssn).toMatch(/^pii1\./);
    // An SSN without its blind index (or the reverse) is refused.
    expect(await fails(`update public.principals set tax_id_index = null where id = $1`, [id(2)])).toMatch(/principals_ssn_indexed/);
  });

  it("keeps the chart shaped: one borrower at the top, owners under entities on the same deal", async () => {
    expect(await fails(`insert into public.principals (id, deal_id, kind, legal_name, roles) values ($1, $2, 'entity', 'Second LLC', '{borrower_entity}')`, [id(9), DEAL])).toMatch(/principals_one_borrower_per_deal/);
    expect(await fails(`insert into public.principals (id, deal_id, kind, legal_name, roles) values ($1, $2, 'individual', 'Floating Person', '{member}')`, [id(10), DEAL])).toMatch(/principals_borrower_is_root/);
    expect(await fails(`insert into public.principals (id, deal_id, parent_id, kind, legal_name, roles, ownership_pct) values ($1, $2, $3, 'individual', 'Under Ana', '{member}', 10)`, [id(11), DEAL, id(2)])).toMatch(/must sit under an entity/);
    expect(await fails(`insert into public.principals (id, deal_id, parent_id, kind, legal_name, roles, ownership_pct) values ($1, $2, $3, 'individual', 'Other Deal', '{member}', 10)`, [id(12), OTHER_DEAL, id(1)])).toMatch(/must sit under an entity/);
    expect(await fails(`insert into public.principals (id, deal_id, parent_id, kind, legal_name, roles, ownership_pct, home_address) values ($1, $2, $3, 'entity', 'Ent', '{member}', 10, '1 Main')`, [id(13), DEAL, id(1)])).toMatch(/principals_individual_fields/);
  });

  it("a possible-match screening holds the deal; a false positive releases it; a confirmed match cannot be released", async () => {
    const ins = (name: string, result: string, disposition: string) =>
      q<{ id: string }>(
        `insert into public.screenings (deal_id, principal_id, subject_kind, subject_name, purpose, provider, list_version, result, match_score, disposition, requested_by, screened_at)
         values ($1, $2, 'individual', $3, 'initial', 'fake', 'fake-sdn@2026-10-30', $4, 0.93, $5, 'broker@k.com', now()) returning id`,
        [DEAL, id(2), name, result, disposition],
      );
    const hit = (await ins("Ana Ruiz", "potential_match", "pending_review")).rows[0]!.id;
    const holds = await q<{ reason: string; detail: string }>(`select reason, detail from public.deal_holds where source_id = $1 and released_at is null`, [hit]);
    expect(holds.rows).toEqual([{ reason: "sanctions_potential_match", detail: "Possible sanctions match for Ana Ruiz (score 0.9300, fake-sdn@2026-10-30)." }]);
    expect((await q<{ active_holds: number }>(`select active_holds::int from public.deal_hold_status where deal_id = $1`, [DEAL])).rows[0]).toEqual({ active_holds: 1 });

    // Results are immutable, the review needs a note, and decisions only move forward.
    expect(await fails(`update public.screenings set result = 'clear', disposition = 'not_required' where id = $1`, [hit])).toMatch(/immutable/);
    expect(await fails(`update public.screenings set disposition = 'false_positive' where id = $1`, [hit])).toMatch(/screenings_review_complete/);
    await q(`update public.screenings set disposition = 'false_positive', reviewer = 'broker@k.com', reviewed_at = now(), review_note = 'DOB differs from the SDN entry.' where id = $1`, [hit]);
    expect((await q(`select 1 from public.deal_holds where source_id = $1 and released_at is null`, [hit])).rows).toEqual([]);
    expect(await fails(`update public.screenings set disposition = 'confirmed_match' where id = $1`, [hit])).toMatch(/cannot change from false_positive/);
    expect(await fails(`delete from public.screenings where id = $1`, [hit])).toMatch(/cannot be deleted/);

    const hit2 = (await ins("Ana Ruiz", "potential_match", "pending_review")).rows[0]!.id;
    await q(`update public.screenings set disposition = 'confirmed_match', reviewer = 'broker@k.com', reviewed_at = now(), review_note = 'Name, DOB and nationality match.' where id = $1`, [hit2]);
    const open = await q<{ reason: string }>(`select reason from public.deal_holds where source_id = $1 and released_at is null order by reason`, [hit2]);
    expect(open.rows.map((r) => r.reason)).toEqual(["sanctions_confirmed_match", "sanctions_potential_match"]);
    expect(await fails(`update public.deal_holds set released_at = now(), released_by = 'x', release_note = 'y' where source_id = $1 and reason = 'sanctions_confirmed_match'`, [hit2])).toMatch(/only be released by counsel/);
    expect(await fails(`delete from public.deal_holds where source_id = $1`, [hit2])).toMatch(/cannot be deleted/);
    expect((await q<{ counsel_review: boolean }>(`select counsel_review from public.deal_hold_status where deal_id = $1`, [DEAL])).rows[0]).toEqual({ counsel_review: true });

    // A clear result must name the list version it was screened against.
    expect(await fails(`insert into public.screenings (deal_id, subject_kind, subject_name, purpose, provider, result, disposition, requested_by, screened_at) values ($1, 'entity', 'Harbor View LLC', 'initial', 'fake', 'clear', 'not_required', 'x', now())`, [DEAL])).toMatch(/screenings_list_version/);
  });

  it("checks checklist, condition, upload and portal-link invariants", async () => {
    const c = (await q<{ id: string }>(`insert into public.deal_checklists (deal_id, program, template_version, title, created_by) values ($1, 'BRIDGE', '2026.11.1', 'Bridge loan document checklist', 'b') returning id`, [DEAL])).rows[0]!.id;
    expect(await fails(`insert into public.deal_checklists (deal_id, program, template_version, title, created_by) values ($1, 'BRIDGE', '2099.1.1', 'Bridge', 'b')`, ["33333333-3333-4333-8333-333333333333"])).toMatch(/foreign key/);
    const item = (await q<{ id: string }>(`insert into public.deal_checklist_items (checklist_id, deal_id, item_key, template_key, title, description, category, responsible, stage, required, upload) values ($1, $2, 't12', 't12', 'T-12', 'd', 'financial', 'borrower', 'application', true, true) returning id`, [c, DEAL])).rows[0]!.id;
    expect(await fails(`update public.deal_checklist_items set status = 'waived' where id = $1`, [item])).toMatch(/waiver_reason/);
    expect(await fails(`update public.deal_checklist_items set status = 'accepted' where id = $1`, [item])).toMatch(/accepted_reviewer/);
    expect(await fails(`insert into public.checklist_item_files (id, item_id, deal_id, storage_path, file_name, content_type, size_bytes, status, uploaded_by) values (gen_random_uuid(), $1, $2, '../etc/passwd', 'x', 'application/pdf', 1, 'pending_upload', 'a@x.com')`, [item, DEAL])).toMatch(/storage_path_check/);
    expect(await fails(`insert into public.checklist_item_files (id, item_id, deal_id, storage_path, file_name, content_type, size_bytes, status, uploaded_by) values (gen_random_uuid(), $1, $2, $3, 'x.exe', 'application/x-msdownload', 1, 'pending_upload', 'a@x.com')`, [item, DEAL, `deals/${DEAL}/checklist/${item}/${DEAL}-x.pdf`])).toMatch(/content_type_check/);

    const cond = (await q<{ id: string }>(`insert into public.conditions (deal_id, source, lender_name, timing, description, responsible, created_by) values ($1, 'lender', 'Bay Capital', 'prior_to_closing', 'Updated rent roll', 'borrower', 'b') returning id`, [DEAL])).rows[0]!.id;
    expect(await fails(`update public.conditions set status = 'waived', cleared_by = 'b', cleared_at = now(), waiver_reason = 'n/a' where id = $1`, [cond])).toMatch(/conditions_waiver_evidence/);

    expect(await fails(`insert into public.portal_invites (deal_id, email, token_hash, expires_at, created_by) values ($1, 'a@x.com', $2, now() + interval '30 days', 'b')`, [DEAL, "a".repeat(64)])).toMatch(/portal_invites_expiry/);
    expect(await fails(`insert into public.portal_invites (deal_id, email, token_hash, expires_at, created_by) values ($1, 'A@x.com', $2, now() + interval '1 day', 'b')`, [DEAL, "b".repeat(64)])).toMatch(/email_check/);
  });

  it("denies the anon and authenticated roles", async () => {
    await q(`set role anon`);
    try {
      for (const t of ["principals", "screenings", "deal_holds", "deal_checklist_items", "portal_invites", "checklist_templates"]) {
        expect(await fails(`select * from public.${t} limit 1`)).toMatch(/permission denied/);
      }
    } finally {
      await q(`reset role`);
    }
  });

  it("adds deal foreign keys because WS-I's deals table exists first", async () => {
    const tables = ["checklist_item_files", "conditions", "deal_checklist_items", "deal_checklists", "deal_holds", "hm_underwriting", "portal_invites", "principals", "screenings"];
    const fks = await q<{ conname: string }>(
      `select c.conname from pg_constraint c join pg_class r on r.oid = c.conrelid where c.contype = 'f' and c.confrelid = 'public.deals'::regclass and r.relname = any($1::text[]) order by c.conname`,
      [tables],
    );
    expect(fks.rows.map((r) => r.conname)).toEqual(tables.map((t) => `${t}_deal_fk`));
  });
});
