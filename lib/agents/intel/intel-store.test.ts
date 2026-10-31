import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { IntelStoreError, MemoryIntelStore, validateEdit, validateReview } from "./intel-store";
import { SupabaseIntelStore, draftFromRow } from "./intel-store-supabase";
import { SupabaseProspectStore, outreachFromRow, prospectFromRow } from "./prospect-store-supabase";
import { NOW } from "./testing";
import type { NewIntelDraft } from "./types";

const newDraft = (over: Partial<NewIntelDraft> = {}): NewIntelDraft => ({
  weekStart: "2026-11-02",
  generatedBy: "rules",
  model: null,
  servedModel: null,
  promptId: null,
  promptVersion: null,
  promptSha256: null,
  headline: "Market intel: week of 2026-11-02",
  summary: "Digest.",
  sections: [{ title: "Rates", bullets: [{ text: "Ten-year 4.25%.", signalIds: ["rates-aaaaaaaaaaaa"] }] }],
  signals: [{ id: "rates-aaaaaaaaaaaa", source: "rates", title: "Rates", url: null, publishedAt: "2026-11-04" }],
  guardrailHits: [],
  injectionCodes: [],
  note: null,
  createdBy: "agent:intel",
  ...over,
});

describe("MemoryIntelStore review queue", () => {
  it("lets staff edit a pending draft, then approve it; a decided draft is final", async () => {
    const store = new MemoryIntelStore();
    const d = await store.insertDraft(newDraft(), NOW);
    const edited = await store.editDraft(d.id, { headline: "  New headline ", summary: "Better.", sections: [{ title: "Rates", bullets: [{ text: "Edited bullet.", signalIds: ["rates-aaaaaaaaaaaa", "rates-aaaaaaaaaaaa"] }] }] }, "staff:ana", NOW);
    expect(edited).toMatchObject({ headline: "New headline", editedBy: "staff:ana", status: "pending_review" });
    expect(edited!.sections[0]!.bullets[0]!.signalIds).toEqual(["rates-aaaaaaaaaaaa"]);
    const approved = await store.reviewDraft(d.id, { decision: "approved", by: "staff:pat" }, NOW);
    expect(approved).toMatchObject({ status: "approved", reviewedBy: "staff:pat", reviewNote: null });
    expect(await store.reviewDraft(d.id, { decision: "rejected", by: "x", note: "late" }, NOW)).toBeNull();
    expect(await store.editDraft(d.id, { headline: "h", summary: "s", sections: [] }, "x", NOW)).toBeNull();
  });

  it("requires a reason to reject", async () => {
    const store = new MemoryIntelStore();
    const d = await store.insertDraft(newDraft(), NOW);
    await expect(store.reviewDraft(d.id, { decision: "rejected", by: "staff" }, NOW)).rejects.toThrow(/why/);
    expect(await store.reviewDraft(d.id, { decision: "rejected", by: "staff", note: "Off topic" }, NOW)).toMatchObject({ status: "rejected", reviewNote: "Off topic" });
  });

  it("lists newest week first and filters by status", async () => {
    const store = new MemoryIntelStore();
    await store.insertDraft(newDraft({ weekStart: "2026-10-26" }), NOW);
    const b = await store.insertDraft(newDraft({ weekStart: "2026-11-02" }), NOW);
    expect((await store.listDrafts()).map((d) => d.weekStart)).toEqual(["2026-11-02", "2026-10-26"]);
    await store.reviewDraft(b.id, { decision: "approved", by: "x" }, NOW);
    expect(await store.listDrafts({ status: "approved" })).toHaveLength(1);
    expect((await store.latestForWeek("2026-11-02"))!.id).toBe(b.id);
    expect(await store.latestForWeek("2030-01-07")).toBeNull();
  });
});

