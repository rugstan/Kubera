// Applies the full migration set (including WS-S's market-intel and
// prospecting tables) to PGlite and checks RLS, role access and the
// constraints the agents rely on.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "@/scripts/test-migrations";

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const TABLES = ["intel_drafts", "prospect_outreach", "prospect_scans", "prospect_suppressions", "prospects"];
const sha = "a".repeat(64);

const draft = (extra = "", vals = "") =>
  db.query(`insert into public.intel_drafts (week_start, generated_by, headline, summary${extra ? `, ${extra}` : ""}) values ('2026-11-02', 'rules', 'h', 's'${vals ? `, ${vals}` : ""}) returning id`);

let n = 0;
const prospect = async (extra: Record<string, string> = {}) => {
  n += 1;
  const cols = { dedupe_key: `'p1-test-key-${n}'`, source: "'fake'", address_line1: "'1 Example Ave'", loan_maturity_date: "'2027-07-01'", data_as_of: "'2026-11-05'", score: "80", window_bucket: "'months_6_12'", ...extra };
  const res = await db.query<{ id: string }>(`insert into public.prospects (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")}) returning id`);
  return res.rows[0]!.id;
};

const outreach = (prospectId: string, key: string, cols = "", vals = "") =>
  db.query(
    `insert into public.prospect_outreach (prospect_id, channel, idempotency_key, recipient, subject, body_text, body_sha256, drafted_by${cols ? `, ${cols}` : ""})
     values ('${prospectId}', 'email', '${key}', 'pat@owner.example', 's', 'b', '${sha}', 'staff'${vals ? `, ${vals}` : ""}) returning id`,
  );

