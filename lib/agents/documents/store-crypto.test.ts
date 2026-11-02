// PFS extractions are restricted personal information: their fields and
// evidence are sealed before they reach document_extractions and opened on
// read for the review queue and spreads. Without a key they are refused.
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createKeyring, isEncrypted } from "@/lib/privacy/crypto";
import { goldenRecord } from "@/lib/spreads/test-fixtures";
import { correctAndApprove, listReviewQueue } from "./review";
import {
  extractionFieldsContext,
  isSealedFields,
  MemoryExtractionEventLog,
  RESTRICTED_FIELDS_UNAVAILABLE,
  RestrictedExtractionError,
  supabaseExtractionStore,
  type ExtractionRecord,
  type NewExtraction,
} from "./store";

/** Just enough of PostgREST for the extraction store, over one in-memory table. */
function fakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  let n = 0;
  function query(table: string) {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "insert"; row: Record<string, unknown> } | { kind: "update"; patch: Record<string, unknown> } = { kind: "select" };
    let limit = Infinity;
    const run = () => {
      if (table !== "document_extractions") throw new Error(`unexpected table ${table}`);
      if (op.kind === "insert") {
        const id = (op.row.id as string | undefined) ?? `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
        const row = { created_at: new Date().toISOString(), updated_at: new Date().toISOString(), reviewed_by: null, reviewed_at: null, review_notes: null, superseded_by: null, ...structuredClone(op.row), id };
        rows.set(id, row);
        return [structuredClone(row)];
      }
      const hits = [...rows.values()].filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (op.kind === "update") for (const r of hits) Object.assign(r, structuredClone(op.patch));
      return hits.map((r) => structuredClone(r));
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Record<string, unknown>) => ((op = { kind: "insert", row }), b),
      update: (patch: Record<string, unknown>) => ((op = { kind: "update", patch }), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      not: () => b,
      order: () => b,
      limit: (l: number) => ((limit = l), b),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: run(), error: null }),
    };
    return b;
  }
  return { rows, db: { from: query } as unknown as SupabaseClient };
}

const keyring = createKeyring({ version: 1, key: randomBytes(32) });
const DEAL = "44444444-4444-4444-8444-444444444444";

function newRow(r: ExtractionRecord): NewExtraction {
  const { id: _id, created_at: _c, updated_at: _u, reviewed_by: _rb, reviewed_at: _ra, review_notes: _rn, superseded_by: _s, ...rest } = r;
  return rest;
}

describe("PFS extraction fields at rest", () => {
  it("seals a PFS extraction's fields and evidence, bound to its id, and opens them on read", async () => {
    const { rows, db } = fakeDb();
    const store = supabaseExtractionStore(db, { keyring });
    const pfs = goldenRecord("pfs-mismatch-xlsx", { deal_id: DEAL });
    expect(pfs.doc_type).toBe("PFS");
    const rec = await store.insert(newRow(pfs));

    const raw = rows.get(rec.id)!;
    expect(isSealedFields(raw.fields)).toBe(true);
    const stored = JSON.stringify(raw.fields);
    expect(isEncrypted((raw.fields as { sealed: string }).sealed)).toBe(true);
    // No value or evidence snippet is readable in the stored row.
    for (const f of Object.values(pfs.fields.scalars)) {
      if (typeof f.value === "number" && f.value > 999) expect(stored).not.toContain(String(f.value));
      if (f.evidence && f.evidence.length > 4) expect(stored).not.toContain(f.evidence);
    }

    expect(rec.fields).toEqual(pfs.fields);
    expect((await store.get(rec.id))!.fields).toEqual(pfs.fields);
    expect((await store.listForDeal(DEAL))[0]!.fields).toEqual(pfs.fields);
    expect(extractionFieldsContext(rec.id)).toContain(rec.id);

    // Moving the ciphertext to another row does not open it there.
    const other = await store.insert(newRow(goldenRecord("pfs-mismatch-xlsx", { deal_id: DEAL, document_id: null, status: "rejected" })));
    rows.get(other.id)!.fields = raw.fields;
    const moved = (await store.get(other.id))!;
    expect(moved.fields).toEqual({ scalars: {}, rows: [] });
    expect(moved.warnings).toContain(RESTRICTED_FIELDS_UNAVAILABLE);
  });

  it("keeps corrections sealed through the review queue", async () => {
    const { rows, db } = fakeDb();
    const store = supabaseExtractionStore(db, { keyring });
    const pfs = goldenRecord("pfs-mismatch-xlsx", { deal_id: DEAL });
    expect(pfs.status).toBe("needs_review");
    const rec = await store.insert(newRow(pfs));
    const queue = await listReviewQueue(store, 10);
    expect(queue.map((r) => r.id)).toContain(rec.id);
    expect(queue[0]!.fields).toEqual(pfs.fields);

    const approved = await correctAndApprove({ store, events: new MemoryExtractionEventLog() }, rec.id, { reviewer: "analyst@corin", corrections: { scalars: { totalAssets: "1,900,000", netWorth: 1_500_000 } } });
    expect(approved.status).toBe("approved");
    expect(approved.fields.scalars.totalAssets!.value).toBe(1_900_000);
    expect(isSealedFields(rows.get(rec.id)!.fields)).toBe(true);
    expect(JSON.stringify(rows.get(rec.id)!.fields)).not.toContain("1900000");
  });

  it("refuses to store a PFS extraction without PII_ENCRYPTION_KEY", async () => {
    const { rows, db } = fakeDb();
    const store = supabaseExtractionStore(db, { keyring: null });
    expect(store.acceptsRestricted?.()).toBe(false);
    await expect(store.insert(newRow(goldenRecord("pfs-mismatch-xlsx", { deal_id: DEAL })))).rejects.toBeInstanceOf(RestrictedExtractionError);
    expect(rows.size).toBe(0);
  });

  it("leaves other document types readable for spreads", async () => {
    const { rows, db } = fakeDb();
    const store = supabaseExtractionStore(db, { keyring: null });
    const t12 = goldenRecord("t12-annual-csv", { deal_id: DEAL });
    const rec = await store.insert(newRow(t12));
    expect(isSealedFields(rows.get(rec.id)!.fields)).toBe(false);
    expect(rec.fields).toEqual(t12.fields);
  });
});
