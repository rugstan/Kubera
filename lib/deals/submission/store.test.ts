import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILE_COLUMNS, PROFILE_KEYS, profileFromRow, snakeColumn, SPONSOR_COLUMNS, SPONSOR_KEYS, sponsorFromRow, SUMMARY_COLUMNS, summaryFromRow } from "./rows";
import { ConcurrentUpdateError, GuardError, mergeProfilePatch, MemorySubmissionStore } from "./store";
import { FIXTURE_STAFF, submissionFixture } from "./test-fixtures";
import { blankSubmissionProfileFields, type DealSummaryRecord } from "./types";

const NOW = new Date("2026-11-20T17:00:00.000Z");
const LATER = new Date("2026-11-21T17:00:00.000Z");
const DEAL = "5ab01c01-0d0e-4f00-8a00-fa01ce01be01";
const SQL = readFileSync(path.resolve(import.meta.dirname, "../../../supabase/migrations/20261105160000_int_deal_submission.sql"), "utf8");

function tableColumns(table: string): string[] {
  const start = SQL.indexOf(`create table public.${table} (`);
  const body = SQL.slice(start, SQL.indexOf("\n);", start));
  return [...body.matchAll(/\n {2}([a-z_0-9]+) (?:uuid|text|integer|bigint|numeric|date|timestamptz|boolean|jsonb)/g)].map((m) => m[1]!);
}

const summary = (over: Partial<DealSummaryRecord> = {}): Omit<DealSummaryRecord, "id" | "createdAt"> => ({
  dealId: DEAL,
  asOf: "2026-11-18",
  playbook: "bridge",
  targetStage: "screen",
  templateVersion: "summary-v1",
  spec: { templateVersion: "summary-v1", title: "T", subtitle: "S", asOf: "2026-11-18", headline: [], sections: [], metricNotes: [], openItems: [], footer: "F" },
  specSha256: "a".repeat(64),
  pdfSha256: "b".repeat(64),
  pdfStoragePath: `deals/${DEAL}/summaries/b.pdf`,
  profileVersion: 7,
  sponsorVersion: 3,
  createdBy: FIXTURE_STAFF,
  ...over,
});

describe("merge rules", () => {
  it("replaces columns, merges program sections one at a time and field sources key by key", () => {
    const cur = { ...blankSubmissionProfileFields("hotel_pip_bridge"), programDetails: { hotel: { brand: "Independent" }, rehab: { months: 12 } }, fieldSources: { purpose: { source: "entered" as const, by: "a", at: NOW.toISOString() }, apn: { source: "public_record" as const, ref: "f", at: NOW.toISOString() } } };
    const next = mergeProfilePatch(cur, {
      purpose: "acquisition",
      programDetails: { hotel: { adrCents: 11_850 } },
      fieldSources: { apn: null, sizeCount: { source: "spread", ref: "s", at: NOW.toISOString() } },
    });
    expect(next.purpose).toBe("acquisition");
    expect(next.programDetails).toEqual({ hotel: { adrCents: 11_850 }, rehab: { months: 12 } });
    expect(Object.keys(next.fieldSources).sort()).toEqual(["purpose", "sizeCount"]);
    expect(cur.programDetails.hotel).toEqual({ brand: "Independent" });
  });
});