describe("WS-S migration", () => {
  it("sits in the Phase 4 slot 02 position", () => {
    expect(listMigrations().some((m) => m.name === "20261105000200_s_market_intel_prospecting.sql")).toBe(true);
  });

  it("enables RLS on every table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname in (${TABLES.map((t) => `'${t}'`).join(", ")}) order by relname`);
    expect(rows).toEqual(TABLES.map((relname) => ({ relname, relrowsecurity: true })));
  });

  it("denies anon and authenticated access", async () => {
    await draft();
    await db.exec(`grant select, insert, update, delete on ${TABLES.map((t) => `public.${t}`).join(", ")} to anon, authenticated`);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const t of TABLES) expect((await db.query(`select * from public.${t}`)).rows).toEqual([]);
      await expect(db.query("insert into public.prospect_suppressions (kind, value_hash, label, reason, created_by) values ('email', '" + sha + "', 'x', 'staff', 'x')")).rejects.toThrow(/row-level security|permission denied/);
      await db.exec("reset role");
    }
  });

  it("intel drafts: weeks start on Monday, versions are unique, reviewed drafts name a reviewer, a rejection needs a reason", async () => {
    await expect(db.query("insert into public.intel_drafts (week_start, generated_by, headline, summary) values ('2026-11-03', 'rules', 'h', 's')")).rejects.toThrow(/check/);
    await expect(draft()).rejects.toThrow(/unique|duplicate/); // same week, version 1 again (first inserted above)
    await db.exec("insert into public.intel_drafts (week_start, version, generated_by, headline, summary) values ('2026-11-09', 1, 'model', 'h', 's')");
    await expect(db.exec("insert into public.intel_drafts (week_start, version, generated_by, headline, summary, status) values ('2026-11-09', 2, 'rules', 'h', 's', 'approved')")).rejects.toThrow(/review_shape|check/);
    await expect(db.exec("insert into public.intel_drafts (week_start, version, generated_by, headline, summary, status, reviewed_by, reviewed_at) values ('2026-11-09', 3, 'rules', 'h', 's', 'rejected', 'staff', now())")).rejects.toThrow(/rejected_reason|check/);
    await db.exec("insert into public.intel_drafts (week_start, version, generated_by, headline, summary, status, reviewed_by, reviewed_at, review_note) values ('2026-11-09', 4, 'rules', 'h', 's', 'rejected', 'staff', now(), 'off topic')");
    await expect(db.exec("insert into public.intel_drafts (week_start, version, generated_by, headline, summary) values ('2026-11-16', 1, 'oracle', 'h', 's')")).rejects.toThrow(/check/);
    await expect(db.exec("insert into public.intel_drafts (week_start, version, generated_by, headline, summary, prompt_sha256) values ('2026-11-16', 1, 'model', 'h', 's', 'nothex')")).rejects.toThrow(/check/);
  });

  it("prospects: dedupe key is unique, enums and ranges are checked", async () => {
    await db.exec(`insert into public.prospects (dedupe_key, source, address_line1, loan_maturity_date, data_as_of, score, window_bucket) values ('dup-key-1', 'fake', '1 A St', '2027-01-01', '2026-11-05', 50, 'months_3_6')`);
    await expect(db.exec(`insert into public.prospects (dedupe_key, source, address_line1, loan_maturity_date, data_as_of, score, window_bucket) values ('dup-key-1', 'fake', '1 A St', '2027-01-01', '2026-11-05', 50, 'months_3_6')`)).rejects.toThrow(/unique|duplicate/);
    await expect(prospect({ score: "101" })).rejects.toThrow(/check/);
    await expect(prospect({ state: "'California'" })).rejects.toThrow(/check/);
    await expect(prospect({ property_type: "'castle'" })).rejects.toThrow(/check/);
    await expect(prospect({ status: "'won'" })).rejects.toThrow(/check/);
    await expect(prospect({ window_bucket: "'soon'" })).rejects.toThrow(/check/);
    await expect(prospect({ recommended_program: "'hard_money_fund'" })).rejects.toThrow(/check/);
    await expect(prospect({ contact_email: "'not-an-email'" })).rejects.toThrow(/check/);
    await expect(prospect({ loan_original_cents: "0" })).rejects.toThrow(/check/);
    await expect(prospect({ zip: "'9000'" })).rejects.toThrow(/check/);
    await prospect({ state: "'CA'", zip: "'90001'", contact_email: "'pat@owner.example'", loan_original_cents: "740000000", loan_rate_pct: "4.100" });
  });

  it("outreach: unique idempotency key and version, valid channel and status, and nothing is released without an approval on record", async () => {
    const p = await prospect();
    await outreach(p, "key-aaaaaaaa");
    await expect(outreach(p, "key-aaaaaaaa")).rejects.toThrow(/unique|duplicate/);
    await expect(outreach(p, "key-bbbbbbbb")).rejects.toThrow(/version_unique|unique|duplicate/); // version 1 again for the same prospect
    await outreach(p, "key-cccccccc", "version", "2");
    await expect(db.query(`insert into public.prospect_outreach (prospect_id, version, channel, idempotency_key, recipient, subject, body_text, body_sha256, drafted_by) values ('${p}', 3, 'sms', 'key-dddddddd', '+14155550100', 's', 'b', '${sha}', 'staff')`)).rejects.toThrow(/check/);
    await expect(outreach(p, "key-eeeeeeee", "version, status", "3, 'delivered'")).rejects.toThrow(/check/);
    await expect(outreach(p, "key-ffffffff", "version, reason_code", "3, 'because'")).rejects.toThrow(/check/);
    await expect(outreach(p, "short", "version", "3")).rejects.toThrow(/check/);
    // sent / ready_to_mail / mailed need an approval id
    await expect(outreach(p, "key-gggggggg", "version, status, sent_at", "3, 'sent', now()")).rejects.toThrow(/check/);
    await expect(outreach(p, "key-hhhhhhhh", "version, status, approval_id", "3, 'ready_to_mail', null")).rejects.toThrow(/released_needs_approval|check/);
    await outreach(p, "key-iiiiiiii", "version, status, approval_id, sent_at", "3, 'sent', 'a-1', now()");
    // a letter is mailed by a named person, an email is never "mailed"
    await expect(db.query(`insert into public.prospect_outreach (prospect_id, version, channel, status, idempotency_key, recipient, subject, body_text, body_sha256, drafted_by, approval_id, mailed_at, mailed_by) values ('${p}', 4, 'email', 'mailed', 'key-jjjjjjjj', 'x@y.co', 's', 'b', '${sha}', 'staff', 'a-2', now(), 'staff')`)).rejects.toThrow(/check/);
    await db.exec(`insert into public.prospect_outreach (prospect_id, version, channel, status, idempotency_key, recipient, subject, body_text, body_sha256, drafted_by, approval_id, mailed_at, mailed_by) values ('${p}', 5, 'letter', 'mailed', 'key-kkkkkkkk', '1 A St', 's', 'b', '${sha}', 'staff', 'a-3', now(), 'staff')`);
  });

  it("outreach rows go away with their prospect", async () => {
    const p = await prospect();
    await outreach(p, "key-cascade1");
    await db.exec(`delete from public.prospects where id = '${p}'`);
    expect((await db.query("select 1 from public.prospect_outreach where idempotency_key = 'key-cascade1'")).rows).toEqual([]);
  });

  it("suppressions: one row per kind and hash, hashed values only", async () => {
    await db.exec(`insert into public.prospect_suppressions (kind, value_hash, label, reason, created_by) values ('email', '${sha}', 'p***@owner.example', 'opt_out', 'staff')`);
    await expect(db.exec(`insert into public.prospect_suppressions (kind, value_hash, label, reason, created_by) values ('email', '${sha}', 'p***@owner.example', 'opt_out', 'staff')`)).rejects.toThrow(/unique|duplicate/);
    await db.exec(`insert into public.prospect_suppressions (kind, value_hash, label, reason, created_by) values ('owner', '${sha}', 'E*** C***', 'staff', 'staff')`);
    await expect(db.exec("insert into public.prospect_suppressions (kind, value_hash, label, reason, created_by) values ('email', 'pat@owner.example', 'x', 'staff', 'staff')")).rejects.toThrow(/check/);
    await expect(db.exec(`insert into public.prospect_suppressions (kind, value_hash, label, reason, created_by) values ('phone', '${sha}', 'x', 'staff', 'staff')`)).rejects.toThrow(/check/);
  });

  it("scans: provider and status are checked", async () => {
    await db.exec("insert into public.prospect_scans (provider, started_by) values ('attom', 'staff')");
    await expect(db.exec("insert into public.prospect_scans (provider, started_by) values ('zillow', 'staff')")).rejects.toThrow(/check/);
    await expect(db.exec("insert into public.prospect_scans (provider, status, started_by) values ('fake', 'done', 'staff')")).rejects.toThrow(/check/);
  });

  it("keeps updated_at current", async () => {
    const p = await prospect();
    await db.exec(`update public.prospects set updated_at = now() - interval '1 day' where id = '${p}'`);
    await db.exec(`update public.prospects set status = 'reviewing' where id = '${p}'`);
    const after = await db.query<{ fresh: boolean }>(`select updated_at > now() - interval '1 minute' as fresh from public.prospects where id = '${p}'`);
    expect(after.rows[0]?.fresh).toBe(true);
  });

  it("has no funds or draw columns", async () => {
    const { rows } = await db.query("select * from public.custody_column_violations()");
    expect(rows).toEqual([]);
  });
});
