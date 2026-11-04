import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { MemoryCostWriter, SupabaseCostWriter, parseCostInput } from "./costs";

const good = { source: "Google Ads", periodStart: "2026-10-01", periodEnd: "2026-10-31", amount: "2,500.50", note: " Q4 search " };

describe("parseCostInput", () => {
  it("normalizes the source and converts dollars to cents", () => {
    expect(parseCostInput(good)).toEqual({
      ok: true,
      cost: { source: "google_ads", periodStart: "2026-10-01", periodEnd: "2026-10-31", spendCents: 250_050 },
      note: "Q4 search",
    });
    expect(parseCostInput({ ...good, amount: "$300", note: "" })).toMatchObject({ ok: true, cost: { spendCents: 30_000 }, note: null });
  });

  it("explains what is wrong in plain words", () => {
    const err = (over: Record<string, unknown>) => {
      const r = parseCostInput({ ...good, ...over });
      return r.ok ? null : r.error;
    };
    expect(err({ source: " " })).toBe("Name the lead source");
    expect(err({ source: "<script>" })).toMatch(/letters, numbers/);
    expect(err({ periodStart: "soon" })).toBe("Enter the first day of the period");
    expect(err({ periodEnd: "2026-09-30" })).toBe("The period must end on or after its first day");
    expect(err({ amount: "lots" })).toMatch(/dollars/);
    expect(err({ amount: "-5" })).toMatch(/dollars/);
    expect(err({ amount: "" })).toBe("Enter the amount spent");
    expect(err({ amount: "99999999999" })).toBe("That amount is too large");
  });
});

describe("cost writers", () => {
  const cost = { source: "google_ads", periodStart: "2026-10-01", periodEnd: "2026-10-31", spendCents: 100 };

  it("memory writer rejects a duplicate period for the same source", async () => {
    const w = new MemoryCostWriter();
    expect(await w.add(cost, null, "staff:a")).toEqual({ ok: true, cost });
    expect(await w.add(cost, null, "staff:a")).toMatchObject({ ok: false, error: expect.stringMatching(/already recorded/) });
    expect(await w.add({ ...cost, source: "linkedin" }, null, "staff:a")).toMatchObject({ ok: true });
    expect(w.costs).toHaveLength(2);
  });

  it("supabase writer inserts the row and maps a unique violation", async () => {
    const insert = vi.fn(async () => ({ error: null as { code?: string; message: string } | null }));
    const db = { from: () => ({ insert }) } as unknown as SupabaseClient;
    const writer = new SupabaseCostWriter(db);
    expect(await writer.add(cost, "note", "staff:ana@corin.test")).toEqual({ ok: true, cost });
    expect(insert).toHaveBeenCalledWith({ created_by: "staff:ana@corin.test", source: "google_ads", period_start: "2026-10-01", period_end: "2026-10-31", spend_cents: 100, note: "note" });

    insert.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate key" } });
    expect(await writer.add(cost, null, "x")).toMatchObject({ ok: false, error: expect.stringMatching(/already recorded/) });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    insert.mockResolvedValueOnce({ error: { message: "connection reset" } });
    const failed = await writer.add(cost, null, "x");
    expect(failed).toMatchObject({ ok: false });
    expect(JSON.stringify(failed)).not.toContain("connection reset");
    spy.mockRestore();
  });
});