describe("validation", () => {
  it("validates edits like the table does", () => {
    expect(() => validateEdit({ headline: "", summary: "s", sections: [] })).toThrow(IntelStoreError);
    expect(() => validateEdit({ headline: "h", summary: "x".repeat(4_001), sections: [] })).toThrow(/summary/);
    expect(() => validateEdit({ headline: "h", summary: "s", sections: Array.from({ length: 9 }, () => ({ title: "t", bullets: [] })) })).toThrow(/sections/);
    expect(() => validateEdit({ headline: "h", summary: "s", sections: [{ title: "t", bullets: [{ text: "", signalIds: [] }] }] })).toThrow(/bullet/);
    expect(() => validateReview({ decision: "approved", by: "x", note: "n".repeat(1_001) })).toThrow(/limited/);
  });
});

/** Records PostgREST builder calls and answers each terminal call with the next queued result. */
function recorder(results: { data: unknown; error: unknown }[]) {
  const calls: [string, ...unknown[]][] = [];
  const next = () => results.shift() ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "update", "insert", "upsert", "eq", "neq", "in", "not", "gte", "or", "order", "limit", "range"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.single = async () => next();
  builder.maybeSingle = async () => next();
  builder.then = (resolve: (v: unknown) => void) => resolve(next());
  const db = { from: (t: string) => (calls.push(["from", t]), builder) } as unknown as SupabaseClient;
  return { db, calls };
}

const draftRow = {
  id: "00000000-0000-4000-8000-0000000000d1",
  created_at: "2026-11-05T17:00:00Z",
  updated_at: "2026-11-05T17:00:00Z",
  week_start: "2026-11-02",
  version: 2,
  status: "pending_review",
  generated_by: "model",
  model: "grok-4",
  served_model: "grok-4",
  prompt_id: "intel.market_draft",
  prompt_version: "1.0.0",
  prompt_sha256: "a".repeat(64),
  headline: "h",
  summary: "s",
  sections: [],
  signals: [],
  guardrail_hits: ["commitment.x"],
  injection_codes: [],
  note: null,
  created_by: "agent:intel",
  edited_by: null,
  edited_at: null,
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
};

