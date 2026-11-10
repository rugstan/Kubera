// supabase/migrations/20261105120000_int_lender_contacts.sql on PGlite, after
// every other migration: RLS, the legacy-column invariant, the backfill of the
// directory seed, the primary-contact RPC, the checks, the redacting audit
// trigger (no contact values or ciphertext ever reach audit_log), the cascade
// and seed idempotency.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, custodyViolations, lintMigrationNames, lintWorkstreamSlots, listMigrations } from "../../scripts/test-migrations.ts";
import { createKeyring } from "@/lib/privacy/crypto";
import { EMAIL_DB_RE, HTTPS_DB_RE, PORTAL_DB_RE } from "./lender-contacts";
import { sealLenderAccountNumber } from "./lender-accounts";

const MIGRATION = "20261105120000_int_lender_contacts.sql";
const MARKER = "migration:20261105120000_int_lender_contacts";
const SEED = /_int_lender_directory_seed(?:_round\d+)?\.sql$/;
const SEEDED = "updated_by like 'seed:lender-directory%'";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0]!;
const n = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(sql, params)).n);

async function lender(name = "Cambridge"): Promise<string> {
  return (await one<{ id: string }>(`insert into public.lender_panel (name, category, programs, updated_by) values ($1, 'STATE_BANK', '{HUD_232}', 'broker:ana') returning id`, [name])).id;
}
async function contact(lenderId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const all: Record<string, unknown> = { lender_id: lenderId, full_name: "Dana Lee", created_by: "staff:a", ...fields };
  const cols = Object.keys(all);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  return (await one<{ id: string }>(`insert into public.lender_contacts (${cols.join(", ")}) values (${placeholders}) returning id`, Object.values(all))).id;
}

