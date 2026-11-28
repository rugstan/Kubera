// supabase/migrations/20261105160000_int_deal_submission.sql on PGlite, after
// every other migration (spec 7.2): RLS, the column checks (and their zod
// twins in schema.ts), full audit on the deal profile, redacted audit on the
// sponsor profile and the locked summaries, immutable summaries, the
// readiness and email constraints on lender_outreach, and the no-custody guard.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, custodyViolations, listMigrations } from "../../../scripts/test-migrations.ts";
import { createKeyring } from "@/lib/privacy/crypto";
import { sealLenderAccountNumber } from "../lender-accounts";
import { emailSha256 } from "./email";
import { findRestrictedText } from "./redaction";
import { profileToRow, sponsorToRow, summaryToRow } from "./rows";
import {
  POSTAL_CODE_DB_RE,
  PROFILE_FIELD_SCHEMAS,
  PROFILE_NUMBER_LIMITS,
  SPONSOR_FIELD_SCHEMAS,
  SPONSOR_NUMBER_LIMITS,
  sponsorProfileFieldsSchema,
  submissionProfileFieldsSchema,
  MAX_CENTS,
} from "./schema";
import { allSubmissionFixtures } from "./test-fixtures";

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
const sha = (c: string) => c.repeat(64);
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const TABLES = ["deal_submission_profiles", "deal_sponsor_profiles", "deal_summaries"];
const JSONB = new Set(["risks", "sources", "uses", "program_details", "field_sources", "credit_events", "spec"]);

async function deal(): Promise<string> {
  return (await one<{ id: string }>(`insert into public.deals (title, program, stage, stage_template_version, loan_amount_cents, updated_by) values ('Test deal', 'PRIVATE_BRIDGE', 'intake', 1, 840000000, 'broker:ana') returning id`)).id;
}

/** Inserts a row whose keys are column names, casting jsonb and text[] values. */
async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(row);
  const values = cols.map((c) => (JSONB.has(c) ? JSON.stringify(row[c]) : row[c]));
  const placeholders = cols.map((c, i) => `$${i + 1}${JSONB.has(c) ? "::jsonb" : c === "highlights" ? "::text[]" : ""}`);
  return (await one<{ id: string }>(`insert into public.${table} (${cols.join(", ")}) values (${placeholders.join(", ")}) returning id`, values)).id;
}

const profileRow = async (fields: Record<string, unknown> = {}) => insert("deal_submission_profiles", { deal_id: await deal(), created_by: "broker:ana", playbook: "bridge", ...fields });
const sponsorRow = async (fields: Record<string, unknown> = {}) => insert("deal_sponsor_profiles", { deal_id: await deal(), created_by: "broker:ana", ...fields });

/** Whether the database accepts `value` in `column` of a fresh row. */
async function dbAccepts(table: "deal_submission_profiles" | "deal_sponsor_profiles", column: string, value: unknown, extra: Record<string, unknown> = {}): Promise<boolean> {
  try {
    if (table === "deal_submission_profiles") await profileRow({ [column]: value, ...extra });
    else await sponsorRow({ [column]: value, ...extra });
    return true;
  } catch (err) {
    if (!/check constraint|out of range|invalid input/i.test(String(err))) throw err;
    return false;
  }
}

