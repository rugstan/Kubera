// Applies every migration to PGlite (with the Supabase stubs) and checks the
// WS-K schema: lifecycle constraints, the scan-queue claim function, the
// append-only audit table, RLS, and consistency with the TypeScript constants.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";
import { DOCUMENT_EVENTS, DOCUMENT_STATUSES, QUARANTINE_BUCKET, VAULT_BUCKET } from "./types";

vi.mock("server-only", () => ({}));
const { DOCUMENT_BUCKET } = await import("../supabase/server");

let db: PGlite;

beforeAll(async () => {
  db = await createStubbedDb();
  await applyMigrations(db, listMigrations());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

async function newLead() {
  return (
    await one<{ id: string }>(
      `insert into public.leads (source, contact, intake, decision, engine, latency_ms)
       values ('express', '{"email":"pat@example.com"}', '{"loanAmount":1}', '{}', 'rules', 1) returning id`,
    )
  ).id;
}

async function newDoc(leadId: string, extra: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    lead_id: `'${leadId}'`,
    kind: "'T12'",
    storage_path: `'${leadId}/T12/${Math.random().toString(36).slice(2)}.pdf'`,
    file_name: "'t12.pdf'",
    content_type: "'application/pdf'",
    ...extra,
  };
  return (await one<{ id: string }>(`insert into public.documents (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")}) returning id`)).id;
}

describe("WS-K migration", () => {
  it("keeps the TypeScript constants in step with the database", async () => {
    expect(DOCUMENT_BUCKET).toBe(VAULT_BUCKET);
    const buckets = await db.query<{ id: string; public: boolean; file_size_limit: string }>("select id, public, file_size_limit from storage.buckets where id in ($1, $2) order by id", [VAULT_BUCKET, QUARANTINE_BUCKET]);
    expect(buckets.rows.map((b) => b.id)).toEqual([VAULT_BUCKET, QUARANTINE_BUCKET].sort());
    expect(buckets.rows.every((b) => b.public === false && Number(b.file_size_limit) === 52428800)).toBe(true);

    // CHECK constraints list exactly the statuses and events the code uses.
    const defs = (await db.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid in ('public.documents'::regclass, 'public.document_events'::regclass) and contype = 'c'`)).rows.map((r) => r.def).join("\n");
    for (const s of DOCUMENT_STATUSES) expect(defs).toContain(`'${s}'`);
    for (const e of DOCUMENT_EVENTS) expect(defs).toContain(`'${e}'`);
  });

  it("enables RLS on document_events and denies the API roles", async () => {
    const { relrowsecurity } = await one<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'document_events'");
    expect(relrowsecurity).toBe(true);
    await db.exec("grant select, insert, update, delete on all tables in schema public to anon, authenticated");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      expect((await db.query("select * from public.document_events")).rows).toEqual([]); // RLS with no policy: no rows visible
      await expect(db.query("insert into public.document_events (event, actor) values ('download', 'x')")).rejects.toThrow(/row-level security/);
      await expect(db.query("select * from public.claim_documents_for_scan(1, 60)")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("defaults existing-style rows to quarantined in the vault bucket (never clean by default)", async () => {
    const id = await newDoc(await newLead());
    expect(await one("select status, bucket, scan_attempts from public.documents where id = $1", [id])).toEqual({ status: "quarantined", bucket: VAULT_BUCKET, scan_attempts: 0 });
  });

  it("only lets a document be clean after a scan, in the vault bucket", async () => {
    const lead = await newLead();
    const id = await newDoc(lead);
    await expect(db.query("update public.documents set status = 'clean' where id = $1", [id])).rejects.toThrow(/documents_clean_requires_scan/);
    await expect(db.query("update public.documents set status = 'clean', scanned_at = now(), bucket = $2 where id = $1", [id, QUARANTINE_BUCKET])).rejects.toThrow(/documents_clean_requires_scan/);
    await db.query("update public.documents set status = 'clean', scanned_at = now() where id = $1", [id]);
    await expect(db.query("update public.documents set status = 'infected' where id = $1", [id])).rejects.toThrow(/documents_infected_has_signature/);
    await expect(db.query("update public.documents set status = 'bogus' where id = $1", [id])).rejects.toThrow(/status/);
    await expect(db.query("update public.documents set sha256 = 'nothex' where id = $1", [id])).rejects.toThrow(/sha256/);
  });

  it("keeps pending uploads in the quarantine bucket", async () => {
    const lead = await newLead();
    await expect(newDoc(lead, { status: "'pending_upload'" })).rejects.toThrow(/documents_pending_in_quarantine/);
    await newDoc(lead, { status: "'pending_upload'", bucket: `'${QUARANTINE_BUCKET}'` });
  });

  it("leases quarantined rows to one worker at a time and skips held, finished and pending rows", async () => {
    await db.exec("delete from public.documents");
    const lead = await newLead();
    const first = await newDoc(lead);
    const second = await newDoc(lead);
    const pending = await newDoc(lead, { status: "'pending_upload'", bucket: `'${QUARANTINE_BUCKET}'` });
    const infected = await newDoc(lead, { status: "'infected'", scan_signature: "'Eicar-Signature'" });

    const a = await db.query<{ id: string; scan_attempts: number }>("select id, scan_attempts from public.claim_documents_for_scan(1, 300)");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ id: first, scan_attempts: 1 }); // oldest first

    const b = await db.query<{ id: string }>("select id from public.claim_documents_for_scan(10, 300)");
    expect(b.rows.map((r) => r.id)).toEqual([second]); // first is leased; pending/infected are never claimed
    expect(b.rows.map((r) => r.id)).not.toContain(pending);
    expect(b.rows.map((r) => r.id)).not.toContain(infected);

    // Leases expire: the first row can be claimed again, counting a second attempt.
    await db.query("update public.documents set scan_lease_until = now() - interval '1 second' where id = $1", [first]);
    const c = await db.query<{ id: string; scan_attempts: number }>("select id, scan_attempts from public.claim_documents_for_scan(10, 300)");
    expect(c.rows).toEqual([{ id: first, scan_attempts: 2 }]);

    expect((await db.query("select * from public.claim_documents_for_scan(0, 300)")).rows).toEqual([]);
  });

  it("keeps the audit trail append-only and independent of the document's lifetime", async () => {
    const lead = await newLead();
    const doc = await newDoc(lead);
    await db.query("insert into public.document_events (document_id, lead_id, event, actor, detail) values ($1, $2, 'download', 'staff:pat', '{\"kind\":\"T12\"}')", [doc, lead]);
    await expect(db.query("update public.document_events set actor = 'someone else'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.document_events")).rejects.toThrow(/append-only/);
    await expect(db.query("truncate public.document_events")).rejects.toThrow(/append-only/);
    await expect(db.query("insert into public.document_events (event, actor) values ('exfiltrated', 'x')")).rejects.toThrow(/event/);
    await expect(db.query("insert into public.document_events (event, actor, detail) values ('download', 'x', '[]')")).rejects.toThrow(/detail/);

    // Deleting the document (retention, deletion request) leaves the trail.
    await db.query("delete from public.documents where id = $1", [doc]);
    const left = await one<{ n: string }>("select count(*) as n from public.document_events where document_id = $1", [doc]);
    expect(Number(left.n)).toBe(1);
  });

  it("purges only events older than three years", async () => {
    await db.exec("alter table public.document_events disable trigger document_events_append_only");
    await db.exec(`insert into public.document_events (occurred_at, event, actor) values (now() - interval '4 years', 'download', 'old'), (now() - interval '1 year', 'download', 'recent')`);
    await db.exec("alter table public.document_events enable trigger document_events_append_only");

    await expect(db.query("select public.purge_document_events(now() - interval '1 year')")).rejects.toThrow(/too recent/);
    const { purge_document_events } = await one<{ purge_document_events: string }>("select public.purge_document_events(now() - interval '3 years')");
    expect(Number(purge_document_events)).toBeGreaterThanOrEqual(1);
    expect((await db.query("select 1 from public.document_events where actor = 'old'")).rows).toEqual([]);
    expect((await db.query("select 1 from public.document_events where actor = 'recent'")).rows).toHaveLength(1);
    // The bypass is scoped to that call.
    await expect(db.query("delete from public.document_events")).rejects.toThrow(/append-only/);
  });

  it("still honors the legal-hold delete guard added by WS-Y", async () => {
    const lead = await newLead();
    const doc = await newDoc(lead);
    await db.query("update public.documents set legal_hold = true, legal_hold_reason = 'litigation', legal_hold_set_at = now() where id = $1", [doc]);
    await expect(db.query("delete from public.documents where id = $1", [doc])).rejects.toThrow(/legal hold/);
  });
});