describe("Supabase stores", () => {
  it("maps an intel draft row and allocates the next version, superseding the earlier pending draft", async () => {
    const { db, calls } = recorder([
      { data: [{ ...draftRow, version: 1 }], error: null },
      { data: draftRow, error: null },
      { data: null, error: null },
    ]);
    const d = await new SupabaseIntelStore(db).insertDraft(newDraft(), NOW);
    expect(d).toMatchObject({ id: draftRow.id, weekStart: "2026-11-02", version: 2, generatedBy: "model", guardrailHits: ["commitment.x"] });
    const insert = calls.find((c) => c[0] === "insert")?.[1] as Record<string, unknown>;
    expect(insert).toMatchObject({ week_start: "2026-11-02", version: 2, status: "pending_review", created_by: "agent:intel" });
    const update = calls.find((c) => c[0] === "update")?.[1] as Record<string, unknown>;
    expect(update).toMatchObject({ status: "superseded" });
    expect(calls).toContainEqual(["neq", "id", draftRow.id]);
  });

  it("retries the version when two runs race, and reviews only pending drafts", async () => {
    const { db, calls } = recorder([
      { data: [{ ...draftRow, version: 1 }], error: null },
      { data: null, error: { code: "23505", message: "duplicate" } },
      { data: [{ ...draftRow, version: 2 }], error: null },
      { data: { ...draftRow, version: 3 }, error: null },
      { data: null, error: null },
    ]);
    const d = await new SupabaseIntelStore(db).insertDraft(newDraft(), NOW);
    expect(d.version).toBe(3);

    const r = recorder([{ data: { ...draftRow, status: "approved", reviewed_by: "staff", reviewed_at: "2026-11-05T18:00:00Z" }, error: null }]);
    const reviewed = await new SupabaseIntelStore(r.db).reviewDraft(draftRow.id, { decision: "approved", by: "staff" }, NOW);
    expect(reviewed?.status).toBe("approved");
    expect(r.calls).toContainEqual(["eq", "status", "pending_review"]);
    void calls;
  });

  it("maps prospect and outreach rows", () => {
    const p = prospectFromRow({
      id: "p1", created_at: "t", updated_at: "t", dedupe_key: "k", source: "attom", source_ref: "1", scan_id: null, address_line1: "1 A St", city: "LA", state: "CA", zip: "90001", apn: null,
      property_type: "hotel", units: 80, building_sqft: null, year_built: null, owner_name: "Owner LLC", owner_kind: "entity", mailing_line1: "2 B St", mailing_city: "LA", mailing_state: "CA", mailing_zip: "90002",
      contact_name: null, contact_email: null, loan_original_cents: "740000000", loan_lender: null, loan_origination_date: null, loan_maturity_date: "2027-07-01", loan_rate_pct: "4.100", loan_type: null,
      last_sale_date: null, last_sale_price_cents: null, data_as_of: "2026-11-05", score: 77, score_factors: [], recommended_program: "sba_504", window_bucket: "months_6_12", status: "new",
      assigned_to: null, notes: null, last_scanned_at: "t", updated_by: null,
    });
    expect(p).toMatchObject({ loanOriginalCents: 740_000_000, loanRatePct: 4.1, mailing: { line1: "2 B St", zip: "90002" }, recommendedProgram: "sba_504" });
    const o = outreachFromRow({
      id: "o1", created_at: "t", updated_at: "t", prospect_id: "p1", version: 1, channel: "letter", status: "ready_to_mail", reason_code: "ready_to_mail", idempotency_key: "k", recipient: "r", subject: "s",
      body_text: "b", body_sha256: "a".repeat(64), generated_by: "template", model: null, guardrail_hits: [], approval_id: "a1", provider_message_id: null, error: null, drafted_by: "staff", sent_at: null, mailed_at: null, mailed_by: null,
    });
    expect(o).toMatchObject({ channel: "letter", status: "ready_to_mail", approvalId: "a1" });
    expect(draftFromRow(draftRow as never).promptVersion).toBe("1.0.0");
  });

  it("updates an outreach row only from the expected statuses (compare-and-set) and never writes the staff-owned columns on a scan refresh", async () => {
    const r = recorder([{ data: null, error: null }]);
    const out = await new SupabaseProspectStore(r.db).updateOutreach("o1", ["pending_approval"], { status: "sent", sentAt: "t" }, NOW);
    expect(out).toBeNull();
    expect(r.calls).toContainEqual(["in", "status", ["pending_approval"]]);

    const row = { id: "p1" };
    const s = recorder([{ data: row, error: null }, { data: { id: "p1", status: "reviewing", mailing_line1: null, score_factors: [] }, error: null }]);
    await new SupabaseProspectStore(s.db).upsertScanned(
      { dedupeKey: "k", source: "fake", sourceRef: null, scanId: null, addressLine1: "1 A", city: null, state: "CA", zip: null, apn: null, propertyType: "other", units: null, buildingSqft: null, yearBuilt: null, ownerName: null, ownerKind: "unknown", mailing: null, loanOriginalCents: null, loanLender: null, loanOriginationDate: null, loanMaturityDate: "2027-01-01", loanRatePct: null, loanType: null, lastSaleDate: null, lastSalePriceCents: null, dataAsOf: "2026-11-05", score: 10, scoreFactors: [], recommendedProgram: null, windowBucket: "months_6_12", lastScannedAt: "t" },
      "new",
      NOW,
    );
    const update = s.calls.find((c) => c[0] === "update")?.[1] as Record<string, unknown>;
    for (const staffOwned of ["status", "contact_name", "contact_email", "notes", "assigned_to"]) expect(update).not.toHaveProperty(staffOwned);
    expect(update).toHaveProperty("score", 10);
  });
});