describe("tables and RLS", () => {
  it("creates the three tables with RLS on, and denies the API roles", async () => {
    const r = await rows<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname = any($1::text[])`, [TABLES]);
    expect(r.map((x) => x.relname).sort()).toEqual([...TABLES].sort());
    expect(r.every((x) => x.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const t of TABLES) await expect(db.query(`select * from public.${t}`), `${role} ${t}`).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("has no funds or draw columns (no-custody guard)", async () => {
    expect(await custodyViolations(db)).toEqual([]);
  });
});

describe("deal_submission_profiles", () => {
  it("holds one row per deal", async () => {
    const d = await deal();
    await insert("deal_submission_profiles", { deal_id: d, created_by: "a", playbook: "bridge" });
    await expect(insert("deal_submission_profiles", { deal_id: d, created_by: "a", playbook: "cmbs" })).rejects.toThrow(/deal_submission_profiles_deal_id_key/);
  });

  it("rejects a bad playbook, an out-of-range percentage, interest-only past the term and SSN-shaped text", async () => {
    await expect(profileRow({ playbook: "fixer_upper" })).rejects.toThrow(/check constraint/);
    await expect(profileRow({ occupancy_pct: 100.5 })).rejects.toThrow(/check constraint/);
    await expect(profileRow({ requested_term_months: 24, requested_io_months: 36 })).rejects.toThrow(/deal_submission_profiles_io_within_term/);
    for (const col of ["business_plan", "exit_detail", "cash_out_use", "close_driver", "property_name", "zoning"]) await expect(profileRow({ [col]: "Guarantor 123-45-6789" }), col).rejects.toThrow(/deal_submission_profiles_no_restricted/);
    await expect(profileRow({ highlights: ["Strong sponsor", "DOB 03/04/1971"] })).rejects.toThrow(/deal_submission_profiles_no_restricted/);
    await expect(profileRow({ risks: [{ risk: "Tenant default", mitigant: "Guarantor S.S.N. on file" }] })).rejects.toThrow(/deal_submission_profiles_no_restricted/);
    await expect(profileRow({ sources: [{ kind: "senior_loan", amountCents: 123456789012, note: "acct ending 0123 4567" }] })).rejects.toThrow(/deal_submission_profiles_no_restricted/);
    await expect(profileRow({ program_details: { rehab: { budgetCents: 126000000, scopeSummary: "Paid from account 0123 4567 8901" } } })).rejects.toThrow(/deal_submission_profiles_no_restricted/);
    // Numbers inside the jsonb sections are amounts, not identifiers: only their strings are checked.
    await expect(profileRow({ sources: [{ kind: "senior_loan", amountCents: 123456789012 }], program_details: { rehab: { budgetCents: 126000000 } } })).resolves.toBeTruthy();
    // The APN is an identifier, not free text.
    await expect(profileRow({ apn: "123-456-789" })).resolves.toBeTruthy();
  });

  it("audits an update with the actor, the deal, the changed columns and the old and new values", async () => {
    const id = await profileRow({ noi_in_place_cents: 76_500_000 });
    const dealId = (await one<{ deal_id: string }>(`select deal_id from public.deal_submission_profiles where id = $1`, [id])).deal_id;
    await db.query(`update public.deal_submission_profiles set noi_in_place_cents = 74_000_000, record_version = 2, updated_by = 'broker:lee' where id = $1`, [id]);
    const audit = await rows<{ action: string; actor: string; deal_id: string; changed: string[]; old_row: Record<string, unknown>; new_row: Record<string, unknown> }>(
      `select action, actor, deal_id, changed, old_row, new_row from public.audit_log where table_name = 'deal_submission_profiles' and row_id = $1 order by id`,
      [id],
    );
    expect(audit.map((a) => a.action)).toEqual(["INSERT", "UPDATE"]);
    expect(audit[1]).toMatchObject({ actor: "broker:lee", deal_id: dealId, changed: ["noi_in_place_cents", "record_version", "updated_by"] });
    expect(audit[1]!.old_row.noi_in_place_cents).toBe(76_500_000);
    expect(audit[1]!.new_row.noi_in_place_cents).toBe(74_000_000);
  });

  it("touches updated_at on update", async () => {
    const id = await profileRow();
    await db.query(`update public.deal_submission_profiles set updated_at = '2020-01-01' where id = $1`, [id]);
    const r = await one<{ updated_at: Date }>(`select updated_at from public.deal_submission_profiles where id = $1`, [id]);
    expect(r.updated_at.getFullYear()).toBeGreaterThan(2020);
  });
});

describe("deal_sponsor_profiles", () => {
  it("rejects stated figures without a date, and SSN-shaped text", async () => {
    await expect(sponsorRow({ stated_net_worth_cents: 100 })).rejects.toThrow(/deal_sponsor_profiles_stated_dated/);
    await expect(sponsorRow({ stated_liquidity_cents: 100 })).rejects.toThrow(/deal_sponsor_profiles_stated_dated/);
    await sponsorRow({ stated_net_worth_cents: 100, stated_as_of: "2026-09-30" });
    await expect(sponsorRow({ notes: "SSN 123-45-6789" })).rejects.toThrow(/deal_sponsor_profiles_no_restricted/);
    await expect(sponsorRow({ management_company: "Tax id 123 456 789" })).rejects.toThrow(/deal_sponsor_profiles_no_restricted/);
    await expect(sponsorRow({ credit_events: { judgment: { occurred: true, explanation: "Settled; birthday 1/2/1970" } } })).rejects.toThrow(/deal_sponsor_profiles_no_restricted/);
    await expect(sponsorRow({ email_financials_mode: "exact" })).rejects.toThrow(/check constraint/);
  });

  it("audits who changed which column, with the deal id, and redacts every column but the keys", async () => {
    const id = await sponsorRow({
      experience_summary: "Eleven value-add projects",
      portfolio_size_note: "11 properties",
      stated_net_worth_cents: 1_850_000_000,
      stated_liquidity_cents: 240_000_000,
      stated_as_of: "2026-09-30",
      credit_band: "740_PLUS",
      credit_events: { bankruptcy: { occurred: false } },
      notes: "Prefers email",
      years_experience: 14,
      similar_projects_count: 9,
      portfolio_count: 31,
      management_company: "Halvorsen Property Services",
      email_financials_mode: "rounded",
    });
    const dealId = (await one<{ deal_id: string }>(`select deal_id from public.deal_sponsor_profiles where id = $1`, [id])).deal_id;
    await db.query(`update public.deal_sponsor_profiles set stated_net_worth_cents = 1_900_000_000, years_experience = 15, record_version = 2, updated_by = 'broker:lee' where id = $1`, [id]);
    const audit = await rows<{ action: string; actor: string; deal_id: string; changed: string[]; old_row: Record<string, unknown>; new_row: Record<string, unknown>; blob: string }>(
      `select action, actor, deal_id, changed, old_row, new_row, coalesce(old_row::text, '') || coalesce(new_row::text, '') as blob from public.audit_log where table_name = 'deal_sponsor_profiles' and row_id = $1 order by id`,
      [id],
    );
    expect(audit.map((a) => a.action)).toEqual(["INSERT", "UPDATE"]);
    expect(audit[1]).toMatchObject({ actor: "broker:lee", deal_id: dealId, changed: ["record_version", "stated_net_worth_cents", "updated_by", "years_experience"] });
    // Every column of the table except the keys and the row bookkeeping is redacted, in old and new rows alike.
    const KEPT = new Set(["id", "deal_id", "created_at", "created_by", "updated_at", "updated_by", "record_version"]);
    const columns = (await rows<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'deal_sponsor_profiles'`)).map((c) => c.column_name).filter((c) => !KEPT.has(c));
    expect(columns.length).toBe(13);
    for (const col of columns) {
      expect(audit[1]!.old_row[col], col).toBe("[redacted]");
      expect(audit[1]!.new_row[col], col).toBe("[redacted]");
      expect(audit[0]!.new_row[col], col).toBe("[redacted]");
    }
    for (const secret of ["1850000000", "1900000000", "240000000", "Eleven value-add", "Prefers email", "740_PLUS", "bankruptcy", "2026-09-30", "Halvorsen", "rounded", '"years_experience": 15', '"years_experience": 14', '"portfolio_count": 31']) {
      for (const a of audit) expect(a.blob, secret).not.toContain(secret);
    }
    // The changed-column list still says what changed (never the values).
    expect(audit[1]!.changed).toContain("years_experience");
  });
});