describe("lender contacts migration", () => {
  it("passes the migration lints and the no-custody guard", async () => {
    const files = listMigrations();
    expect(files.some((f) => f.name === MIGRATION)).toBe(true);
    expect(lintMigrationNames(files)).toEqual([]);
    expect(lintWorkstreamSlots(files)).toEqual([]);
    expect(await custodyViolations(db)).toEqual([]);
  });

  it("enables RLS and denies the API roles the tables and the RPC", async () => {
    const rls = await rows<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname in ('lender_contacts', 'lender_accounts')`);
    expect(rls).toHaveLength(2);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        for (const t of ["lender_contacts", "lender_accounts"]) await expect(db.query(`select * from public.${t}`)).rejects.toThrow(/permission denied/);
        await expect(db.query(`select * from public.set_lender_primary_contact(gen_random_uuid(), gen_random_uuid(), 'x')`)).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
  });

  it("leaves no legacy contact_name or contact_email after all migrations", async () => {
    // A future seed round that still writes the legacy columns fails here: it must target lender_contacts.
    expect(await n(`select count(*)::int as n from public.lender_panel where contact_name is not null or contact_email is not null`)).toBe(0);
  });

  it("backfills the directory seed into contacts, inboxes, websites and phones", async () => {
    expect(await one(`select count(*)::int as n, count(*) filter (where is_primary)::int as p, count(*) filter (where source = 'directory_import')::int as d, count(*) filter (where verified_at is null)::int as u from public.lender_contacts`)).toEqual({ n: 56, p: 55, d: 56, u: 56 });
    const mack = await rows<{ full_name: string; email: string | null; is_primary: boolean }>(
      `select c.full_name, c.email, c.is_primary from public.lender_contacts c join public.lender_panel l on l.id = c.lender_id where c.full_name in ('Brett Kaplan', 'Regina Lubin') order by c.full_name`,
    );
    expect(mack).toEqual([
      { full_name: "Brett Kaplan", email: "credit@mackregroup.com", is_primary: true },
      { full_name: "Regina Lubin", email: null, is_primary: false },
    ]);
    // The stored case is kept, so the approval recipient hash does not change.
    expect(await n(`select count(*)::int as n from public.lender_contacts where email = 'Inquiry@pccpllc.com'`)).toBe(1);
    expect(await one(`select count(submission_email)::int as sub, count(website_url)::int as web, count(main_phone)::int as ph from public.lender_panel`)).toEqual({ sub: 16, web: 238, ph: 41 });
    expect((await one<{ main_phone: string }>(`select main_phone from public.lender_panel where name = 'ACORE Capital'`)).main_phone).toBe("+14243466100");
    // An annotated number stays in the notes for a broker to confirm.
    expect(await one(`select main_phone, appetite_notes like '%201-342-8500 (main)%' as noted from public.lender_panel where name = 'Kennedy Funding'`)).toEqual({ main_phone: null, noted: true });
    expect(await n(`select count(*)::int as n from public.lender_panel where ${SEEDED}`)).toBe(374);
  });

  it("allows one primary per lender; the RPC switches it, refuses other lenders' and left contacts, and is a no-op on the primary", async () => {
    const a = await lender();
    const b = await lender("Greystone");
    const dana = await contact(a, { is_primary: true, email: "dana@cambridge.example" });
    const kim = await contact(a, { full_name: "Kim Park" });
    const onB = await contact(b, { full_name: "Lee Chan" });
    await expect(contact(a, { full_name: "Two", is_primary: true })).rejects.toThrow(/lender_contacts_one_primary/);
    const switched = await rows<{ id: string; is_primary: boolean; record_version: number }>(`select id, is_primary, record_version from public.set_lender_primary_contact($1, $2, 'staff:b')`, [a, kim]);
    expect(switched).toEqual([{ id: kim, is_primary: true, record_version: 2 }]);
    expect(await one(`select is_primary, record_version, updated_by from public.lender_contacts where id = $1`, [dana])).toEqual({ is_primary: false, record_version: 2, updated_by: "staff:b" });
    expect(await rows(`select * from public.set_lender_primary_contact($1, $2, 'x')`, [a, onB])).toEqual([]);
    expect(await one(`select is_primary, record_version from public.lender_contacts where id = $1`, [onB])).toEqual({ is_primary: false, record_version: 1 });
    await db.query(`update public.lender_contacts set status = 'left', left_at = now() where id = $1`, [dana]);
    expect(await rows(`select * from public.set_lender_primary_contact($1, $2, 'x')`, [a, dana])).toEqual([]);
    expect(await rows(`select record_version from public.set_lender_primary_contact($1, $2, 'x')`, [a, kim])).toEqual([{ record_version: 2 }]);
  });

  it("checks contacts and contact info", async () => {
    const a = await lender();
    const primary = await contact(a, { is_primary: true });
    const c = await contact(a, { full_name: "Kim Park" });
    await expect(db.query(`update public.lender_contacts set status = 'left', left_at = now() where id = $1`, [primary])).rejects.toThrow(/lender_contacts_left/);
    await expect(db.query(`update public.lender_contacts set status = 'left' where id = $1`, [c])).rejects.toThrow(/lender_contacts_left/);
    await expect(db.query(`update public.lender_contacts set preferred_channel = 'mobile' where id = $1`, [c])).rejects.toThrow(/lender_contacts_channel_has_value/);
    await expect(db.query(`update public.lender_contacts set phone_ext = '12' where id = $1`, [c])).rejects.toThrow(/lender_contacts_ext_needs_phone/);
    for (const [col, v] of [["email", "a b@x.com"], ["email", "x@y"], ["email", "Name <a@b.com>"], ["email", "a@b.c\r\nBcc: x@y.z"], ["phone_direct", "3105550100"]] as const)
      await expect(db.query(`update public.lender_contacts set ${col} = $2 where id = $1`, [c, v]), `${col} ${v}`).rejects.toThrow(/check constraint/);
    for (const [col, v] of [["website_url", "http://x.com"], ["website_url", "javascript:alert(1)"], ["website_url", "https://user:pw@x.com"], ["portal_url", "https://x.com/login?token=abc"], ["portal_url", "https://x.com/#f"], ["main_phone", "310-555-0100"], ["postal_code", "9021"], ["main_phone_ext", "12"]] as const)
      await expect(db.query(`update public.lender_panel set ${col} = $2 where id = $1`, [a, v]), `${col} ${v}`).rejects.toThrow(/check constraint/);
    await db.query(`update public.lender_panel set website_url = 'https://x.com/a?b=1', portal_url = 'https://portal.x.com/login', postal_code = '90210-1234', main_phone = '+13105550100', main_phone_ext = '12' where id = $1`, [a]);
  });

  it("agrees with the TS twins of the email and https checks", async () => {
    const sql = async (pattern: string, v: string) => (await one<{ ok: boolean }>(`select $1 ~ $2 as ok`, [v, pattern])).ok;
    const EMAIL = `^[^@[:space:][:cntrl:]<>",;]{1,64}@[^@[:space:][:cntrl:]<>",;]+\\.[^@[:space:][:cntrl:]<>",;]+$`;
    const HTTPS = `^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:][:cntrl:]<>"]*)?$`;
    const PORTAL = `^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:][:cntrl:]<>"?#]*)?$`;
    for (const v of ["a@b.co", "Pat@Lender.example", "a b@c.com", "a,b@c.com", "<a@b.com>", "a@b", "a@b.c\r\n", "a;b@x.com", "\"q\"@x.com", "ü@x.de", "a\u0085b@x.com"])
      expect(await sql(EMAIL, v), `email ${JSON.stringify(v)}`).toBe(EMAIL_DB_RE.test(v));
    for (const v of ["https://x.com/", "https://x.com/a?b#c", "https://x.com/a b", "https://x.com/<x>", "https://u:p@x.com/", "https://x.com:8443/", "http://x.com/", "https://x.com/\"", "https://x.com/%20"]) {
      expect(await sql(HTTPS, v), `https ${v}`).toBe(HTTPS_DB_RE.test(v));
      expect(await sql(PORTAL, v), `portal ${v}`).toBe(PORTAL_DB_RE.test(v));
    }
  });

  it("checks account rows: an id, an envelope, a short hint, one per (lender, kind, label)", async () => {
    const a = await lender();
    const id = "11111111-1111-4111-8111-111111111111";
    const { numberEnc } = sealLenderAccountNumber(id, "SVC-0099887766", createKeyring({ version: 1, key: Buffer.alloc(32, 7) }));
    await expect(db.query(`insert into public.lender_accounts (lender_id, kind, label, number_enc, created_by) values ($1, 'broker_id', 'Broker ID', $2, 'staff:a')`, [a, numberEnc])).rejects.toThrow(/null value/);
    await expect(db.query(`insert into public.lender_accounts (id, lender_id, kind, label, number_enc, created_by) values ($1, $2, 'broker_id', 'Broker ID', '12345678', 'staff:a')`, [id, a])).rejects.toThrow(/number_enc/);
    await expect(db.query(`insert into public.lender_accounts (id, lender_id, kind, label, number_enc, number_last4, created_by) values ($1, $2, 'broker_id', 'Broker ID', $3, '12345', 'staff:a')`, [id, a, numberEnc])).rejects.toThrow(/number_last4/);
    await db.query(`insert into public.lender_accounts (id, lender_id, kind, label, number_enc, number_last4, created_by) values ($1, $2, 'broker_id', 'Broker ID', $3, '7766', 'staff:a')`, [id, a, numberEnc]);
    await expect(db.query(`insert into public.lender_accounts (id, lender_id, kind, label, number_enc, created_by) values (gen_random_uuid(), $1, 'broker_id', 'Broker ID', $2, 'staff:a')`, [a, numberEnc])).rejects.toThrow(/lender_accounts_lender_id_kind_label_key/);
  });

  it("keeps contact values and ciphertext out of audit_log, while changed[] still names the columns", async () => {
    const a = await lender();
    const c = await contact(a, { email: "dana@x.example", phone_direct: "+13105550100", notes: "secret note" });
    await db.query(`update public.lender_contacts set email = 'dana.lee@x.example', updated_by = 'staff:b' where id = $1`, [c]);
    await db.query(`delete from public.lender_contacts where id = $1`, [c]);
    const id = "22222222-2222-4222-8222-222222222222";
    const key = createKeyring({ version: 1, key: Buffer.alloc(32, 7) });
    const first = sealLenderAccountNumber(id, "SVC-0099887766", key);
    const second = sealLenderAccountNumber(id, "SVC-1122334455", key);
    await db.query(`insert into public.lender_accounts (id, lender_id, kind, label, number_enc, number_last4, notes, created_by) values ($1, $2, 'client_account', 'Servicing', $3, $4, 'acct note', 'staff:a')`, [id, a, first.numberEnc, first.numberLast4]);
    await db.query(`update public.lender_accounts set number_enc = $2, number_last4 = $3, updated_by = 'staff:b' where id = $1`, [id, second.numberEnc, second.numberLast4]);
    await db.query(`delete from public.lender_accounts where id = $1`, [id]);

    const audit = await rows<{ table_name: string; action: string; actor: string; changed: string[]; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null; blob: string }>(
      `select table_name, action, actor, changed, old_row, new_row, coalesce(old_row::text, '') || coalesce(new_row::text, '') as blob from public.audit_log where row_id = any($1::text[]) order by id`,
      [[c, id]],
    );
    expect(audit.map((r) => `${r.table_name}:${r.action}`)).toEqual(["lender_contacts:INSERT", "lender_contacts:UPDATE", "lender_contacts:DELETE", "lender_accounts:INSERT", "lender_accounts:UPDATE", "lender_accounts:DELETE"]);
    expect(audit[1]).toMatchObject({ actor: "staff:b", changed: ["email", "updated_by"] });
    expect(audit[1]!.old_row!.email).toBe("[redacted]");
    expect(audit[1]!.new_row!.email).toBe("[redacted]");
    expect(audit[4]!.changed).toEqual(["number_enc", "number_last4", "updated_by"]);
    expect(audit[4]!.new_row).toMatchObject({ number_enc: "[redacted]", number_last4: "4455" });
    for (const r of audit) for (const v of ["dana@x.example", "dana.lee@x.example", "+13105550100", "secret note", "acct note", first.numberEnc, second.numberEnc]) expect(r.blob, `${r.table_name} ${r.action}`).not.toContain(v);
    expect(await n(`select count(*)::int as n from public.audit_log where old_row::text ~ 'pii1\\.' or new_row::text ~ 'pii1\\.'`)).toBe(0);
  });

  it("cascades a lender delete to its contacts and accounts with redacted audit rows", async () => {
    const a = await lender("Gone");
    const c = await contact(a, { email: "gone@x.example" });
    const id = "33333333-3333-4333-8333-333333333333";
    const { numberEnc } = sealLenderAccountNumber(id, "SVC-0099887766", createKeyring({ version: 1, key: Buffer.alloc(32, 7) }));
    await db.query(`insert into public.lender_accounts (id, lender_id, kind, label, number_enc, created_by) values ($1, $2, 'broker_id', 'Broker ID', $3, 'staff:a')`, [id, a, numberEnc]);
    await db.query(`delete from public.lender_panel where id = $1`, [a]);
    expect(await n(`select count(*)::int as n from public.lender_contacts where lender_id = $1`, [a])).toBe(0);
    expect(await n(`select count(*)::int as n from public.lender_accounts where lender_id = $1`, [a])).toBe(0);
    const deleted = await rows<{ table_name: string; old_row: Record<string, unknown> }>(`select table_name, old_row from public.audit_log where action = 'DELETE' and row_id = any($1::text[]) order by id`, [[c, id]]);
    expect(deleted.map((r) => r.table_name).sort()).toEqual(["lender_accounts", "lender_contacts"]);
    expect(deleted.find((r) => r.table_name === "lender_contacts")!.old_row.email).toBe("[redacted]");
    expect(deleted.find((r) => r.table_name === "lender_accounts")!.old_row.number_enc).toBe("[redacted]");
  });

  it("keeps the seed files idempotent", async () => {
    const counts = () => one(`select (select count(*) from public.lender_panel)::int as p, (select count(*) from public.credit_boxes)::int as b, (select count(*) from public.lender_contacts)::int as c`);
    const before = await counts();
    for (const s of listMigrations().filter((f) => SEED.test(f.name))) await db.exec(s.sql);
    expect(await counts()).toEqual(before);
    expect(await n(`select count(*)::int as n from public.lender_panel where contact_name is not null or contact_email is not null`)).toBe(0);
  });
});

describe("lender contacts migration on staff-created rows", () => {
  let fresh: PGlite;

  beforeAll(async () => {
    fresh = await createStubbedDb();
    await applyMigrations(fresh, listMigrations().filter((f) => f.name < MIGRATION && !SEED.test(f.name)));
    await fresh.query(
      `insert into public.lender_panel (name, category, programs, updated_by, contact_name, contact_email) values
        ('Staff Lender', 'STATE_BANK', '{HUD_232}', 'broker:ana', 'Pat Doe', 'Pat@Lender.example'),
        ('Inbox Only', 'STATE_BANK', '{HUD_232}', 'broker:ana', null, 'loans@inbox.example'),
        ('Bad Email', 'STATE_BANK', '{HUD_232}', 'broker:ana', 'Lee', 'not an email')`,
    );
    await applyMigrations(fresh, listMigrations().filter((f) => f.name === MIGRATION));
  }, 180_000);

  afterAll(async () => {
    await fresh?.close();
  });

  it("moves legacy values into contacts and the submission inbox, attributed to the migration", async () => {
    const panel = (await fresh.query<{ name: string; contact_name: string | null; contact_email: string | null; submission_email: string | null; updated_by: string }>(`select name, contact_name, contact_email, submission_email, updated_by from public.lender_panel order by name`)).rows;
    expect(panel).toEqual([
      { name: "Bad Email", contact_name: null, contact_email: "not an email", submission_email: null, updated_by: MARKER },
      { name: "Inbox Only", contact_name: null, contact_email: null, submission_email: "loans@inbox.example", updated_by: MARKER },
      { name: "Staff Lender", contact_name: null, contact_email: null, submission_email: null, updated_by: MARKER },
    ]);
    const contacts = (await fresh.query(`select full_name, email, is_primary, source, created_by from public.lender_contacts order by full_name`)).rows;
    expect(contacts).toEqual([
      { full_name: "Lee", email: null, is_primary: true, source: "staff", created_by: MARKER },
      { full_name: "Pat Doe", email: "Pat@Lender.example", is_primary: true, source: "staff", created_by: MARKER },
    ]);
  });

  it("still loads the seeds after the non-seed migrations", async () => {
    await applyMigrations(fresh, listMigrations().filter((f) => f.name > MIGRATION && !SEED.test(f.name)));
    for (const s of listMigrations().filter((f) => SEED.test(f.name))) await fresh.exec(s.sql);
    expect(Number((await fresh.query<{ n: number }>(`select count(*)::int as n from public.lender_panel where ${SEEDED}`)).rows[0]!.n)).toBe(374);
  });
});