describe("MemorySubmissionStore profiles", () => {
  it("inserts with a playbook, once per deal, and bumps record_version on each update", async () => {
    const store = new MemorySubmissionStore();
    await expect(store.upsertProfile(DEAL, null, { purpose: "refinance" }, FIXTURE_STAFF, NOW)).rejects.toThrow(GuardError);
    const p = await store.upsertProfile(DEAL, null, { playbook: "bridge", purpose: "acquisition" }, FIXTURE_STAFF, NOW);
    expect(p).toMatchObject({ dealId: DEAL, playbook: "bridge", purpose: "acquisition", recordVersion: 1, createdBy: FIXTURE_STAFF, updatedBy: FIXTURE_STAFF, createdAt: NOW.toISOString() });
    await expect(store.upsertProfile(DEAL, null, { playbook: "bridge" }, FIXTURE_STAFF, NOW)).rejects.toThrow(ConcurrentUpdateError);
    const q = await store.upsertProfile(DEAL, 1, { requestedTermMonths: 24 }, "broker:lee", LATER);
    expect(q).toMatchObject({ recordVersion: 2, purpose: "acquisition", requestedTermMonths: 24, updatedBy: "broker:lee", updatedAt: LATER.toISOString(), createdAt: NOW.toISOString(), id: p.id });
  });

  it("throws ConcurrentUpdateError on a stale version or a missing row", async () => {
    const store = new MemorySubmissionStore();
    await expect(store.upsertProfile(DEAL, 1, { purpose: "refinance" }, FIXTURE_STAFF, NOW)).rejects.toThrow(ConcurrentUpdateError);
    await store.upsertProfile(DEAL, null, { playbook: "bridge" }, FIXTURE_STAFF, NOW);
    await store.upsertProfile(DEAL, 1, { purpose: "refinance" }, FIXTURE_STAFF, NOW);
    await expect(store.upsertProfile(DEAL, 1, { purpose: "acquisition" }, FIXTURE_STAFF, NOW)).rejects.toThrow(ConcurrentUpdateError);
    expect((await store.getProfile(DEAL))!.purpose).toBe("refinance");
  });

  it("applies the row checks to the merged row, so two valid patches cannot make an invalid row", async () => {
    const store = new MemorySubmissionStore();
    await store.upsertProfile(DEAL, null, { playbook: "bridge", requestedTermMonths: 24 }, FIXTURE_STAFF, NOW);
    await expect(store.upsertProfile(DEAL, 1, { requestedIoMonths: 36 }, FIXTURE_STAFF, NOW)).rejects.toThrow(/interest-only/);
    await expect(store.upsertProfile(DEAL, 1, { businessPlan: "Guarantor 123-45-6789" }, FIXTURE_STAFF, NOW)).rejects.toThrow(GuardError);
    await expect(store.upsertProfile(DEAL, 1, { programDetails: { hotel: { brand: "X", nope: 1 } as never } }, FIXTURE_STAFF, NOW)).rejects.toThrow(GuardError);
    expect((await store.getProfile(DEAL))!.recordVersion).toBe(1);
  });

  it("refuses a deal the desk does not have (the foreign key)", async () => {
    const store = new MemorySubmissionStore({ dealExists: (id) => id === DEAL });
    await expect(store.upsertProfile("00000000-0000-4000-8000-000000000999", null, { playbook: "bridge" }, FIXTURE_STAFF, NOW)).rejects.toThrow(/not found/);
    await expect(store.upsertProfile(DEAL, null, { playbook: "bridge" }, FIXTURE_STAFF, NOW)).resolves.toBeTruthy();
  });

  it("round-trips a complete fixture profile and returns copies", async () => {
    const store = new MemorySubmissionStore();
    const fx = submissionFixture("construction").profile!;
    const { id: _i, dealId: _d, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, recordVersion: _v, ...fields } = fx;
    const saved = await store.upsertProfile(DEAL, null, fields, FIXTURE_STAFF, NOW);
    expect({ ...saved, id: fx.id, dealId: fx.dealId, createdAt: fx.createdAt, updatedAt: fx.updatedAt, recordVersion: fx.recordVersion }).toEqual(fx);
    saved.programDetails.construction!.budget!.hardCents = 1;
    expect((await store.getProfile(DEAL))!.programDetails.construction!.budget!.hardCents).toBe(fx.programDetails.construction!.budget!.hardCents);
  });
});