describe("deal_summaries", () => {
  async function summary(dealId: string, pdf = "b"): Promise<string> {
    return insert("deal_summaries", {
      deal_id: dealId,
      created_by: "broker:ana",
      as_of: "2026-11-18",
      playbook: "bridge",
      target_stage: "screen",
      template_version: "summary-v1",
      spec: { title: "T", sections: [{ rows: [{ label: "Combined guarantor net worth", value: "$19,000,000" }] }] },
      spec_sha256: sha("a"),
      pdf_sha256: sha(pdf),
      pdf_storage_path: `deals/${dealId}/summary.pdf`,
      profile_version: 7,
      sponsor_version: 3,
    });
  }

  it("refuses updates and a duplicate PDF hash on the same deal", async () => {
    const d = await deal();
    const id = await summary(d);
    await expect(db.query(`update public.deal_summaries set template_version = 'x' where id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(db.query(`delete from public.deal_summaries where id = $1`, [id])).rejects.toThrow(/immutable/);
    expect((await rows(`select id from public.deal_summaries where id = $1`, [id])).length).toBe(1);
    await expect(summary(d)).rejects.toThrow(/deal_summaries_deal_id_pdf_sha256_key/);
    await summary(await deal());
    await expect(insert("deal_summaries", { deal_id: d, created_by: "a", as_of: "2026-11-18", playbook: "bridge", target_stage: "close", template_version: "v", spec: {}, spec_sha256: sha("a"), pdf_sha256: sha("c"), pdf_storage_path: "p", profile_version: 1 })).rejects.toThrow(/check constraint/);
  });

  it("redacts the spec in the audit row and keeps the hashes", async () => {
    const d = await deal();
    const id = await summary(d, "d");
    const a = await one<{ deal_id: string; new_row: Record<string, unknown>; blob: string }>(`select deal_id, new_row, new_row::text as blob from public.audit_log where table_name = 'deal_summaries' and row_id = $1`, [id]);
    expect(a.deal_id).toBe(d);
    expect(a.new_row.spec).toBe("[redacted]");
    expect(a.new_row.pdf_sha256).toBe(sha("d"));
    expect(a.new_row.spec_sha256).toBe(sha("a"));
    expect(a.blob).not.toContain("19,000,000");
  });
});

describe("lender_outreach submission columns", () => {
  async function outreach(fields: Record<string, unknown> = {}): Promise<string> {
    const d = await deal();
    const l = (await one<{ id: string }>(`insert into public.lender_panel (name, category, programs, updated_by) values ('Cambridge', 'STATE_BANK', '{PRIVATE_BRIDGE}', 'broker:ana') returning id`)).id;
    const pkg = (await one<{ id: string }>(`insert into public.deal_packages (deal_id, version, status, manifest, manifest_sha256, locked_at, locked_by) values ($1, 1, 'locked', '[]', $2, now(), 'a') returning id`, [d, sha("e")])).id;
    const base: Record<string, unknown> = { deal_id: d, lender_id: l, package_id: pkg, package_version: 1, status: "pending_approval", approval_key: `k-${pkg}`, requested_by: "a", ...fields };
    const cols = Object.keys(base);
    const placeholders = cols.map((c, i) => `$${i + 1}${c === "lender_fit" ? "::jsonb" : c === "readiness_missing" ? "::text[]" : ""}`);
    return (await one<{ id: string }>(`insert into public.lender_outreach (${cols.join(", ")}) values (${placeholders.join(", ")}) returning id`, cols.map((c) => (c === "lender_fit" ? JSON.stringify(base[c]) : base[c])))).id;
  }
  const email = (text: string, subject = "Loan request: $8,400,000 bridge") => ({ email_subject: subject, email_text: text, email_sha256: emailSha256(subject, text) });

  it("accepts a row without any submission column (existing rows), and a complete submission", async () => {
    const id = await outreach();
    const r = await one<{ readiness_missing: string[]; target_stage: string | null; email_text: string | null }>(`select readiness_missing, target_stage, email_text from public.lender_outreach where id = $1`, [id]);
    expect(r).toEqual({ readiness_missing: [], target_stage: null, email_text: null });
    await outreach({ target_stage: "term_sheet", readiness_missing: ["docs.t12"], readiness_override_reason: "The T-12 arrives Friday; the lender asked for the summary now.", lender_fit: { matches: ["Bridge"] }, ...email("Hello,\nCall 415-555-0100.\n{{SHARE_LINK}}") });
  });

  it("needs a reason of 20 to 1000 characters when required items are missing", async () => {
    await expect(outreach({ readiness_missing: ["value.basis"] })).rejects.toThrow(/lender_outreach_override_when_missing/);
    await expect(outreach({ readiness_missing: ["value.basis"], readiness_override_reason: "   too short     " })).rejects.toThrow(/readiness_override_reason/);
    await expect(outreach({ readiness_missing: ["value.basis"], readiness_override_reason: "x".repeat(1001) })).rejects.toThrow(/readiness_override_reason/);
    await expect(outreach({ target_stage: "close" })).rejects.toThrow(/check constraint/);
  });

  it("refuses an email body with an SSN shape or nine digits in a row, and needs subject, text and hash together", async () => {
    await expect(outreach(email("Guarantor 123-45-6789"))).rejects.toThrow(/lender_outreach_email_no_restricted/);
    await expect(outreach(email("Wire to 021000021"))).rejects.toThrow(/lender_outreach_email_no_restricted/);
    await expect(outreach({ email_text: "Hello", email_sha256: sha("f") })).rejects.toThrow(/lender_outreach_email_complete/);
    await expect(outreach({ email_subject: "S", email_text: "Hello" })).rejects.toThrow(/lender_outreach_email_complete/);
    await expect(outreach(email("Hello", "Line\nbreak"))).rejects.toThrow(/email_subject/);
  });

  it("holds the stored hash to the stored subject and text, the same rule as emailSha256", async () => {
    await expect(outreach(email("Hello,\n{{SHARE_LINK}} ✓"))).resolves.toBeTruthy();
    await expect(outreach({ ...email("Hello,\n{{SHARE_LINK}}"), email_sha256: sha("f") })).rejects.toThrow(/lender_outreach_email_hash/);
    // The hash covers the subject too: the same text under another subject does not verify.
    await expect(outreach({ ...email("Hello,\n{{SHARE_LINK}}"), email_subject: "Another subject" })).rejects.toThrow(/lender_outreach_email_hash/);
    const id = await outreach(email("Hello,\n{{SHARE_LINK}}"));
    await expect(db.query(`update public.lender_outreach set email_text = 'Edited after approval {{SHARE_LINK}}' where id = $1`, [id])).rejects.toThrow(/lender_outreach_email_hash/);
  });
});

describe("audit_row_change_redacted for tables without a deal", () => {
  it("still writes a null deal_id for lender_contacts and lender_accounts", async () => {
    const l = (await one<{ id: string }>(`insert into public.lender_panel (name, category, programs, updated_by) values ('Kestrel', 'STATE_BANK', '{HUD_232}', 'broker:ana') returning id`)).id;
    const c = (await one<{ id: string }>(`insert into public.lender_contacts (lender_id, full_name, email, created_by) values ($1, 'Dana Lee', 'dana@x.example', 'staff:a') returning id`, [l])).id;
    const accountId = "33333333-3333-4333-8333-333333333333";
    const { numberEnc, numberLast4 } = sealLenderAccountNumber(accountId, "SVC-0099887766", createKeyring({ version: 1, key: Buffer.alloc(32, 7) }));
    await db.query(`insert into public.lender_accounts (id, lender_id, kind, label, number_enc, number_last4, created_by) values ($1, $2, 'broker_id', 'Broker ID', $3, $4, 'staff:a')`, [accountId, l, numberEnc, numberLast4]);
    const audit = await rows<{ table_name: string; deal_id: string | null }>(`select table_name, deal_id from public.audit_log where row_id = any($1::text[])`, [[c, accountId]]);
    expect(audit.map((a) => a.table_name).sort()).toEqual(["lender_accounts", "lender_contacts"]);
    expect(audit.every((a) => a.deal_id === null)).toBe(true);
  });
});

describe("zod and the database agree (schema.ts twins)", () => {
  it("every fixture profile and sponsor that zod accepts, the database accepts (row mapping included)", async () => {
    for (const [pb, ctx] of allSubmissionFixtures()) {
      const { id: _i, dealId: _d, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, recordVersion: _v, ...fields } = ctx.profile!;
      const parsed = submissionProfileFieldsSchema.parse(fields);
      await expect(profileRow(profileToRow(parsed)), pb).resolves.toBeTruthy();
      const { id: _si, dealId: _sd, createdAt: _sc, createdBy: _scb, updatedAt: _su, updatedBy: _sub, recordVersion: _sv, ...sponsor } = ctx.sponsor!;
      await expect(sponsorRow(sponsorToRow(sponsorProfileFieldsSchema.parse(sponsor))), pb).resolves.toBeTruthy();
    }
  });

  it("round-trips a fixture profile through the database unchanged", async () => {
    const [, ctx] = allSubmissionFixtures().find(([pb]) => pb === "hotel_pip_bridge")!;
    const { id: _i, dealId: _d, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, recordVersion: _v, ...fields } = ctx.profile!;
    const id = await profileRow(profileToRow(fields));
    const stored = await one<Record<string, unknown>>(`select * from public.deal_submission_profiles where id = $1`, [id]);
    for (const [k, v] of Object.entries(fields)) {
      const got = stored[snake(k)];
      const norm = got instanceof Date ? got.toISOString().slice(0, 10) : typeof got === "string" && typeof v === "number" ? Number(got) : got;
      expect(norm, k).toEqual(v);
    }
  });

  const probes = (l: { min: number; max: number; int: boolean }): [number, boolean][] => {
    const step = l.int ? 1 : 0.001;
    const out: [number, boolean][] = [];
    if (l.min !== -MAX_CENTS) out.push([l.min, true], [Math.round((l.min - step) * 1000) / 1000, false]);
    if (l.max !== MAX_CENTS) out.push([l.max, true], [Math.round((l.max + step) * 1000) / 1000, false]);
    if (l.int) out.push([l.min === -MAX_CENTS ? -5.5 : l.min + 0.5, false]);
    if (l.min === -MAX_CENTS) out.push([-76_500_000, true]);
    return out;
  };

  it.each(Object.entries(PROFILE_NUMBER_LIMITS))("profile %s: the same values pass and fail in both", async (key, l) => {
    for (const [value, ok] of probes(l)) {
      const zodOk = PROFILE_FIELD_SCHEMAS[key as keyof typeof PROFILE_FIELD_SCHEMAS].safeParse(value).success;
      expect(zodOk, `${key}=${value} zod`).toBe(l.int && !Number.isInteger(value) ? false : ok);
      // The database rounds a fraction into an integer column instead of refusing it; zod refuses it (stricter).
      if (l.int && !Number.isInteger(value)) continue;
      expect(await dbAccepts("deal_submission_profiles", snake(key), value), `${key}=${value} db`).toBe(ok);
    }
  });

  it.each(Object.entries(SPONSOR_NUMBER_LIMITS))("sponsor %s: the same values pass and fail in both", async (key, l) => {
    const dated = key.startsWith("stated") ? { stated_as_of: "2026-09-30" } : {};
    for (const [value, ok] of probes(l)) {
      const zodOk = SPONSOR_FIELD_SCHEMAS[key as keyof typeof SPONSOR_FIELD_SCHEMAS].safeParse(value).success;
      expect(zodOk, `${key}=${value} zod`).toBe(l.int && !Number.isInteger(value) ? false : ok);
      if (l.int && !Number.isInteger(value)) continue;
      expect(await dbAccepts("deal_sponsor_profiles", snake(key), value, dated), `${key}=${value} db`).toBe(ok);
    }
  });

  it("the regex twins match exactly what Postgres matches", async () => {
    const pg = async (pattern: string, v: string) => (await one<{ ok: boolean }>(`select $1 ~ $2 as ok`, [v, pattern])).ok;
    const samples = ["94611", "94611-1234", "9461", "946111", "94611-12", "94611 1234", "ab123"];
    for (const v of samples) expect(await pg(POSTAL_CODE_DB_RE.source, v), `postal ${v}`).toBe(POSTAL_CODE_DB_RE.test(v));
  });

  it("public.submission_text_restricted refuses what redaction.ts refuses, and accepts what it accepts", async () => {
    const pg = async (v: string) => (await one<{ bad: boolean }>(`select public.submission_text_restricted($1) as bad`, [v])).bad;
    const samples = [
      // Restricted, however written.
      "123-45-6789", "x123-45-6789y", "Tax id １２３-４５-６７８９ on file", "id ١٢٣-٤٥-٦٧٨٩", "id ۱۲۳-۴۵-۶۷۸۹", "id १२३-४५-६७८९", "id 123–45–6789", "id 123—45—6789", "id 123/45/6789", "id 123_45_6789", "id 123 45 6789", "id 123 - 45 - 6789",
      "tax id 123 456 789", "acct 1234\u200b56789", "Wire to account: 0123 4567 8901", "card 4111-1111-1111-1111", "12-3456789", "123456789", "a1234567890b",
      "SSN on request", "S.S.N. on file", "ssns", "ITIN", "the social security number is on file", "soc. sec. card",
      "DOB 01/02/1970", "D.O.B.: on file", "D\u200bOB 1/2/1970", "date of birth", "date-of-birth 01/02/1970", "birthdate", "birth date", "birthday 1/2/1970", "born in 1961",
      "routing number to follow", "Account # ending 4411", "account number 4411", "acct. # 12", "account no. 7", "acct ending 0123 4567", "accounts ending in 12", "Chase checking ending 4821", "IBAN on file", "ABA number",
      // Fine.
      "1234-56-78901", "12-345-6789", "12345678", "415-555-0100", "(415) 555-0100", "2026-10-31", "$1,020,000", "$1,234,567.89", "Loan request: $8,400,000 bridge | 42-unit multifamily, Oakland CA | 68% LTV, 1.10x DSCR",
      "APN 048A-7012-015-00, 006-0123-004-0000, 331-030-19-00-5", "CA DRE Corp. License #01522444", "Sponsor offers an operating account and deposits; dental, therapy and accounting tenants",
      "Reborn? No: newborn, adobe and itinerary are fine words.", "Suites 101-103", "Units 1 2 3", "18 months, 360-month amortization", "٠١٢٣٤٥٦٧", "Assn. dues", "Doberman", "soccer",
      // Context decides (N3): these save in both.
      "APN 226-180-021", "Units 101 102 103", "tax returns 2022/2023/2024", "rents 2400 2600 2800", "escrow account ending balance", "DOB permits", "DOB permits filed 2024", "truck routing hub",
      "born in", "born in the USA", "taking into account no rent growth", "+61 412 345 678", "projected energy savings 2027", "new A/C 2023", "two account numbers", "acct. # 12", "social security income",
      "Tranche 500 000 000", "Date of birth on the PFS",
      // ...and these are refused in both.
      "id 123--45--6789", "id 123:45:6789", "id 123,45,6789", "id 123·45·6789", "id 123|45|6789", "id (123) 45-6789", "id 123\u008545\u00856789", "SSN 123 456 789", "TIN 123-456-789",
      "card 4111 1111 1111 1111", "account 0123 4567 8901", "birth: 03/04/1971", "Sponsor born on March 3, 1980", "bday 3/4/71", "SS# on file", "social security last four 6789",
      "Chase checking x4821", "savings ending in 0042", "acct no. 55-1234-889", "routing: 1210-0035-8", "a/c 44556677",
      "id 123-45-6\u0308789", "id 123-45-6\uFE0F789", "id 123-45-6\u{E0101}789", "id 123-45-6\u034F789", "id 123-45-6\u115F789", "id 1234\u316456789", "id 123-45-6\uFFA0789", "id 123-45-6\u{E0031}789",
      "id ၁၂၃-၄၅-၆၇၈၉", "id ១២៣-៤៥-៦៧៨៩", "id 𝟏𝟐𝟑-𝟒𝟓-𝟔𝟕𝟖𝟗", "id ¹²³-⁴⁵-⁶⁷⁸⁹", "id 12٣-4٥-67۸9",
    ];
    for (const v of samples) expect(await pg(v), JSON.stringify(v)).toBe(findRestrictedText(v).length > 0);
    expect(await pg("SSN 123-45-6789")).toBe(true);
    expect(await pg("Call 415-555-0100")).toBe(false);
    // The N3 lists hold in the database on their own, not only as "agrees with the app".
    for (const v of ["APN 226-180-021", "rents 2400 2600 2800", "+61 412 345 678", "escrow account ending balance", "taking into account no rent growth", "DOB permits"]) expect(await pg(v), v).toBe(false);
    for (const v of ["id 123--45--6789", "id (123) 45-6789", "birth: 03/04/1971", "SS# on file", "social security last four 6789", "id 123-45-6\u0308789"]) expect(await pg(v), v).toBe(true);
  });

  it("text past a column's length, which zod refuses, the database refuses too", async () => {
    for (const [key, max] of [["closeDriver", 300], ["floodZone", 20], ["businessPlan", 4000], ["apn", 60]] as const) {
      expect(PROFILE_FIELD_SCHEMAS[key].safeParse("x".repeat(max + 1)).success, key).toBe(false);
      expect(await dbAccepts("deal_submission_profiles", snake(key), "x".repeat(max + 1)), key).toBe(false);
      expect(await dbAccepts("deal_submission_profiles", snake(key), "x".repeat(max)), key).toBe(true);
    }
    expect(await dbAccepts("deal_submission_profiles", "highlights", Array.from({ length: 13 }, () => "h"))).toBe(false);
    expect(await dbAccepts("deal_submission_profiles", "risks", Array.from({ length: 13 }, () => ({ risk: "r", mitigant: "m" })))).toBe(false);
    expect(await dbAccepts("deal_submission_profiles", "program_details", [])).toBe(false);
  });

  it("a summary record maps onto the columns deal_summaries has", async () => {
    const d = await deal();
    const row = summaryToRow({
      dealId: d,
      asOf: "2026-11-18",
      playbook: "bridge",
      targetStage: "screen",
      templateVersion: "summary-v1",
      spec: { templateVersion: "summary-v1", title: "T", subtitle: "S", asOf: "2026-11-18", headline: [], sections: [], metricNotes: [], openItems: [], footer: "F" },
      specSha256: sha("1"),
      pdfSha256: sha("2"),
      pdfStoragePath: "p",
      profileVersion: 1,
      sponsorVersion: null,
      createdBy: "broker:ana",
    });
    await expect(insert("deal_summaries", row)).resolves.toBeTruthy();
  });
});
