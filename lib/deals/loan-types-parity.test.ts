// public.derive_lender_loan_types() (supabase/migrations/20261105130000_int_lender_loan_types.sql, replaced by 20261105140000_int_lender_loan_types_non_bank.sql)
// returns exactly what deriveLenderLoanTypes() (lib/deals/loan-types.ts) returns: on the shared
// cases, on every lender after all migrations, and with the TS rules found verbatim in the
// live function. Also the column check, the GIN index, grants, attribution and seed idempotency.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, custodyViolations, listMigrations } from "../../scripts/test-migrations.ts";
import { BOX_PROGRAMS_SEGMENT, DESK_LOAN_TYPES, DESKS_SEGMENT, DIRECTORY_PREAMBLE, DIRECTORY_SEGMENTS, LOAN_TYPE_CLEANUPS, LOAN_TYPE_KEYWORD_RULES, deriveLenderLoanTypes, deskLabels, lenderLoanTypes, type LoanTypeSource } from "./loan-types";
import { LOAN_TYPE_CASES } from "./loan-types.cases";

const MIGRATION = "20261105130000_int_lender_loan_types.sql";
const MARKER = "migration:20261105130000_int_lender_loan_types";
const SEED = /_int_lender_directory_seed(?:_round\d+)?\.sql$/;
let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const sqlDerive = async (s: LoanTypeSource) =>
  (await db.query<{ t: string[] }>(`select public.derive_lender_loan_types($1::text[], $2, $3, $4::text[], $5::text[]) as t`, [s.programs, s.category, s.appetiteNotes, s.assetTypes, s.boxNotes])).rows[0]!.t;
type Row = { name: string; programs: string[]; category: string; appetite_notes: string | null; asset_types: string[]; loan_types: string[]; updated_by: string | null; box_notes: (string | null)[] };
const rows = async () =>
  (
    await db.query<Row>(`select l.name, l.programs, l.category, l.appetite_notes, l.asset_types, l.loan_types, l.updated_by,
  coalesce((select array_agg(b.notes order by b.id) from public.credit_boxes b where b.lender_id = l.id), '{}') as box_notes from public.lender_panel l`)
  ).rows;
const src = (r: Row): LoanTypeSource => ({ programs: r.programs as LoanTypeSource["programs"], category: r.category as LoanTypeSource["category"], appetiteNotes: r.appetite_notes, assetTypes: r.asset_types, boxNotes: r.box_notes });

describe("loan types: SQL and TS agree", () => {
  it.each(LOAN_TYPE_CASES)("SQL: $name", async ({ src: s, expected }) => {
    expect(await sqlDerive(s)).toEqual(expected);
  });

  it("backfilled every lender with what the TS rules derive", async () => {
    const all = await rows();
    expect(all.length).toBeGreaterThanOrEqual(374);
    const mismatches = all.filter((r) => JSON.stringify(r.loan_types) !== JSON.stringify(deriveLenderLoanTypes(src(r)))).map((r) => r.name);
    expect(mismatches).toEqual([]);
  });

  it("gives every seeded lender at least one loan type", async () => {
    const seeded = (await rows()).filter((r) => r.updated_by?.startsWith("seed:lender-directory"));
    expect(seeded.length).toBeGreaterThanOrEqual(374);
    expect(seeded.filter((r) => r.loan_types.length === 0).map((r) => r.name)).toEqual([]);
  });

  it("maps every desk label in the seeded notes", async () => {
    const labels = new Set((await rows()).flatMap((r) => deskLabels(r.appetite_notes)));
    expect(labels.size).toBeGreaterThan(20);
    expect([...labels].filter((l) => !Object.hasOwn(DESK_LOAN_TYPES, l))).toEqual([]);
  });

  it("carries the TS rules verbatim in the live function", async () => {
    const def = (await db.query<{ d: string }>(`select pg_get_functiondef('public.derive_lender_loan_types(text[],text,text,text[],text[])'::regprocedure) as d`)).rows[0]!.d;
    const strings = [...LOAN_TYPE_CLEANUPS.map((c) => c.pattern), ...LOAN_TYPE_KEYWORD_RULES.map((r) => r.pattern), ...Object.keys(DESK_LOAN_TYPES), DIRECTORY_SEGMENTS, DIRECTORY_PREAMBLE, DESKS_SEGMENT, BOX_PROGRAMS_SEGMENT];
    expect(strings.filter((s) => !def.includes(s))).toEqual([]);
    for (const t of lenderLoanTypes) expect(def).toContain(`'${t}'`);
  });
});