describe("MemorySubmissionStore sponsors", () => {
  it("needs a date with stated figures and never echoes the value in the error", async () => {
    const store = new MemorySubmissionStore();
    const err = await store.upsertSponsor(DEAL, null, { statedNetWorthCents: 1_234_567_800 }, FIXTURE_STAFF, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GuardError);
    expect(String((err as Error).message)).not.toMatch(/1234567800|12,345,678/);
    const s = await store.upsertSponsor(DEAL, null, { statedNetWorthCents: 1_234_567_800, statedAsOf: "2026-09-30", creditBand: "740_PLUS" }, FIXTURE_STAFF, NOW);
    expect(s).toMatchObject({ recordVersion: 1, emailFinancialsMode: "covenant_only", creditEvents: {} });
    await expect(store.upsertSponsor(DEAL, 2, { yearsExperience: 3 }, FIXTURE_STAFF, NOW)).rejects.toThrow(ConcurrentUpdateError);
    expect(await store.upsertSponsor(DEAL, 1, { yearsExperience: 3 }, FIXTURE_STAFF, LATER)).toMatchObject({ recordVersion: 2, yearsExperience: 3, statedNetWorthCents: 1_234_567_800 });
  });
});

describe("MemorySubmissionStore summaries", () => {
  it("returns the existing row for the same deal and PDF hash, and checks the hashes", async () => {
    const store = new MemorySubmissionStore();
    const a = await store.insertSummary(summary(), NOW);
    const b = await store.insertSummary(summary({ templateVersion: "other" }), LATER);
    expect(b).toEqual(a);
    expect(store.summaries.size).toBe(1);
    expect(await store.getSummary(a.id)).toEqual(a);
    expect(await store.getSummaryByPdfSha(DEAL, "b".repeat(64))).toEqual(a);
    expect(await store.getSummaryByPdfSha(DEAL, "c".repeat(64))).toBeNull();
    await expect(store.insertSummary(summary({ pdfSha256: "XYZ" }), NOW)).rejects.toThrow(/pdf_sha256/);
    await expect(store.insertSummary(summary({ pdfSha256: "c".repeat(64), profileVersion: 0 }), NOW)).rejects.toThrow(/profile_version/);
    await expect(store.insertSummary(summary({ pdfSha256: "c".repeat(64), targetStage: "close" as never }), NOW)).rejects.toThrow(/target_stage/);
  });
});

describe("row mapping", () => {
  it("selects exactly the columns each table has", () => {
    expect(PROFILE_COLUMNS.split(", ").sort()).toEqual(tableColumns("deal_submission_profiles").sort());
    expect(SPONSOR_COLUMNS.split(", ").sort()).toEqual(tableColumns("deal_sponsor_profiles").sort());
    expect(SUMMARY_COLUMNS.split(", ").sort()).toEqual(tableColumns("deal_summaries").sort());
  });

  it("reads PostgREST rows (numeric strings, date strings, offset timestamps) back into the record", () => {
    const fx = submissionFixture("mezz_pref").profile!;
    const row: Record<string, unknown> = {};
    for (const k of PROFILE_KEYS) row[snakeColumn(k)] = fx[k];
    row.occupancy_pct = "89.000";
    row.purchase_price_cents = String(fx.purchasePriceCents);
    row.created_at = fx.createdAt.replace(".000Z", "+00:00");
    row.updated_at = fx.updatedAt.replace(".000Z", ".000000+00:00");
    expect(profileFromRow(row)).toEqual(fx);

    const sp = submissionFixture("mezz_pref").sponsor!;
    const srow: Record<string, unknown> = {};
    for (const k of SPONSOR_KEYS) srow[snakeColumn(k)] = sp[k];
    srow.stated_net_worth_cents = String(sp.statedNetWorthCents);
    expect(sponsorFromRow(srow)).toEqual(sp);

    const s = { ...summary(), id: "x", createdAt: NOW.toISOString() };
    const sumRow = Object.fromEntries(Object.entries(s).map(([k, v]) => [snakeColumn(k), v]));
    expect(summaryFromRow({ ...sumRow, created_at: "2026-11-20 17:00:00+00", profile_version: "7" })).toEqual(s);
  });
});