describe("loan_types column", () => {
  it("refuses unknown, null and upper-case ids, and has a GIN index", async () => {
    const id = (await db.query<{ id: string }>(`select id from public.lender_panel limit 1`)).rows[0]!.id;
    for (const v of ["{dscr,bogus}", "{NULL}", "{DSCR}"]) await expect(db.query(`update public.lender_panel set loan_types = $2::text[] where id = $1`, [id, v]), v).rejects.toThrow(/lender_panel_loan_types_known/);
    const idx = (await db.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'lender_panel_loan_types_idx'`)).rows[0]!.indexdef;
    expect(idx).toContain("USING gin (loan_types)");
  });

  it("denies the API roles the function", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query(`select public.derive_lender_loan_types('{}', null, null, '{}', '{}')`)).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
  });

  it("keeps the seeds idempotent", async () => {
    const stats = async () => ({
      totals: (await db.query(`select count(*)::int as n, coalesce(sum(cardinality(loan_types)), 0)::int as types from public.lender_panel`)).rows[0],
      perType: (await db.query(`select t, count(*)::int as n from public.lender_panel, unnest(loan_types) as t group by t order by t`)).rows,
    });
    const before = await stats();
    for (const s of listMigrations().filter((f) => SEED.test(f.name))) await db.exec(s.sql);
    expect(await stats()).toEqual(before);
  });

  it("passes the no-custody guard", async () => {
    expect(await custodyViolations(db)).toEqual([]);
  });
});

describe("the non-bank fix (20261105140000_int_lender_loan_types_non_bank.sql)", () => {
  const FIX = "20261105140000_int_lender_loan_types_non_bank.sql";
  const FIX_MARKER = "migration:20261105140000_int_lender_loan_types_non_bank";
  let fresh: PGlite;

  beforeAll(async () => {
    fresh = await createStubbedDb();
    await applyMigrations(fresh, listMigrations().filter((f) => f.name <= MIGRATION && !SEED.test(f.name)));
    await fresh.query(
      `insert into public.lender_panel (name, category, programs, appetite_notes, updated_by) values
        ('Untouched CDFI', 'UNKNOWN', '{SBA_7A}', 'SBA 7(a) (Preferred Lender, non-bank)', 'broker:ana'),
        ('Edited CDFI', 'UNKNOWN', '{SBA_7A}', 'SBA 7(a) (non-bank SBLC, Preferred Lender)', 'broker:ana'),
        ('Real Bank', 'STATE_BANK', '{SBA_7A}', 'Community bank', 'broker:ana')`,
    );
    // What 20261105130000 derived for them, as the add-lender form would have stored it; then a broker edits one.
    await fresh.exec(`update public.lender_panel set loan_types = public.derive_lender_loan_types(programs, category, appetite_notes, asset_types, '{}')`);
    await fresh.query(`update public.lender_panel set loan_types = '{sba,bank,hotel}', updated_by = 'broker:lee' where name = 'Edited CDFI'`);
    await applyMigrations(fresh, listMigrations().filter((f) => f.name === FIX));
  }, 180_000);

  afterAll(async () => {
    await fresh?.close();
  });

  it("drops bank from an untouched non-bank lender, and leaves staff-edited and real banks alone", async () => {
    const panel = (await fresh.query<{ name: string; loan_types: string[]; updated_by: string }>(`select name, loan_types, updated_by from public.lender_panel order by name`)).rows;
    expect(panel).toEqual([
      { name: "Edited CDFI", loan_types: ["sba", "bank", "hotel"], updated_by: "broker:lee" },
      { name: "Real Bank", loan_types: ["sba", "bank"], updated_by: "broker:ana" },
      { name: "Untouched CDFI", loan_types: ["sba"], updated_by: FIX_MARKER },
    ]);
  });

  it("no longer tags the seeded non-bank lenders as banks", async () => {
    const tagged = (await db.query<{ name: string }>(`select name from public.lender_panel where 'bank' = any (loan_types) and name in ('Community Reinvestment Fund, USA', 'Lendistry', 'Affinius Capital', 'Canyon Partners Real Estate')`)).rows;
    expect(tagged).toEqual([]);
    expect(Number((await db.query<{ n: number }>(`select count(*)::int as n from public.lender_panel where name in ('Community Reinvestment Fund, USA', 'Lendistry', 'Affinius Capital', 'Canyon Partners Real Estate')`)).rows[0]!.n)).toBe(4);
  });
});

describe("backfill attribution on staff rows", () => {
  let fresh: PGlite;

  beforeAll(async () => {
    fresh = await createStubbedDb();
    await applyMigrations(fresh, listMigrations().filter((f) => f.name < MIGRATION && !SEED.test(f.name)));
    await fresh.query(
      `insert into public.lender_panel (name, category, programs, appetite_notes, updated_by) values
        ('Cambridge Bank', 'STATE_BANK', '{BANK_LIFE_CO,SBA_7A}', 'Life insurance company correspondent', 'broker:ana'),
        ('Blank Lender', 'UNKNOWN', '{}', null, 'broker:ana')`,
    );
    await applyMigrations(fresh, listMigrations().filter((f) => f.name === MIGRATION));
  }, 180_000);

  afterAll(async () => {
    await fresh?.close();
  });

  it("attributes a changed staff row to the migration and leaves an unchanged one alone", async () => {
    const panel = (await fresh.query<{ name: string; loan_types: string[]; updated_by: string }>(`select name, loan_types, updated_by from public.lender_panel order by name`)).rows;
    expect(panel).toEqual([
      { name: "Blank Lender", loan_types: [], updated_by: "broker:ana" },
      { name: "Cambridge Bank", loan_types: ["sba", "bank", "life_company"], updated_by: MARKER },
    ]);
    const audit = (await fresh.query<{ actor: string; changed: string[] }>(`select a.actor, a.changed from public.audit_log a join public.lender_panel l on l.id::text = a.row_id where a.table_name = 'lender_panel' and a.action = 'UPDATE' and l.name = 'Cambridge Bank'`)).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(MARKER);
    expect(audit[0]!.changed).toContain("loan_types");
  });
});
